use std::path::{Path, PathBuf};

use serde::Serialize;
use tokio::process::Command;

use crate::commands::fs::project_dir;
use crate::commands::process::{command, run_capture};
use crate::config::{GIT_LOG_MAX_LIMIT, GIT_TIMEOUT};
use crate::error::{AppError, AppResult};

fn git(project: &Path) -> Command {
    let mut cmd = command("git");
    cmd.arg("-C").arg(project);
    // Background refreshes must not take index.lock away from a git the user runs by hand.
    cmd.env("GIT_OPTIONAL_LOCKS", "0");
    cmd.env("GIT_TERMINAL_PROMPT", "0");
    cmd
}

/// Runs git and returns stdout, or None when git exits with an error.
async fn try_git(project: &Path, args: &[&str]) -> AppResult<Result<Vec<u8>, String>> {
    let mut cmd = git(project);
    cmd.args(args);
    let out = run_capture(cmd, "git", GIT_TIMEOUT).await?;
    if out.status.success() {
        Ok(Ok(out.stdout))
    } else {
        Ok(Err(String::from_utf8_lossy(&out.stderr).trim().to_string()))
    }
}

async fn run_git(project: &Path, args: &[&str]) -> AppResult<Vec<u8>> {
    try_git(project, args).await?.map_err(AppError::Git)
}

/// Root of the repository containing `project`, or None if it is not inside one.
pub async fn toplevel(project: &Path) -> AppResult<Option<PathBuf>> {
    match try_git(project, &["rev-parse", "--show-toplevel"]).await? {
        Ok(stdout) => {
            let path = String::from_utf8_lossy(&stdout).trim().to_string();
            if path.is_empty() {
                return Ok(None);
            }
            let path = PathBuf::from(path);
            Ok(Some(dunce::canonicalize(&path).unwrap_or(path)))
        }
        Err(_) => Ok(None),
    }
}

async fn require_repo(project: &Path) -> AppResult<PathBuf> {
    toplevel(project).await?.ok_or(AppError::NotGitRepo)
}

/// Branch name, or a short hash when HEAD is detached. None for a repo without commits
/// in detached state (nothing sensible to show).
#[tauri::command]
pub async fn git_branch(project: String) -> AppResult<Option<String>> {
    let project = project_dir(&project)?;
    require_repo(&project).await?;
    if let Ok(out) = try_git(&project, &["symbolic-ref", "--short", "-q", "HEAD"]).await? {
        let name = String::from_utf8_lossy(&out).trim().to_string();
        if !name.is_empty() {
            return Ok(Some(name));
        }
    }
    match try_git(&project, &["rev-parse", "--short", "HEAD"]).await? {
        Ok(out) => {
            let hash = String::from_utf8_lossy(&out).trim().to_string();
            Ok((!hash.is_empty()).then_some(hash))
        }
        Err(_) => Ok(None),
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize)]
#[serde(rename_all = "camelCase")]
pub enum GitStatusKind {
    Modified,
    Added,
    Untracked,
    Deleted,
    Conflict,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GitFileStatus {
    /// Absolute path in the platform's native format.
    pub path: String,
    pub status: GitStatusKind,
    /// git reports a wholly untracked directory as a single entry.
    pub is_dir: bool,
}

fn classify(x: u8, y: u8) -> Option<GitStatusKind> {
    use GitStatusKind::*;
    Some(match (x, y) {
        (b'!', b'!') => return None,
        (b'?', b'?') => Untracked,
        (b'U', _) | (_, b'U') | (b'A', b'A') | (b'D', b'D') => Conflict,
        (b'A', _) => Added,
        (b'D', _) | (_, b'D') => Deleted,
        _ => Modified,
    })
}

/// Parses `git status --porcelain=v1 -z` into (repo-relative path, status).
fn parse_status(raw: &[u8]) -> Vec<(String, GitStatusKind)> {
    let mut result = Vec::new();
    let mut entries = raw.split(|b| *b == 0);
    while let Some(entry) = entries.next() {
        if entry.len() < 4 {
            continue;
        }
        let (x, y) = (entry[0], entry[1]);
        // A rename/copy is followed by one more NUL-terminated field: the original path.
        if matches!(x, b'R' | b'C') || matches!(y, b'R' | b'C') {
            entries.next();
        }
        if let Some(status) = classify(x, y) {
            let status = if matches!(x, b'R' | b'C') {
                GitStatusKind::Added
            } else {
                status
            };
            result.push((String::from_utf8_lossy(&entry[3..]).into_owned(), status));
        }
    }
    result
}

#[tauri::command]
pub async fn git_status(project: String) -> AppResult<Vec<GitFileStatus>> {
    let project = project_dir(&project)?;
    let root = require_repo(&project).await?;
    let raw = run_git(&project, &["status", "--porcelain=v1", "-z"]).await?;
    Ok(parse_status(&raw)
        .into_iter()
        .map(|(rel, status)| {
            let mut abs = root.clone();
            for part in rel.split('/').filter(|p| !p.is_empty()) {
                abs.push(part);
            }
            GitFileStatus {
                path: abs.to_string_lossy().into_owned(),
                status,
                is_dir: rel.ends_with('/'),
            }
        })
        .collect())
}

#[derive(Debug, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct Commit {
    pub hash: String,
    pub parents: Vec<String>,
    pub author: String,
    /// Author date, unix seconds.
    pub timestamp: i64,
    /// Raw `%D` with full ref names: `HEAD -> refs/heads/main, tag: refs/tags/v1`.
    pub refs: String,
    pub subject: String,
    pub body: String,
}

