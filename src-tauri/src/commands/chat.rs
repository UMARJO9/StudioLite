//! Chat with a command-line coding agent.
//!
//! Each message runs the configured CLI once in non-interactive mode inside the project
//! folder; the conversation is continued by passing the session id the CLI reported.
//! The CLI prints one JSON object per line, which is forwarded to the frontend as is —
//! the frontend owns the protocol. Which program to run is a local setting, not code.

use std::collections::HashMap;
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Instant;

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;

use crate::commands::fs::project_dir;
use crate::commands::process::{
    TaskEvent, TaskHandle, TaskOutput, command as new_command, run_streaming_with_input,
};
use crate::error::{AppError, AppResult};

/// Chats that are waiting for an answer, by chat id. Several may run at once.
#[derive(Default)]
pub struct ChatState {
    running: Mutex<HashMap<String, Arc<TaskHandle>>>,
}

/// Removes the chat from `ChatState` when its request ends, however it ends.
struct RunningChat<'a> {
    state: &'a ChatState,
    id: String,
    handle: Arc<TaskHandle>,
}

impl ChatState {
    fn begin(&self, id: &str) -> AppResult<RunningChat<'_>> {
        let mut running = self.running.lock().unwrap();
        if running.contains_key(id) {
            return Err(AppError::ChatBusy);
        }
        let handle = Arc::new(TaskHandle::default());
        running.insert(id.to_string(), handle.clone());
        Ok(RunningChat {
            state: self,
            id: id.to_string(),
            handle,
        })
    }
}

impl Drop for RunningChat<'_> {
    fn drop(&mut self) {
        self.state.running.lock().unwrap().remove(&self.id);
    }
}

/// What the agent may do on its own. Nobody can answer a permission prompt in
/// non-interactive mode, so whatever a mode would ask about is refused.
#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatAccess {
    /// Read and search the project; edits and shell commands are refused.
    ReadOnly,
    /// Investigate and propose a plan without changing anything.
    Plan,
    /// Also create and edit files in the project.
    EditFiles,
    /// The CLI's own classifier decides which actions are safe to run.
    Auto,
}

impl ChatAccess {
    fn permission_mode(self) -> &'static str {
        match self {
            ChatAccess::ReadOnly => "manual",
            ChatAccess::Plan => "plan",
            ChatAccess::EditFiles => "acceptEdits",
            ChatAccess::Auto => "auto",
        }
    }
}

#[derive(Debug, Clone, Copy, Deserialize)]
#[serde(rename_all = "camelCase")]
pub enum ChatEffort {
    Low,
    Medium,
    High,
    Xhigh,
    Max,
}

impl ChatEffort {
    fn as_arg(self) -> &'static str {
        match self {
            ChatEffort::Low => "low",
            ChatEffort::Medium => "medium",
            ChatEffort::High => "high",
            ChatEffort::Xhigh => "xhigh",
            ChatEffort::Max => "max",
        }
    }
}

