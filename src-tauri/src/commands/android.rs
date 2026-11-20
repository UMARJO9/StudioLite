use std::path::Path;
use std::process::Stdio;
use std::time::{Duration, Instant};

use serde::Serialize;
use tauri::ipc::Channel;

use crate::commands::process::{TaskHandle, command, run_capture};
use crate::commands::sdk::{self, Sdk};
use crate::config::{ADB_QUERY_TIMEOUT, ADB_TIMEOUT, EMULATOR_BOOT_TIMEOUT, EMULATOR_POLL_INTERVAL};
use crate::error::{AppError, AppResult};

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceKind {
    Emulator,
    Physical,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum DeviceState {
    Online,
    Offline,
    Unauthorized,
    /// An AVD that exists but is not running.
    Stopped,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct Device {
    /// Serial for connected devices, `avd:<name>` for AVDs that are not running.
    pub id: String,
    pub kind: DeviceKind,
    pub name: String,
    pub serial: Option<String>,
    pub avd: Option<String>,
    pub state: DeviceState,
}

#[derive(Debug, PartialEq)]
struct AdbDevice {
    serial: String,
    state: DeviceState,
    model: Option<String>,
}

impl AdbDevice {
    fn is_emulator(&self) -> bool {
        self.serial.starts_with("emulator-")
    }
}

fn parse_adb_devices(output: &str) -> Vec<AdbDevice> {
    output
        .lines()
        .map(str::trim)
        .filter(|l| !l.is_empty() && !l.starts_with('*') && !l.starts_with("List of devices"))
        .filter_map(|line| {
            let mut parts = line.split_whitespace();
            let serial = parts.next()?.to_string();
            let state = match parts.next()? {
                "device" => DeviceState::Online,
                "unauthorized" => DeviceState::Unauthorized,
                _ => DeviceState::Offline,
            };
            let model = parts
                .find_map(|kv| kv.strip_prefix("model:"))
                .map(|m| m.replace('_', " "));
            Some(AdbDevice {
                serial,
                state,
                model,
            })
        })
        .collect()
}

/// AVD names go on the emulator's command line, so only plain identifier characters pass.
fn is_valid_avd_name(name: &str) -> bool {
    !name.is_empty()
        && !name.starts_with('-')
        && name
            .chars()
            .all(|c| c.is_ascii_alphanumeric() || "._-".contains(c))
}

fn display_name(avd: &str) -> String {
    avd.replace('_', " ")
}

async fn adb_devices(sdk: &Sdk) -> AppResult<Vec<AdbDevice>> {
    let mut cmd = command(&sdk.adb);
    cmd.args(["devices", "-l"]);
    // The first call may have to start the adb server, hence the generous timeout.
    let out = run_capture(cmd, "adb", ADB_TIMEOUT).await?;
    if !out.status.success() {
        return Err(AppError::Adb(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    Ok(parse_adb_devices(&String::from_utf8_lossy(&out.stdout)))
}

/// Name of the AVD behind a running emulator; None if its console does not answer.
async fn avd_name(sdk: &Sdk, serial: &str) -> Option<String> {
    let mut cmd = command(&sdk.adb);
    cmd.args(["-s", serial, "emu", "avd", "name"]);
    let out = run_capture(cmd, "adb", ADB_QUERY_TIMEOUT).await.ok()?;
    if !out.status.success() {
        return None;
    }
    String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .find(|l| !l.is_empty() && *l != "OK")
        .map(str::to_string)
}

async fn list_avds(emulator: &Path) -> AppResult<Vec<String>> {
    let mut cmd = command(emulator);
    cmd.arg("-list-avds");
    let out = run_capture(cmd, "emulator", ADB_TIMEOUT).await?;
    if !out.status.success() {
        return Err(AppError::Emulator(
            String::from_utf8_lossy(&out.stderr).trim().to_string(),
        ));
    }
    // The emulator may print INFO/WARNING lines next to the names.
    Ok(String::from_utf8_lossy(&out.stdout)
        .lines()
        .map(str::trim)
        .filter(|l| is_valid_avd_name(l))
        .map(str::to_string)
        .collect())
}

#[tauri::command]
pub async fn list_devices(project: Option<String>) -> AppResult<Vec<Device>> {
    let sdk = sdk::locate_for(project.as_deref())?;
    let mut devices = Vec::new();
    let mut running_avds = Vec::new();

    for dev in adb_devices(&sdk).await? {
        if dev.is_emulator() {
            let avd = avd_name(&sdk, &dev.serial).await;
            if let Some(avd) = &avd {
                running_avds.push(avd.clone());
            }
            devices.push(Device {
                id: dev.serial.clone(),
                kind: DeviceKind::Emulator,
                name: avd
                    .as_deref()
                    .map(display_name)
                    .unwrap_or_else(|| dev.serial.clone()),
                serial: Some(dev.serial),
                avd,
                state: dev.state,
            });
        } else {
            devices.push(Device {
                id: dev.serial.clone(),
                kind: DeviceKind::Physical,
                name: dev.model.unwrap_or_else(|| dev.serial.clone()),
                serial: Some(dev.serial),
                avd: None,
                state: dev.state,
            });
        }
    }

    if let Some(emulator) = &sdk.emulator {
        for avd in list_avds(emulator).await? {
            if running_avds.contains(&avd) {
                continue;
            }
            devices.push(Device {
                id: format!("avd:{avd}"),
                kind: DeviceKind::Emulator,
                name: display_name(&avd),
                serial: None,
                avd: Some(avd),
                state: DeviceState::Stopped,
            });
        }
    }
    Ok(devices)
}

// ---------------------------------------------------------------------------
// Starting an emulator
// ---------------------------------------------------------------------------

#[derive(Debug, Clone, Copy, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum BootStage {
    Launching,
    WaitingForDevice,
    Booting,
    Ready,
}

#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct BootEvent {
    pub stage: BootStage,
    pub serial: Option<String>,
    pub elapsed_secs: u64,
}

/// Starts the emulator so that it outlives StudioLite: own session on Unix,
/// detached from our console and process group on Windows, no inherited pipes.
fn spawn_detached(sdk: &Sdk, emulator: &Path, avd: &str) -> AppResult<std::process::Child> {
    let mut cmd = std::process::Command::new(emulator);
    cmd.args(["-avd", avd])
        .env("ANDROID_SDK_ROOT", &sdk.root)
        .env("ANDROID_HOME", &sdk.root)
        .stdin(Stdio::null())
        .stdout(Stdio::null())
        .stderr(Stdio::null());
    #[cfg(unix)]
    {
        use std::os::unix::process::CommandExt;
        // SAFETY: setsid is async-signal-safe and touches nothing but the child itself.
        unsafe {
            cmd.pre_exec(|| {
                libc::setsid();
                Ok(())
            });
        }
    }
    #[cfg(windows)]
    {
        use std::os::windows::process::CommandExt;
        const DETACHED_PROCESS: u32 = 0x0000_0008;
        const CREATE_NEW_PROCESS_GROUP: u32 = 0x0000_0200;
        cmd.creation_flags(DETACHED_PROCESS | CREATE_NEW_PROCESS_GROUP);
    }
    cmd.spawn().map_err(|e| AppError::Spawn {
        program: "emulator".into(),
        message: e.to_string(),
    })
}

async fn find_running_avd(sdk: &Sdk, avd: &str) -> AppResult<Option<AdbDevice>> {
    for dev in adb_devices(sdk).await? {
        if dev.is_emulator() && avd_name(sdk, &dev.serial).await.as_deref() == Some(avd) {
            return Ok(Some(dev));
        }
    }
    Ok(None)
}

async fn boot_completed(sdk: &Sdk, serial: &str) -> bool {
    let mut cmd = command(&sdk.adb);
    cmd.args(["-s", serial, "shell", "getprop", "sys.boot_completed"]);
    match run_capture(cmd, "adb", ADB_QUERY_TIMEOUT).await {
        Ok(out) => String::from_utf8_lossy(&out.stdout).trim() == "1",
        Err(_) => false,
    }
}

async fn pause(cancel: Option<&TaskHandle>, duration: Duration) -> AppResult<()> {
    match cancel {
        Some(handle) => tokio::select! {
            _ = tokio::time::sleep(duration) => Ok(()),
            _ = handle.cancelled() => Err(AppError::Cancelled),
        },
        None => {
            tokio::time::sleep(duration).await;
            Ok(())
        }
    }
}

/// Starts `avd` (unless it is already running) and waits until Android has booted.
/// Returns the emulator's serial. Cancelling stops the wait but leaves the emulator running.
pub async fn boot_avd(
    sdk: &Sdk,
    avd: &str,
    cancel: Option<&TaskHandle>,
    mut progress: impl FnMut(BootEvent),
) -> AppResult<String> {
    if !is_valid_avd_name(avd) {
        return Err(AppError::InvalidArgument(format!("имя AVD «{avd}»")));
    }
    let started = Instant::now();
    let mut event = |stage: BootStage, serial: Option<&str>| {
        progress(BootEvent {
            stage,
            serial: serial.map(str::to_string),
            elapsed_secs: started.elapsed().as_secs(),
        })
    };

    let mut child = None;
    if find_running_avd(sdk, avd).await?.is_none() {
        let emulator = sdk
            .emulator
            .as_deref()
            .ok_or_else(|| AppError::SdkToolMissing("emulator".into()))?;
        event(BootStage::Launching, None);
        child = Some(spawn_detached(sdk, emulator, avd)?);
    }

    let result = loop {
        if started.elapsed() > EMULATOR_BOOT_TIMEOUT {
            break Err(AppError::Timeout(format!(
                "эмулятор «{avd}» не загрузился за {} с",
                EMULATOR_BOOT_TIMEOUT.as_secs()
            )));
        }
        match find_running_avd(sdk, avd).await? {
            Some(dev) if dev.state == DeviceState::Online => {
                if boot_completed(sdk, &dev.serial).await {
                    event(BootStage::Ready, Some(&dev.serial));
                    break Ok(dev.serial);
                }
                event(BootStage::Booting, Some(&dev.serial));
            }
            Some(dev) => event(BootStage::Booting, Some(&dev.serial)),
            None => {
                // No device yet: if the launcher has already died, there never will be one.
                if let Some(Ok(Some(status))) = child.as_mut().map(|c| c.try_wait()) {
                    if !status.success() {
                        break Err(AppError::Emulator(format!(
                            "процесс эмулятора «{avd}» завершился ({status}). \
                             Проверьте AVD в Device Manager"
                        )));
                    }
                }
                event(BootStage::WaitingForDevice, None);
            }
        }
        if let Err(e) = pause(cancel, EMULATOR_POLL_INTERVAL).await {
            break Err(e);
        }
    };

    // Reap the launcher whenever it exits, without tying its lifetime to ours.
    if let Some(mut child) = child {
        std::thread::spawn(move || {
            let _ = child.wait();
        });
    }
    result
}

/// Starts an AVD from the device selector. Resolves with the serial once booted.
#[tauri::command]
pub async fn start_avd(
    project: Option<String>,
    avd: String,
    on_event: Channel<BootEvent>,
) -> AppResult<String> {
    let sdk = sdk::locate_for(project.as_deref())?;
    boot_avd(&sdk, &avd, None, |event| {
        let _ = on_event.send(event);
    })
    .await
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn parses_adb_devices_output() {
        let out = "List of devices attached\n\
                   emulator-5554          device product:sdk_gphone64_arm64 model:sdk_gphone64_arm64 device:emu64a transport_id:1\n\
                   R58M12345AB            unauthorized usb:1-1 transport_id:2\n\
                   0A1B2C3D               device usb:2-1 product:panther model:Pixel_7 device:panther transport_id:3\n\
                   emulator-5556          offline transport_id:4\n\n";
        let devices = parse_adb_devices(out);
        assert_eq!(devices.len(), 4);
        assert!(devices[0].is_emulator());
        assert_eq!(devices[0].state, DeviceState::Online);
        assert_eq!(devices[1].state, DeviceState::Unauthorized);
        assert_eq!(devices[1].model, None);
        assert_eq!(devices[2].model.as_deref(), Some("Pixel 7"));
        assert!(!devices[2].is_emulator());
        assert_eq!(devices[3].state, DeviceState::Offline);
    }

    #[test]
    fn ignores_daemon_startup_noise() {
        let out = "* daemon not running; starting now at tcp:5037\n* daemon started successfully\nList of devices attached\n\n";
        assert!(parse_adb_devices(out).is_empty());
    }

    #[test]
    fn rejects_avd_names_that_could_be_options() {
        assert!(is_valid_avd_name("Pixel_7"));
        assert!(is_valid_avd_name("Pixel_7_API_34.2-ext"));
        assert!(!is_valid_avd_name("-wipe-data"));
        assert!(!is_valid_avd_name("a b"));
        assert!(!is_valid_avd_name("INFO | something"));
        assert!(!is_valid_avd_name(""));
    }
}
