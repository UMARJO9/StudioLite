use std::path::{Path, PathBuf};
use std::process::ExitStatus;
use std::time::{Duration, Instant};

use serde::{Deserialize, Serialize};
use tauri::ipc::Channel;
use tokio::process::Command;

use crate::commands::android::{BootStage, boot_avd};
use crate::commands::fs::{gradlew_path, project_dir};
use crate::commands::process::{
    TaskEvent, TaskHandle, TaskOutput, TaskState, command, run_capture, run_streaming,
};
use crate::commands::sdk::{self, Sdk};
use crate::config::BuildConfig;
use crate::error::{AppError, AppResult};

#[derive(Debug, Deserialize)]
#[serde(tag = "kind", rename_all = "camelCase")]
pub enum RunTarget {
    /// A connected device or a running emulator.
    Device { serial: String },
    /// An AVD that has to be started first.
    Avd { name: String },
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct TaskResult {
    pub success: bool,
    pub cancelled: bool,
    pub exit_code: Option<i32>,
    pub duration_ms: u64,
    /// Device the app was deployed to (Run only).
    pub serial: Option<String>,
}

// ---------------------------------------------------------------------------
// Environment for Gradle
// ---------------------------------------------------------------------------

fn java_exe() -> &'static str {
    if cfg!(windows) { "java.exe" } else { "java" }
}

fn is_java_home(dir: &Path) -> bool {
    dir.join("bin").join(java_exe()).is_file()
}

fn java_on_path() -> bool {
    let Some(path) = std::env::var_os("PATH") else {
        return false;
    };
    std::env::split_paths(&path).any(|dir| {
        // macOS ships /usr/bin/java as a stub that only works when a system JDK is installed,
        // so its presence proves nothing.
        if cfg!(target_os = "macos") && dir == Path::new("/usr/bin") {
            return false;
        }
        dir.join(java_exe()).is_file()
    })
}

/// The JDK bundled with Android Studio, in its standard install locations.
fn android_studio_jbr() -> Option<PathBuf> {
    let home = std::env::home_dir();
    let mut candidates: Vec<PathBuf> = Vec::new();
    if cfg!(target_os = "macos") {
        let suffix = Path::new("Android Studio.app/Contents/jbr/Contents/Home");
        candidates.push(Path::new("/Applications").join(suffix));
        if let Some(home) = &home {
            candidates.push(home.join("Applications").join(suffix));
        }
    } else if cfg!(windows) {
        for var in ["ProgramFiles", "LOCALAPPDATA"] {
            if let Some(base) = std::env::var_os(var) {
                let base = PathBuf::from(base);
                candidates.push(base.join("Android").join("Android Studio").join("jbr"));
                candidates.push(base.join("Programs").join("Android Studio").join("jbr"));
            }
        }
    } else {
        candidates.push(PathBuf::from("/opt/android-studio/jbr"));
        candidates.push(PathBuf::from("/usr/local/android-studio/jbr"));
        candidates.push(PathBuf::from("/snap/android-studio/current/android-studio/jbr"));
        if let Some(home) = &home {
            candidates.push(home.join("android-studio").join("jbr"));
        }
    }
    candidates.into_iter().find(|dir| is_java_home(dir))
}

/// A desktop app started from Finder/Explorer does not inherit the shell's environment.
/// If no usable Java is visible, fall back to the JDK Android Studio itself builds with.
fn fallback_java_home() -> Option<PathBuf> {
    let configured = std::env::var_os("JAVA_HOME")
        .map(PathBuf::from)
        .is_some_and(|dir| is_java_home(&dir));
    if configured || java_on_path() {
        return None;
    }
    android_studio_jbr()
}

fn gradle_command(
    project: &Path,
    sdk: Option<&Sdk>,
    task: &str,
    out: &TaskOutput,
) -> AppResult<Command> {
    let gradlew = gradlew_path(project);
    if !gradlew.is_file() {
        return Err(AppError::GradlewNotFound);
    }
    // `sh gradlew` also works when the wrapper has lost its executable bit.
    #[cfg(unix)]
    let mut cmd = {
        let mut cmd = command("sh");
        cmd.arg(&gradlew);
        cmd
    };
    #[cfg(windows)]
    let mut cmd = command(&gradlew);

    cmd.current_dir(project).arg(task).arg("--console=plain");

    if let Some(java_home) = fallback_java_home() {
        out.info(format!(
            "JAVA_HOME не задан, используется JDK из Android Studio: {}",
            java_home.display()
        ));
        cmd.env("JAVA_HOME", java_home);
    }
    if let Some(sdk) = sdk
        && std::env::var_os("ANDROID_HOME").is_none_or(|v| v.is_empty()) {
            cmd.env("ANDROID_HOME", &sdk.root);
        }
    out.info(format!("> gradlew {task} --console=plain"));
    Ok(cmd)
}