/// Model names come from local settings and go on the command line.
fn is_valid_model(model: &str) -> bool {
    (1..=100).contains(&model.len())
        && !model.starts_with('-')
        && model
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-:[]".contains(c))
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ChatRunResult {
    pub exit_code: Option<i32>,
    pub cancelled: bool,
    pub duration_ms: u64,
}

fn executable_names(name: &str) -> Vec<String> {
    if cfg!(windows) {
        vec![format!("{name}.exe"), format!("{name}.cmd"), name.to_string()]
    } else {
        vec![name.to_string()]
    }
}

/// Folders where user-installed command-line tools usually live. A desktop app started
/// from the Dock or Explorer does not get the shell's PATH, so these are searched too.
fn extra_bin_dirs() -> Vec<PathBuf> {
    let mut dirs = Vec::new();
    if let Some(home) = std::env::home_dir() {
        dirs.push(home.join(".local").join("bin"));
        dirs.push(home.join("bin"));
        dirs.push(home.join(".npm-global").join("bin"));
        if cfg!(windows) {
            dirs.push(home.join("AppData").join("Roaming").join("npm"));
        }
    }
    if !cfg!(windows) {
        dirs.push(PathBuf::from("/opt/homebrew/bin"));
        dirs.push(PathBuf::from("/usr/local/bin"));
    }
    dirs
}

fn search_dirs() -> Vec<PathBuf> {
    let mut dirs: Vec<PathBuf> = std::env::var_os("PATH")
        .map(|path| std::env::split_paths(&path).collect())
        .unwrap_or_default();
    for dir in extra_bin_dirs() {
        if !dirs.contains(&dir) {
            dirs.push(dir);
        }
    }
    dirs
}

/// Resolves the configured program: either an absolute path to a file or a bare
/// executable name. Anything else (arguments, shell syntax, relative paths) is rejected.
fn resolve_cli(configured: &str) -> AppResult<PathBuf> {
    let configured = configured.trim();
    let not_found = || AppError::ChatCliNotFound(configured.to_string());
    if configured.is_empty() {
        return Err(not_found());
    }
    let as_path = Path::new(configured);
    if as_path.is_absolute() {
        return if as_path.is_file() {
            Ok(as_path.to_path_buf())
        } else {
            Err(not_found())
        };
    }
    let bare_name = configured
        .chars()
        .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
        && !configured.starts_with('-');
    if !bare_name {
        return Err(AppError::InvalidArgument(format!(
            "«{configured}»: нужно имя программы или полный путь к ней, без аргументов"
        )));
    }
    search_dirs()
        .into_iter()
        .flat_map(|dir| {
            executable_names(configured)
                .into_iter()
                .map(move |name| dir.join(name))
        })
        .find(|candidate| candidate.is_file())
        .ok_or_else(not_found)
}

/// Session ids are UUIDs; this keeps anything else off the command line.
fn is_valid_session_id(id: &str) -> bool {
    (8..=64).contains(&id.len()) && id.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

/// Checks that the configured program can be found and returns its full path.
#[tauri::command]
pub async fn chat_check(command: String) -> AppResult<String> {
    Ok(resolve_cli(&command)?.to_string_lossy().into_owned())
}

/// Sends one message and streams the CLI's JSON lines back until it exits.
#[tauri::command]
#[allow(clippy::too_many_arguments)]
pub async fn chat_send(
    project: String,
    chat_id: String,
    command: String,
    prompt: String,
    session_id: Option<String>,
    access: ChatAccess,
    model: Option<String>,
    effort: Option<ChatEffort>,
    on_event: Channel<TaskEvent>,
    state: tauri::State<'_, ChatState>,
) -> AppResult<ChatRunResult> {
    let project = project_dir(&project)?;
    let program = resolve_cli(&command)?;
    if prompt.trim().is_empty() {
        return Err(AppError::InvalidArgument("пустое сообщение".into()));
    }

    let mut cmd = new_command(&program);
    cmd.current_dir(&project).args([
        "--print",
        "--output-format",
        "stream-json",
        "--verbose",
        "--include-partial-messages",
        "--permission-mode",
        access.permission_mode(),
        // Nothing can answer a prompt here: refuse instead of waiting.
        "--permission-prompts",
        "none",
    ]);
    if let Some(model) = model.as_deref().map(str::trim).filter(|m| !m.is_empty()) {
        if !is_valid_model(model) {
            return Err(AppError::InvalidArgument(format!("модель «{model}»")));
        }
        cmd.args(["--model", model]);
    }
    if let Some(effort) = effort {
        cmd.args(["--effort", effort.as_arg()]);
    }
    if let Some(session) = session_id.as_deref().filter(|s| !s.is_empty()) {
        if !is_valid_session_id(session) {
            return Err(AppError::InvalidArgument(format!("сессия «{session}»")));
        }
        cmd.args(["--resume", session]);
    }
    // The agent runs git, node and friends itself and needs the same PATH we searched.
    if let Ok(path) = std::env::join_paths(search_dirs()) {
        cmd.env("PATH", path);
    }

    let running = state.begin(&chat_id)?;
    let started = Instant::now();
    let (out, forwarder) = TaskOutput::start(on_event);
    // The prompt goes through stdin: it can be long and may start with a dash.
    let result = run_streaming_with_input(
        cmd,
        &program.to_string_lossy(),
        &running.handle,
        &out,
        Some(prompt.into_bytes()),
    )
    .await;
    drop(out);
    let _ = forwarder.await;

    let duration_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(status) => Ok(ChatRunResult {
            exit_code: status.code(),
            cancelled: false,
            duration_ms,
        }),
        Err(AppError::Cancelled) => Ok(ChatRunResult {
            exit_code: None,
            cancelled: true,
            duration_ms,
        }),
        Err(e) => Err(e),
    }
}

/// Interrupts the answer of one chat. Returns false if it was not running.
#[tauri::command]
pub async fn chat_stop(chat_id: String, state: tauri::State<'_, ChatState>) -> AppResult<bool> {
    match state.running.lock().unwrap().get(&chat_id) {
        Some(handle) => {
            handle.cancel();
            Ok(true)
        }
        None => Ok(false),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_commands_with_arguments_or_shell_syntax() {
        for bad in ["tool --flag", "a;b", "$(x)", "../tool", "-rf", "a|b"] {
            assert!(
                matches!(resolve_cli(bad), Err(AppError::InvalidArgument(_))),
                "{bad} must be rejected"
            );
        }
        assert!(matches!(resolve_cli("  "), Err(AppError::ChatCliNotFound(_))));
        assert!(matches!(
            resolve_cli("no-such-program-studiolite"),
            Err(AppError::ChatCliNotFound(_))
        ));
    }

    #[cfg(unix)]
    #[test]
    fn finds_a_bare_name_on_path_and_accepts_an_absolute_path() {
        let found = resolve_cli("sh").unwrap();
        assert!(found.is_absolute() && found.is_file());
        assert_eq!(resolve_cli(&found.to_string_lossy()).unwrap(), found);
        assert!(matches!(
            resolve_cli("/definitely/not/here"),
            Err(AppError::ChatCliNotFound(_))
        ));
    }

    /// The prompt must reach the program through stdin, and its output must come back as lines.
    #[cfg(unix)]
    #[tokio::test]
    async fn prompt_is_piped_to_stdin_and_output_streamed_back() {
        use tauri::ipc::InvokeResponseBody;

        let events = Arc::new(Mutex::new(Vec::<String>::new()));
        let sink = events.clone();
        let channel = Channel::new(move |body| {
            if let InvokeResponseBody::Json(json) = body {
                sink.lock().unwrap().push(json);
            }
            Ok(())
        });
        let (out, forwarder) = TaskOutput::start(channel);
        let handle = TaskHandle::default();
        let status = run_streaming_with_input(
            new_command("cat"),
            "cat",
            &handle,
            &out,
            Some(b"--not-a-flag\n{\"type\":\"result\"}\n".to_vec()),
        )
        .await
        .unwrap();
        drop(out);
        forwarder.await.unwrap();

        assert!(status.success());
        let log = events.lock().unwrap().join("\n");
        assert!(log.contains("--not-a-flag"), "{log}");
        assert!(log.contains(r#"{\"type\":\"result\"}"#), "{log}");
    }

    #[test]
    fn validates_model_names() {
        assert!(is_valid_model("some-model-5-5"));
        assert!(is_valid_model("vendor.model-v2:0[1m]"));
        assert!(!is_valid_model("--dangerously-skip-permissions"));
        assert!(!is_valid_model("a b"));
        assert!(!is_valid_model(""));
    }

    #[test]
    fn validates_session_ids() {
        assert!(is_valid_session_id("e985accf-53a1-4cdd-b510-2790be8872d6"));
        assert!(!is_valid_session_id("--dangerously"));
        assert!(!is_valid_session_id("abc"));
        assert!(!is_valid_session_id("e985accf 53a1"));
    }

    #[test]
    fn only_one_request_per_chat_but_chats_are_independent() {
        let state = ChatState::default();
        let first = state.begin("a").unwrap();
        assert!(matches!(state.begin("a"), Err(AppError::ChatBusy)));
        assert!(state.begin("b").is_ok());
        drop(first);
        assert!(state.begin("a").is_ok());
    }
}
