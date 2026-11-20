//! Process plumbing shared by every command: spawning, output capture,
//! streaming to the frontend, the single-task lock and process-tree kill.

use std::ffi::OsStr;
use std::process::{ExitStatus, Output, Stdio};
use std::sync::{Arc, Mutex};
use std::time::Duration;

use serde::Serialize;
use tauri::ipc::Channel;
use tokio::io::{AsyncBufReadExt, AsyncRead, BufReader};
use tokio::process::Command;
use tokio::sync::{mpsc, watch};
use tokio::task::JoinHandle;

use crate::config::KILL_GRACE;
use crate::error::{AppError, AppResult};

#[cfg(windows)]
const CREATE_NO_WINDOW: u32 = 0x0800_0000;

/// The only way commands create processes. Hides the console window on Windows.
pub fn command(program: impl AsRef<OsStr>) -> Command {
    let mut cmd = Command::new(program);
    #[cfg(windows)]
    cmd.creation_flags(CREATE_NO_WINDOW);
    cmd.stdin(Stdio::null());
    cmd
}

/// Runs a short helper command to completion and returns its output.
/// The process is killed if it exceeds `timeout`.
pub async fn run_capture(mut cmd: Command, program: &str, timeout: Duration) -> AppResult<Output> {
    cmd.stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .kill_on_drop(true);
    let child = cmd.spawn().map_err(|e| AppError::Spawn {
        program: program.to_string(),
        message: e.to_string(),
    })?;
    match tokio::time::timeout(timeout, child.wait_with_output()).await {
        Ok(out) => Ok(out?),
        Err(_) => Err(AppError::Timeout(program.to_string())),
    }
}

// ---------------------------------------------------------------------------
// Streaming to the frontend
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum Stream {
    Stdout,
    Stderr,
    /// Lines written by StudioLite itself (commands being run, stage results).
    Info,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct OutLine {
    pub stream: Stream,
    pub text: String,
}

#[derive(Debug, Clone, Serialize)]
#[serde(tag = "type", rename_all = "camelCase")]
pub enum TaskEvent {
    Lines { lines: Vec<OutLine> },
    Stage { label: String },
}

enum Msg {
    Line(OutLine),
    Stage(String),
}

const MAX_BATCH: usize = 500;
const BATCH_INTERVAL: Duration = Duration::from_millis(16);

/// Collects output from any number of readers and forwards it to the frontend in batches,
/// so a chatty Gradle build produces ~60 IPC messages per second instead of thousands.
#[derive(Clone)]
pub struct TaskOutput {
    tx: mpsc::UnboundedSender<Msg>,
}

impl TaskOutput {
    /// Returns the sink and the forwarder task. Drop every sink clone and await the task
    /// to be sure the frontend got everything before the command returns.
    pub fn start(channel: Channel<TaskEvent>) -> (Self, JoinHandle<()>) {
        let (tx, mut rx) = mpsc::unbounded_channel::<Msg>();
        let forwarder = tokio::spawn(async move {
            let mut batch: Vec<OutLine> = Vec::new();
            while let Some(first) = rx.recv().await {
                let mut pending = Some(first);
                while let Some(msg) = pending.take() {
                    match msg {
                        Msg::Line(line) => batch.push(line),
                        Msg::Stage(label) => {
                            flush(&channel, &mut batch);
                            let _ = channel.send(TaskEvent::Stage { label });
                        }
                    }
                    if batch.len() >= MAX_BATCH {
                        break;
                    }
                    pending = rx.try_recv().ok();
                }
                flush(&channel, &mut batch);
                tokio::time::sleep(BATCH_INTERVAL).await;
            }
        });
        (Self { tx }, forwarder)
    }

    pub fn line(&self, stream: Stream, text: impl Into<String>) {
        let _ = self.tx.send(Msg::Line(OutLine {
            stream,
            text: text.into(),
        }));
    }

    pub fn info(&self, text: impl Into<String>) {
        self.line(Stream::Info, text);
    }

    pub fn stage(&self, label: impl Into<String>) {
        let _ = self.tx.send(Msg::Stage(label.into()));
    }
}

fn flush(channel: &Channel<TaskEvent>, batch: &mut Vec<OutLine>) {
    if !batch.is_empty() {
        let _ = channel.send(TaskEvent::Lines {
            lines: std::mem::take(batch),
        });
    }
}

/// Reads raw bytes line by line: build tools on Windows may emit non-UTF-8 output.
async fn pump<R: AsyncRead + Unpin>(reader: R, stream: Stream, out: TaskOutput) {
    let mut reader = BufReader::new(reader);
    let mut buf = Vec::with_capacity(256);
    loop {
        buf.clear();
        match reader.read_until(b'\n', &mut buf).await {
            Ok(0) | Err(_) => break,
            Ok(_) => {
                while matches!(buf.last(), Some(b'\n' | b'\r')) {
                    buf.pop();
                }
                out.line(stream, String::from_utf8_lossy(&buf));
            }
        }
    }
}

// ---------------------------------------------------------------------------
// Single running task
// ---------------------------------------------------------------------------

pub struct TaskHandle {
    pid: Mutex<Option<u32>>,
    cancel: watch::Sender<bool>,
}

impl TaskHandle {
    pub fn is_cancelled(&self) -> bool {
        *self.cancel.borrow()
    }

    /// Resolves once Stop was pressed.
    pub async fn cancelled(&self) {
        let mut rx = self.cancel.subscribe();
        let _ = rx.wait_for(|cancelled| *cancelled).await;
    }

    pub fn check(&self) -> AppResult<()> {
        if self.is_cancelled() {
            Err(AppError::Cancelled)
        } else {
            Ok(())
        }
    }
}

/// Managed state: at most one Build/Run at a time.
#[derive(Default)]
pub struct TaskState {
    current: Mutex<Option<Arc<TaskHandle>>>,
}

impl TaskState {
    pub fn begin(&self) -> AppResult<TaskGuard<'_>> {
        let mut current = self.current.lock().unwrap();
        if current.is_some() {
            return Err(AppError::TaskAlreadyRunning);
        }
        let handle = Arc::new(TaskHandle {
            pid: Mutex::new(None),
            cancel: watch::Sender::new(false),
        });
        *current = Some(handle.clone());
        Ok(TaskGuard {
            state: self,
            handle,
        })
    }
}