const LOG_FORMAT: &str = "--format=%H%x1f%P%x1f%an%x1f%at%x1f%D%x1f%s%x1f%b";

fn parse_log(raw: &str) -> Vec<Commit> {
    raw.split('\0')
        .filter_map(|record| {
            let record = record.trim_start_matches('\n');
            let mut fields = record.splitn(7, '\x1f');
            let hash = fields.next()?.to_string();
            if hash.is_empty() {
                return None;
            }
            let parents = fields
                .next()?
                .split_whitespace()
                .map(str::to_string)
                .collect();
            let author = fields.next()?.to_string();
            let timestamp = fields.next()?.trim().parse().unwrap_or(0);
            let refs = fields.next()?.to_string();
            let subject = fields.next()?.to_string();
            let body = fields.next().unwrap_or("").trim().to_string();
            Some(Commit {
                hash,
                parents,
                author,
                timestamp,
                refs,
                subject,
                body,
            })
        })
        .collect()
}

#[tauri::command]
pub async fn git_log(project: String, skip: u32, limit: u32) -> AppResult<Vec<Commit>> {
    let project = project_dir(&project)?;
    require_repo(&project).await?;
    let limit = limit.clamp(1, GIT_LOG_MAX_LIMIT);
    let skip_arg = format!("--skip={skip}");
    let limit_arg = format!("--max-count={limit}");
    let args = [
        "log",
        "--all",
        "--topo-order",
        "--decorate=full",
        "-z",
        &skip_arg,
        &limit_arg,
        LOG_FORMAT,
    ];
    match try_git(&project, &args).await? {
        Ok(stdout) => Ok(parse_log(&String::from_utf8_lossy(&stdout))),
        // A freshly initialised repository has nothing to show; that's not an error.
        Err(stderr) if stderr.contains("does not have any commits") => Ok(Vec::new()),
        Err(stderr) => Err(AppError::Git(stderr)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn status_handles_renames_and_untracked_dirs() {
        let raw = b" M app/a.kt\0?? new/\0R  b.kt\0old.kt\0UU c.kt\0 D d.kt\0A  e.kt\0!! ignored\0";
        let parsed = parse_status(raw);
        assert_eq!(
            parsed,
            vec![
                ("app/a.kt".to_string(), GitStatusKind::Modified),
                ("new/".to_string(), GitStatusKind::Untracked),
                ("b.kt".to_string(), GitStatusKind::Added),
                ("c.kt".to_string(), GitStatusKind::Conflict),
                ("d.kt".to_string(), GitStatusKind::Deleted),
                ("e.kt".to_string(), GitStatusKind::Added),
            ]
        );
    }

    #[test]
    fn log_parses_records() {
        let raw = "aaa\x1fbbb ccc\x1fAnn\x1f1700000000\x1fHEAD -> refs/heads/main\x1fMerge\x1fline1\nline2\n\0bbb\x1f\x1fBob\x1f1600000000\x1f\x1fInit\x1f\0";
        let commits = parse_log(raw);
        assert_eq!(commits.len(), 2);
        assert_eq!(commits[0].parents, vec!["bbb", "ccc"]);
        assert_eq!(commits[0].body, "line1\nline2");
        assert_eq!(commits[0].refs, "HEAD -> refs/heads/main");
        assert!(commits[1].parents.is_empty());
        assert_eq!(commits[1].subject, "Init");
    }
}