fn exit_code(status: ExitStatus) -> i32 {
    // No code means the process was killed by a signal.
    status.code().unwrap_or(-1)
}

// ---------------------------------------------------------------------------
// Build
// ---------------------------------------------------------------------------

async fn build_steps(
    project: &Path,
    config: &BuildConfig,
    handle: &TaskHandle,
    out: &TaskOutput,
) -> AppResult<i32> {
    let task = config.task("assemble");
    out.stage(task.clone());
    let sdk = sdk::locate(Some(project)).ok();
    let cmd = gradle_command(project, sdk.as_ref(), &task, out)?;
    Ok(exit_code(run_streaming(cmd, "gradlew", handle, out).await?))
}

#[tauri::command]
pub async fn build_project(
    project: String,
    config: Option<BuildConfig>,
    on_event: Channel<TaskEvent>,
    state: tauri::State<'_, TaskState>,
) -> AppResult<TaskResult> {
    let project = project_dir(&project)?;
    let config = config.unwrap_or_default();
    config.validate()?;

    let guard = state.begin()?;
    let started = Instant::now();
    let (out, forwarder) = TaskOutput::start(on_event);
    let result = build_steps(&project, &config, &guard.handle, &out).await;
    drop(out);
    let _ = forwarder.await;
    finish(result, started, None)
}

// ---------------------------------------------------------------------------
// Run
// ---------------------------------------------------------------------------

fn is_valid_serial(serial: &str) -> bool {
    !serial.is_empty()
        && !serial.starts_with('-')
        && serial
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || ".:_-".contains(c))
}

fn is_valid_application_id(id: &str) -> bool {
    !id.is_empty()
        && !id.starts_with('-')
        && id
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._".contains(c))
}

/// Reads `applicationId` from the metadata AGP writes next to the APK.
fn read_application_id(project: &Path, config: &BuildConfig) -> AppResult<String> {
    let path = project.join(config.output_metadata_path());
    let text = std::fs::read_to_string(&path).map_err(|e| {
        AppError::Gradle(format!(
            "не удалось прочитать {}: {e}. Модуль «{}» должен быть Android-приложением",
            path.display(),
            config.module
        ))
    })?;
    let json: serde_json::Value = serde_json::from_str(&text)
        .map_err(|e| AppError::Gradle(format!("{}: {e}", path.display())))?;
    let id = json
        .get("applicationId")
        .and_then(|v| v.as_str())
        .unwrap_or_default();
    if !is_valid_application_id(id) {
        return Err(AppError::Gradle(format!(
            "в {} нет корректного applicationId",
            path.display()
        )));
    }
    Ok(id.to_string())
}

async fn launch_app(sdk: &Sdk, serial: &str, application_id: &str, out: &TaskOutput) -> AppResult<()> {
    out.info(format!(
        "> adb -s {serial} shell monkey -p {application_id} -c android.intent.category.LAUNCHER 1"
    ));
    let mut cmd = command(&sdk.adb);
    cmd.args([
        "-s",
        serial,
        "shell",
        "monkey",
        "-p",
        application_id,
        "-c",
        "android.intent.category.LAUNCHER",
        "1",
    ]);
    let output = run_capture(cmd, "adb", Duration::from_secs(30)).await?;
    let text = format!(
        "{}{}",
        String::from_utf8_lossy(&output.stdout),
        String::from_utf8_lossy(&output.stderr)
    );
    for line in text.lines().filter(|l| !l.trim().is_empty()) {
        out.line(crate::commands::process::Stream::Stdout, line.trim_end());
    }
    // monkey exits with 0 even when it found nothing to start.
    if !output.status.success() || text.contains("monkey aborted") || text.contains("No activities found") {
        return Err(AppError::Adb(format!(
            "не удалось запустить {application_id}: нет launcher-activity или устройство недоступно"
        )));
    }
    Ok(())
}

