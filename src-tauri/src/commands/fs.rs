use std::path::{Path, PathBuf};

use serde::Serialize;

use crate::commands::git;
use crate::config::{HIDDEN_DIRS, MAX_VIEW_BYTES};
use crate::error::{AppError, AppResult};

/// Canonical project directory; every command resolves its `project` argument through this.
pub fn project_dir(project: &str) -> AppResult<PathBuf> {
    let path = dunce::canonicalize(project).map_err(|_| AppError::InvalidPath(project.into()))?;
    if !path.is_dir() {
        return Err(AppError::InvalidPath(project.into()));
    }
    Ok(path)
}

/// Resolves `path` and makes sure it stays inside the project.
fn path_in_project(project: &str, path: &str) -> AppResult<PathBuf> {
    let root = project_dir(project)?;
    let target = dunce::canonicalize(path).map_err(|_| AppError::InvalidPath(path.into()))?;
    if !target.starts_with(&root) {
        return Err(AppError::InvalidPath(path.into()));
    }
    Ok(target)
}

pub fn gradlew_path(project: &Path) -> PathBuf {
    project.join(if cfg!(windows) { "gradlew.bat" } else { "gradlew" })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ProjectInfo {
    pub path: String,
    pub name: String,
    pub has_gradlew: bool,
    pub is_git_repo: bool,
    /// Differs from `path` when the project is a subfolder of a repository.
    pub git_root: Option<String>,
    /// False when the git executable itself could not be started.
    pub git_available: bool,
}

#[tauri::command]
pub async fn open_project(path: String) -> AppResult<ProjectInfo> {
    let dir = project_dir(&path)?;
    let name = dir
        .file_name()
        .map(|n| n.to_string_lossy().into_owned())
        .unwrap_or_else(|| dir.to_string_lossy().into_owned());
    let (git_root, git_available) = match git::toplevel(&dir).await {
        Ok(root) => (root, true),
        Err(_) => (None, false),
    };
    Ok(ProjectInfo {
        has_gradlew: gradlew_path(&dir).is_file(),
        is_git_repo: git_root.is_some(),
        git_root: git_root.map(|p| p.to_string_lossy().into_owned()),
        git_available,
        name,
        path: dir.to_string_lossy().into_owned(),
    })
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileEntry {
    pub name: String,
    pub path: String,
    pub is_dir: bool,
}

/// One level of the tree: directories first, then files, both sorted by name.
#[tauri::command]
pub async fn read_dir(project: String, path: String) -> AppResult<Vec<FileEntry>> {
    let dir = path_in_project(&project, &path)?;
    let mut entries: Vec<FileEntry> = std::fs::read_dir(&dir)?
        .filter_map(Result::ok)
        .filter_map(|entry| {
            let name = entry.file_name().to_string_lossy().into_owned();
            if HIDDEN_DIRS.contains(&name.as_str()) {
                return None;
            }
            let path = entry.path();
            Some(FileEntry {
                // Follows symlinks, so a linked directory can be expanded.
                is_dir: path.is_dir(),
                path: path.to_string_lossy().into_owned(),
                name,
            })
        })
        .collect();
    entries.sort_by(|a, b| {
        b.is_dir
            .cmp(&a.is_dir)
            .then_with(|| a.name.to_lowercase().cmp(&b.name.to_lowercase()))
            .then_with(|| a.name.cmp(&b.name))
    });
    Ok(entries)
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct FileContent {
    pub path: String,
    /// Empty for binary files.
    pub content: String,
    pub size: u64,
    /// Only the first `MAX_VIEW_BYTES` were read.
    pub truncated: bool,
    pub binary: bool,
}

/// Text of a project file for the read-only viewer.
#[tauri::command]
pub async fn read_file(project: String, path: String) -> AppResult<FileContent> {
    use std::io::Read;

    let target = path_in_project(&project, &path)?;
    if !target.is_file() {
        return Err(AppError::InvalidPath(path));
    }
    let size = target.metadata()?.len();
    let mut bytes = Vec::new();
    std::fs::File::open(&target)?
        .take(MAX_VIEW_BYTES)
        .read_to_end(&mut bytes)?;
    // Same heuristic git uses: a NUL byte near the start means "not text".
    let binary = bytes.iter().take(8000).any(|b| *b == 0);
    Ok(FileContent {
        path: target.to_string_lossy().into_owned(),
        content: if binary {
            String::new()
        } else {
            String::from_utf8_lossy(&bytes).into_owned()
        },
        size,
        truncated: size > MAX_VIEW_BYTES,
        binary,
    })
}

/// Opens a file with the default application.
#[tauri::command]
pub async fn open_in_system(project: String, path: String) -> AppResult<()> {
    let target = path_in_project(&project, &path)?;
    tauri_plugin_opener::open_path(target, None::<&str>).map_err(|e| AppError::Io(e.to_string()))
}

/// Shows the item in Finder / Explorer / the file manager.
#[tauri::command]
pub async fn reveal_in_file_manager(project: String, path: String) -> AppResult<()> {
    let target = path_in_project(&project, &path)?;
    tauri_plugin_opener::reveal_item_in_dir(target).map_err(|e| AppError::Io(e.to_string()))
}