/// Releases the task slot when the command finishes, including on early return.
pub struct TaskGuard<'a> {
    state: &'a TaskState,
    pub handle: Arc<TaskHandle>,
}

impl Drop for TaskGuard<'_> {
    fn drop(&mut self) {
        *self.state.current.lock().unwrap() = None;
    }
}

/// Runs a task step, streaming stdout/stderr to `out`. Cancellation kills the process tree
/// and returns `AppError::Cancelled`.
pub async fn run_streaming(
    mut cmd: Command,
    program: &str,
    handle: &TaskHandle,
    out: &TaskOutput,
) -> AppResult<ExitStatus> {
    handle.check()?;
    cmd.stdout(Stdio::piped()).stderr(Stdio::piped());
    // Own process group, so Stop can signal the whole tree at once.
    #[cfg(unix)]
    cmd.process_group(0);

    let mut child = cmd.spawn().map_err(|e| AppError::Spawn {
        program: program.to_string(),
        message: e.to_string(),
    })?;
    let pid = child.id();
    *handle.pid.lock().unwrap() = pid;

    let mut readers = Vec::new();
    if let Some(stdout) = child.stdout.take() {
        readers.push(tokio::spawn(pump(stdout, Stream::Stdout, out.clone())));
    }
    if let Some(stderr) = child.stderr.take() {
        readers.push(tokio::spawn(pump(stderr, Stream::Stderr, out.clone())));
    }

    let finished = tokio::select! {
        status = child.wait() => Some(status),
        _ = handle.cancelled() => None,
    };
    let status = match finished {
        Some(status) => status,
        None => {
            if let Some(pid) = pid {
                terminate_tree(pid).await;
            }
            if tokio::time::timeout(KILL_GRACE, child.wait()).await.is_err() {
                if let Some(pid) = pid {
                    kill_tree(pid).await;
                }
            }
            child.wait().await
        }
    };
    *handle.pid.lock().unwrap() = None;

    // A surviving grandchild may keep the pipes open; don't wait for EOF forever.
    for reader in readers {
        let abort = reader.abort_handle();
        if tokio::time::timeout(Duration::from_secs(2), reader).await.is_err() {
            abort.abort();
        }
    }

    handle.check()?;
    Ok(status?)
}

#[cfg(unix)]
async fn terminate_tree(pid: u32) {
    signal_group(pid, libc::SIGTERM);
}

#[cfg(unix)]
async fn kill_tree(pid: u32) {
    signal_group(pid, libc::SIGKILL);
}

#[cfg(unix)]
fn signal_group(pid: u32, signal: libc::c_int) {
    // The task was spawned with process_group(0), so its pgid equals its pid.
    if let Ok(pgid) = libc::pid_t::try_from(pid) {
        if pgid > 1 {
            unsafe {
                libc::kill(-pgid, signal);
            }
        }
    }
}

#[cfg(windows)]
async fn terminate_tree(pid: u32) {
    // Console processes without a window can't be asked politely; go straight to /F.
    kill_tree(pid).await;
}

#[cfg(windows)]
async fn kill_tree(pid: u32) {
    let mut cmd = command("taskkill");
    cmd.args(["/PID", &pid.to_string(), "/T", "/F"]);
    let _ = run_capture(cmd, "taskkill", Duration::from_secs(10)).await;
}

/// Stops the running task. Returns false if nothing was running.
#[tauri::command]
pub async fn stop_task(state: tauri::State<'_, TaskState>) -> AppResult<bool> {
    let current = state.current.lock().unwrap().clone();
    match current {
        Some(handle) => {
            // run_streaming is waiting on this and kills the tree.
            handle.cancel.send_replace(true);
            Ok(true)
        }
        None => Ok(false),
    }
}
