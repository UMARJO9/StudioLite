//! Read-only checks against a real project and the real Android SDK.
//! Not part of the normal test run:
//! `STUDIOLITE_SMOKE_PROJECT=/path/to/android/project cargo test smoke -- --ignored --nocapture`

use crate::commands::{android, fs, git, sdk};

fn project() -> String {
    std::env::var("STUDIOLITE_SMOKE_PROJECT").expect("set STUDIOLITE_SMOKE_PROJECT")
}

#[tokio::test]
#[ignore]
async fn smoke_project_and_git() {
    let info = fs::open_project(project()).await.unwrap();
    println!("project: {info:?}");
    assert!(info.has_gradlew);

    let entries = fs::read_dir(info.path.clone(), info.path.clone()).await.unwrap();
    println!("root entries: {:?}", entries.iter().map(|e| &e.name).collect::<Vec<_>>());
    assert!(entries.iter().all(|e| !crate::config::HIDDEN_DIRS.contains(&e.name.as_str())));
    let first_file = entries.iter().position(|e| !e.is_dir).unwrap_or(entries.len());
    assert!(entries[first_file..].iter().all(|e| !e.is_dir), "directories must come first");

    if info.is_git_repo {
        println!("branch: {:?}", git::git_branch(info.path.clone()).await.unwrap());
        let status = git::git_status(info.path.clone()).await.unwrap();
        println!("status: {} entries, first: {:?}", status.len(), status.first());
        let log = git::git_log(info.path.clone(), 0, 300).await.unwrap();
        println!("log: {} commits, head: {:?}", log.len(), log.first());
        assert!(!log.is_empty());
        assert!(log.iter().all(|c| c.hash.len() == 40));
        let page2 = git::git_log(info.path.clone(), log.len() as u32, 300).await.unwrap();
        println!("next page: {} commits", page2.len());
    }
}

#[tokio::test]
#[ignore]
async fn smoke_sdk_and_devices() {
    let sdk = sdk::find_sdk(Some(project())).await.unwrap();
    println!("sdk: {sdk:?}");
    let devices = android::list_devices(Some(project())).await.unwrap();
    for device in &devices {
        println!("device: {device:?}");
    }
}