async fn run_steps(
    project: &Path,
    target: RunTarget,
    config: &BuildConfig,
    handle: &TaskHandle,
    out: &TaskOutput,
    deployed_to: &mut Option<String>,
) -> AppResult<i32> {
    let sdk = sdk::locate(Some(project))?;

    let serial = match target {
        RunTarget::Device { serial } => {
            if !is_valid_serial(&serial) {
                return Err(AppError::InvalidArgument(format!("serial «{serial}»")));
            }
            serial
        }
        RunTarget::Avd { name } => {
            out.info(format!("> emulator -avd {name}"));
            let progress = out.clone();
            let label = name.clone();
            boot_avd(&sdk, &name, Some(handle), move |event| {
                let stage = match event.stage {
                    BootStage::Launching => "запуск",
                    BootStage::WaitingForDevice => "ожидание устройства",
                    BootStage::Booting => "загрузка Android",
                    BootStage::Ready => "готов",
                };
                progress.stage(format!("Эмулятор {label}: {stage}, {} с", event.elapsed_secs));
            })
            .await
            .inspect(|serial| out.info(format!("Эмулятор {name} загружен: {serial}")))?
        }
    };
    *deployed_to = Some(serial.clone());
    handle.check()?;

    let task = config.task("install");
    out.stage(task.clone());
    let mut cmd = gradle_command(project, Some(&sdk), &task, out)?;
    cmd.env("ANDROID_SERIAL", &serial);
    let code = exit_code(run_streaming(cmd, "gradlew", handle, out).await?);
    if code != 0 {
        return Ok(code);
    }

    handle.check()?;
    out.stage("Запуск приложения");
    let application_id = read_application_id(project, config)?;
    launch_app(&sdk, &serial, &application_id, out).await?;
    out.info(format!("Приложение {application_id} запущено на {serial}"));
    Ok(0)
}

#[tauri::command]
pub async fn run_project(
    project: String,
    target: RunTarget,
    config: Option<BuildConfig>,
    on_event: Channel<TaskEvent>,
    state: tauri::State<'_, TaskState>,
) -> AppResult<TaskResult> {
    let project = project_dir(&project)?;
    let config = config.unwrap_or_default();
    config.validate()?;

    let guard = state.begin()?;
    let started = Instant::now();
    let (out, forwarder) = TaskOutput::start(on_event);
    let mut serial = None;
    let result = run_steps(&project, target, &config, &guard.handle, &out, &mut serial).await;
    drop(out);
    let _ = forwarder.await;
    finish(result, started, serial)
}

/// A failed build is a normal outcome (`success: false`), cancellation too.
/// Only failures to run the task at all are returned as errors.
fn finish(result: AppResult<i32>, started: Instant, serial: Option<String>) -> AppResult<TaskResult> {
    let duration_ms = started.elapsed().as_millis() as u64;
    match result {
        Ok(code) => Ok(TaskResult {
            success: code == 0,
            cancelled: false,
            exit_code: Some(code),
            duration_ms,
            serial,
        }),
        Err(AppError::Cancelled) => Ok(TaskResult {
            success: false,
            cancelled: true,
            exit_code: None,
            duration_ms,
            serial,
        }),
        Err(e) => Err(e),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn default_config_targets_app_debug() {
        let config = BuildConfig::default();
        assert_eq!(config.task("assemble"), ":app:assembleDebug");
        assert_eq!(config.task("install"), ":app:installDebug");
        assert_eq!(
            config.output_metadata_path(),
            Path::new("app/build/outputs/apk/debug/output-metadata.json")
        );
    }

    #[test]
    fn config_rejects_anything_that_is_not_an_identifier() {
        let bad = |module: &str, variant: &str| {
            BuildConfig {
                module: module.into(),
                variant: variant.into(),
            }
            .validate()
            .is_err()
        };
        assert!(bad("app --init-script x", "debug"));
        assert!(bad("app", "debug;rm"));
        assert!(bad("", "debug"));
        assert!(bad("-app", "debug"));
        assert!(!bad("feature:login", "release"));
    }

    #[test]
    fn validates_serials_and_application_ids() {
        assert!(is_valid_serial("emulator-5554"));
        assert!(is_valid_serial("192.168.1.20:5555"));
        assert!(!is_valid_serial("-s"));
        assert!(!is_valid_serial("a b"));
        assert!(is_valid_application_id("com.example.app_dev"));
        assert!(!is_valid_application_id("com.example; reboot"));
    }
}
