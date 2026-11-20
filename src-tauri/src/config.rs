use std::time::Duration;

use serde::{Deserialize, Serialize};

use crate::error::{AppError, AppResult};

/// Entries with these names are not shown in the file tree.
pub const HIDDEN_DIRS: &[&str] = &[
    ".git",
    ".gradle",
    ".idea",
    "build",
    ".kotlin",
    "node_modules",
    ".DS_Store",
];

pub const GIT_TIMEOUT: Duration = Duration::from_secs(30);
pub const ADB_TIMEOUT: Duration = Duration::from_secs(15);
/// Per-device helper calls (`emu avd name`, `getprop`) must not hang the whole list.
pub const ADB_QUERY_TIMEOUT: Duration = Duration::from_secs(4);
pub const EMULATOR_BOOT_TIMEOUT: Duration = Duration::from_secs(300);
pub const EMULATOR_POLL_INTERVAL: Duration = Duration::from_secs(2);
/// How long a task gets to exit after SIGTERM before SIGKILL.
pub const KILL_GRACE: Duration = Duration::from_secs(3);
pub const GIT_LOG_MAX_LIMIT: u32 = 5000;

/// Which Gradle module and variant Build/Run operate on.
/// There is no UI for it yet; the frontend sends nothing and gets the defaults.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", default)]
pub struct BuildConfig {
    pub module: String,
    pub variant: String,
}

impl Default for BuildConfig {
    fn default() -> Self {
        Self {
            module: "app".into(),
            variant: "debug".into(),
        }
    }
}

impl BuildConfig {
    /// module/variant end up inside a Gradle task name, so only identifier characters pass.
    pub fn validate(&self) -> AppResult<()> {
        let ok = |s: &str, extra: &[char]| {
            !s.is_empty()
                && s.chars()
                    .all(|c| c.is_ascii_alphanumeric() || "_-.".contains(c) || extra.contains(&c))
                && !s.starts_with('-')
        };
        if !ok(&self.module, &[':']) {
            return Err(AppError::InvalidArgument(format!("module «{}»", self.module)));
        }
        if !ok(&self.variant, &[]) {
            return Err(AppError::InvalidArgument(format!("variant «{}»", self.variant)));
        }
        Ok(())
    }

    /// `:app:assembleDebug`
    pub fn task(&self, action: &str) -> String {
        let mut chars = self.variant.chars();
        let variant = match chars.next() {
            Some(first) => first.to_ascii_uppercase().to_string() + chars.as_str(),
            None => String::new(),
        };
        format!(":{}:{}{}", self.module.trim_matches(':'), action, variant)
    }

    /// `app/build/outputs/apk/debug/output-metadata.json`, relative to the project root.
    pub fn output_metadata_path(&self) -> std::path::PathBuf {
        let mut p = std::path::PathBuf::new();
        for part in self.module.split(':').filter(|s| !s.is_empty()) {
            p.push(part);
        }
        p.join("build")
            .join("outputs")
            .join("apk")
            .join(&self.variant)
            .join("output-metadata.json")
    }
}
