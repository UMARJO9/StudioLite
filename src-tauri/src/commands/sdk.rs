use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::fs::project_dir;
use crate::error::{AppError, AppResult};

pub struct Sdk {
    pub root: PathBuf,
    pub adb: PathBuf,
    /// The emulator package is optional: a machine may only ever use physical devices.
    pub emulator: Option<PathBuf>,
    /// Where the path came from, for diagnostics.
    pub source: String,
}

fn exe(name: &str) -> String {
    if cfg!(windows) {
        format!("{name}.exe")
    } else {
        name.to_string()
    }
}

/// `sdk.dir` from local.properties. Java properties escape `\` and `:` (`C\:\\Users\\me`).
fn sdk_dir_from_local_properties(project: &Path) -> Option<PathBuf> {
    let text = std::fs::read_to_string(project.join("local.properties")).ok()?;
    text.lines()
        .map(str::trim)
        .filter(|line| !line.starts_with('#') && !line.starts_with('!'))
        .find_map(|line| {
            let (key, value) = line.split_once('=')?;
            (key.trim() == "sdk.dir").then(|| unescape_property(value.trim()))
        })
        .filter(|value| !value.is_empty())
        .map(PathBuf::from)
}

fn unescape_property(value: &str) -> String {
    let mut out = String::with_capacity(value.len());
    let mut chars = value.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            if let Some(next) = chars.next() {
                out.push(next);
            }
        } else {
            out.push(c);
        }
    }
    out
}

fn default_locations() -> Vec<PathBuf> {
    let mut paths = Vec::new();
    let home = std::env::home_dir();
    if cfg!(target_os = "macos") {
        if let Some(home) = &home {
            paths.push(home.join("Library").join("Android").join("sdk"));
        }
    } else if cfg!(windows) {
        if let Some(local) = std::env::var_os("LOCALAPPDATA") {
            paths.push(PathBuf::from(local).join("Android").join("Sdk"));
        }
        if let Some(home) = &home {
            paths.push(home.join("AppData").join("Local").join("Android").join("Sdk"));
        }
    } else {
        if let Some(home) = &home {
            paths.push(home.join("Android").join("Sdk"));
        }
        paths.push(PathBuf::from("/usr/lib/android-sdk"));
        paths.push(PathBuf::from("/opt/android-sdk"));
    }
    paths
}

/// Search order: ANDROID_HOME, ANDROID_SDK_ROOT, sdk.dir of the project, OS defaults.
pub fn locate(project: Option<&Path>) -> AppResult<Sdk> {
    let mut candidates: Vec<(String, PathBuf)> = Vec::new();
    for var in ["ANDROID_HOME", "ANDROID_SDK_ROOT"] {
        if let Some(value) = std::env::var_os(var).filter(|v| !v.is_empty()) {
            candidates.push((var.to_string(), PathBuf::from(value)));
        }
    }
    if let Some(dir) = project.and_then(sdk_dir_from_local_properties) {
        candidates.push(("local.properties".to_string(), dir));
    }
    for dir in default_locations() {
        candidates.push(("стандартный путь".to_string(), dir));
    }

    let mut sdk_without_adb = false;
    for (source, root) in candidates {
        if !root.is_dir() {
            continue;
        }
        let adb = root.join("platform-tools").join(exe("adb"));
        if !adb.is_file() {
            sdk_without_adb = true;
            continue;
        }
        let emulator = root.join("emulator").join(exe("emulator"));
        return Ok(Sdk {
            emulator: emulator.is_file().then_some(emulator),
            adb,
            root,
            source,
        });
    }
    Err(if sdk_without_adb {
        AppError::SdkToolMissing("platform-tools (adb)".into())
    } else {
        AppError::SdkNotFound
    })
}

/// `project` is optional so devices can be listed before any project is open.
pub fn locate_for(project: Option<&str>) -> AppResult<Sdk> {
    let dir = project.and_then(|p| project_dir(p).ok());
    locate(dir.as_deref())
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct SdkInfo {
    pub path: String,
    pub adb: String,
    pub emulator: Option<String>,
    pub source: String,
}

#[tauri::command]
pub async fn find_sdk(project: Option<String>) -> AppResult<SdkInfo> {
    let sdk = locate_for(project.as_deref())?;
    Ok(SdkInfo {
        path: sdk.root.to_string_lossy().into_owned(),
        adb: sdk.adb.to_string_lossy().into_owned(),
        emulator: sdk.emulator.map(|p| p.to_string_lossy().into_owned()),
        source: sdk.source,
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unescapes_windows_sdk_dir() {
        assert_eq!(
            unescape_property(r"C\:\\Users\\me\\AppData\\Local\\Android\\Sdk"),
            r"C:\Users\me\AppData\Local\Android\Sdk"
        );
        assert_eq!(
            unescape_property("/Users/me/Library/Android/sdk"),
            "/Users/me/Library/Android/sdk"
        );
    }
}
