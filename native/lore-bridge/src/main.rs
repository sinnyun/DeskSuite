use std::{fs, io::{self, BufRead, Write}, path::{Path, PathBuf}};

use lore_vm::{
    api::LoreApi,
    global::LoreGlobal,
    ops::{
        file::{info as file_info, stage::{self, CaseChange, FileStageArgs}, hash::{self, FileHashArgs}, unstage::{self, FileUnstageArgs}},
        branch::{
            archive::{self as branch_archive, BranchArchiveArgs},
            create::{self as branch_create, BranchCreateArgs},
            list::{self as branch_list, BranchListArgs},
            merge_abort::{self as merge_abort, BranchMergeAbortArgs},
            merge_resolve::{self as merge_resolve, BranchMergeResolveArgs},
            merge_resolve_mine::{self as merge_resolve_mine, BranchMergeResolveMineArgs},
            merge_resolve_theirs::{self as merge_resolve_theirs, BranchMergeResolveTheirsArgs},
            merge_start::{self as merge_start, BranchMergeStartArgs},
            switch::{self as branch_switch, BranchSwitchArgs},
        },
        repository::{create::{self, CreateArgs}, flush, status::{self, RepositoryStatusArgs}},
        revision::{commit::{self, CommitArgs}, history::{self, RevisionHistoryArgs}, info::{self, RevisionInfoArgs}, sync::{self, RevisionSyncArgs}},
        shared_store::{create as create_store, create::SharedStoreCreateArgs},
    },
};
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};
use sha2::{Digest, Sha256};

#[cfg(windows)]
#[link(name = "kernel32")]
unsafe extern "system" {
    #[link_name = "MoveFileExW"]
    fn move_file_ex_w(existing_file_name: *const u16, new_file_name: *const u16, flags: u32) -> i32;
}

#[derive(Debug, Deserialize)]
#[serde(rename_all = "camelCase")]
struct Request {
    operation: String,
    root: String,
    entity_id: String,
    #[serde(default)]
    source_path: Option<String>,
    #[serde(default)]
    version_id: Option<String>,
    #[serde(default)]
    title: Option<String>,
    #[serde(default)]
    include_archived: bool,
    #[serde(default)]
    action: Option<String>,
    #[serde(default)]
    name: Option<String>,
    #[serde(default)]
    source_branch: Option<String>,
    #[serde(default)]
    strategy: Option<String>,
    #[serde(default)]
    overwrite: bool,
    #[serde(default)]
    pending_merge: Option<Value>,
    #[serde(default)]
    version_ids: Vec<String>,
    #[serde(default)]
    expected_source_sha256: Option<String>,
}

#[derive(Debug, Serialize)]
#[serde(rename_all = "camelCase")]
struct Response {
    ok: bool,
    result: Option<Value>,
    error: Option<String>,
}

#[derive(Debug, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
struct RestoreJournal {
    version: u32,
    entity_id: String,
    source_path: String,
    version_id: String,
    previous_head_revision_id: Option<String>,
    expected_source_sha256: String,
}

fn safe_entity(value: &str) -> bool {
    value.len() == 36 && value.chars().all(|c| c.is_ascii_hexdigit() || c == '-')
}

fn paths(root: &Path, entity: &str) -> Result<(PathBuf, PathBuf, PathBuf), String> {
    if !safe_entity(entity) { return Err("invalid version entity id".into()); }
    let work = root.join("worktrees").join(entity);
    let content = work.join("content");
    let store = root.join("stores").join(entity).join("shared-store");
    Ok((content, work, store))
}

async fn open_repo(root: &Path, entity: &str) -> Result<(LoreApi, PathBuf), String> {
    let (content, work, store) = paths(root, entity)?;
    let api = LoreApi::from_global(
        LoreGlobal::new(work.clone()).offline(true).in_memory(false).identity("desksuite-local"),
    );
    if work.join(".lore").exists() {
        status::status(&api, RepositoryStatusArgs { scan: false, staged: true, ..Default::default() })
            .await.map_err(|e| e.to_string())?;
        return Ok((api, content));
    }
    fs::create_dir_all(store.parent().ok_or("invalid shared store path")?).map_err(|e| e.to_string())?;
    if !store.exists() {
        create_store::create(&api, SharedStoreCreateArgs {
            remote_url: String::new(),
            path: Some(store.to_string_lossy().into_owned()),
            make_default: false,
        }).await.map_err(|e| e.to_string())?;
    }
    let name = blake3::hash(entity.as_bytes()).to_hex().to_string();
    create::create(&api, CreateArgs {
        repository_url: format!("lore://localhost/{name}"),
        description: "DeskSuite file history".into(),
        id: String::new(),
        use_shared_store: true,
        shared_store_path: store.to_string_lossy().into_owned(),
    }).await.map_err(|e| e.to_string())?;
    flush::flush(&api).await.map_err(|e| e.to_string())?;
    Ok((api, content))
}

fn copy_atomic(source: &Path, target: &Path) -> io::Result<()> {
    if source.starts_with(target) || target.starts_with(source) {
        return Err(io::Error::new(io::ErrorKind::InvalidInput, "source overlaps private snapshot path"));
    }
    replace_atomic(source, target)
}

fn publish_file(temp: &Path, target: &Path, replace: bool) -> io::Result<()> {
    #[cfg(windows)]
    {
        use std::os::windows::ffi::OsStrExt;

        const MOVEFILE_REPLACE_EXISTING: u32 = 0x1;
        const MOVEFILE_WRITE_THROUGH: u32 = 0x8;
        let source: Vec<u16> = temp.as_os_str().encode_wide().chain(Some(0)).collect();
        let destination: Vec<u16> = target.as_os_str().encode_wide().chain(Some(0)).collect();
        let flags = MOVEFILE_WRITE_THROUGH
            | if replace { MOVEFILE_REPLACE_EXISTING } else { 0 };
        let result = unsafe { move_file_ex_w(source.as_ptr(), destination.as_ptr(), flags) };
        if result == 0 { return Err(io::Error::last_os_error()); }
        Ok(())
    }
    #[cfg(not(windows))]
    {
        let _ = replace;
        fs::rename(temp, target)
    }
}

fn sync_directory(path: &Path) -> io::Result<()> {
    #[cfg(unix)]
    fs::File::open(path)?.sync_all()?;
    #[cfg(not(unix))]
    let _ = path;
    Ok(())
}

fn write_atomic_bytes(target: &Path, bytes: &[u8]) -> io::Result<()> {
    let parent = target.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let parent_existed = parent.exists();
    fs::create_dir_all(parent)?;
    if !parent_existed {
        if let Some(grandparent) = parent.parent() { sync_directory(grandparent)?; }
    }
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let temp = parent.join(format!(".desksuite-journal-{}-{stamp}.tmp", std::process::id()));
    let write_result = (|| {
        let mut file = fs::OpenOptions::new().write(true).create_new(true).open(&temp)?;
        io::Write::write_all(&mut file, bytes)?;
        file.sync_all()?;
        publish_file(&temp, target, true)?;
        sync_directory(parent)
    })();
    if write_result.is_err() { let _ = fs::remove_file(&temp); }
    write_result
}

fn restore_journal_path(root: &Path, entity: &str) -> Result<PathBuf, String> {
    if !safe_entity(entity) { return Err("invalid version entity id".into()); }
    Ok(root.join("restore-journals").join(format!("{entity}.json")))
}

fn read_restore_journal(root: &Path, entity: &str) -> Result<Option<RestoreJournal>, String> {
    let path = restore_journal_path(root, entity)?;
    let bytes = match fs::read(path) {
        Ok(bytes) => bytes,
        Err(error) if error.kind() == io::ErrorKind::NotFound => return Ok(None),
        Err(error) => return Err(format!("cannot read pending Lore restore journal: {error}")),
    };
    let journal: RestoreJournal = serde_json::from_slice(&bytes)
        .map_err(|error| format!("pending Lore restore journal is invalid: {error}"))?;
    if journal.version != 1 || journal.entity_id != entity || journal.version_id.is_empty()
        || journal.expected_source_sha256.len() != 64
        || !journal.expected_source_sha256.chars().all(|character| character.is_ascii_hexdigit()) {
        return Err("pending Lore restore journal failed validation".into());
    }
    Ok(Some(journal))
}

fn write_restore_journal(root: &Path, journal: &RestoreJournal) -> Result<(), String> {
    let path = restore_journal_path(root, &journal.entity_id)?;
    let bytes = serde_json::to_vec(journal).map_err(|error| error.to_string())?;
    write_atomic_bytes(&path, &bytes).map_err(|error| format!("cannot persist Lore restore journal: {error}"))
}

fn clear_restore_journal(root: &Path, entity: &str) -> Result<(), String> {
    let path = restore_journal_path(root, entity)?;
    match fs::remove_file(&path) {
        Ok(()) => sync_directory(path.parent().ok_or("invalid restore journal directory")?)
            .map_err(|error| format!("cannot flush Lore restore journal removal: {error}")),
        Err(error) if error.kind() == io::ErrorKind::NotFound => Ok(()),
        Err(error) => Err(format!("cannot clear Lore restore journal: {error}")),
    }
}

fn replace_atomic(source: &Path, target: &Path) -> io::Result<()> {
    let parent = target.parent().ok_or_else(|| io::Error::new(io::ErrorKind::InvalidInput, "target has no parent"))?;
    let stamp = std::time::SystemTime::now().duration_since(std::time::UNIX_EPOCH).unwrap_or_default().as_nanos();
    let stem = format!(".desksuite-version-{}-{stamp}", std::process::id());
    let temp = parent.join(format!("{stem}.tmp"));
    if let Err(error) = fs::copy(source, &temp) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    if let Err(error) = fs::OpenOptions::new().write(true).open(&temp).and_then(|file| file.sync_all()) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    let replace = target.exists();
    if let Err(error) = publish_file(&temp, target, replace) {
        let _ = fs::remove_file(&temp);
        return Err(error);
    }
    Ok(())
}

fn same_content(left: &Path, right: &Path) -> io::Result<bool> {
    let left_meta = fs::metadata(left)?;
    let right_meta = fs::metadata(right)?;
    if left_meta.len() != right_meta.len() { return Ok(false); }
    let mut left = fs::File::open(left)?;
    let mut right = fs::File::open(right)?;
    let mut left_buf = [0u8; 256 * 1024];
    let mut right_buf = [0u8; 256 * 1024];
    loop {
        let left_len = io::Read::read(&mut left, &mut left_buf)?;
        let right_len = io::Read::read(&mut right, &mut right_buf)?;
        if left_len != right_len || left_buf[..left_len] != right_buf[..right_len] { return Ok(false); }
        if left_len == 0 { return Ok(true); }
    }
}

async fn source_matches_revision(api: &LoreApi, source: &Path, revision: &str) -> Result<bool, String> {
    let source_file = hash::hash(api, FileHashArgs {
        paths: vec![source.to_string_lossy().into_owned()],
    }).await.map_err(|e| e.to_string())?.files.into_iter().next();
    let saved_file = file_info::info(api, lore_vm::ops::file::info::FileInfoArgs {
        paths: vec!["content".into()],
        revision: revision.into(),
        local: false,
        filtered: false,
    }).await.map_err(|e| e.to_string())?.entries.into_iter().find(|file| file.is_file);
    Ok(source_file.zip(saved_file).is_some_and(|(source, saved)| source.hash == saved.hash && source.size == saved.size))
}

fn sha256_file(path: &Path) -> io::Result<String> {
    let mut file = fs::File::open(path)?;
    let mut hasher = Sha256::new();
    let mut buffer = [0u8; 256 * 1024];
    loop {
        let count = io::Read::read(&mut file, &mut buffer)?;
        if count == 0 { break; }
        hasher.update(&buffer[..count]);
    }
    Ok(format!("{:x}", hasher.finalize()))
}

fn ensure_expected_source(path: &Path, expected: Option<&str>) -> Result<(), String> {
    let expected = expected.ok_or("expected source digest is required")?;
    if sha256_file(path).map_err(|e| e.to_string())? != expected {
        return Err("source file changed since the operation was selected; file bytes were preserved".into());
    }
    Ok(())
}

fn validate_branch_name(value: &str) -> Result<&str, String> {
    let name = value.trim();
    if name.is_empty() || name.chars().count() > 240 || name.chars().any(char::is_control) {
        return Err("branch name must be between 1 and 240 printable characters".into());
    }
    Ok(name)
}

fn validate_regular(path: &Path) -> Result<fs::Metadata, String> {
    let metadata = fs::symlink_metadata(path).map_err(|e| e.to_string())?;
    if !metadata.is_file() || metadata.file_type().is_symlink() {
        return Err("source must be a regular file, not a symbolic link".into());
    }
    Ok(metadata)
}

async fn list(root: &Path, entity: &str) -> Result<Value, String> {
    let (_, work, _) = paths(root, entity)?;
    if !work.join(".lore").exists() { return Ok(json!({"entries":[],"headRevisionId":null})); }
    let (api, _content) = open_repo(root, entity).await?;
    let head = status::status(&api, RepositoryStatusArgs { scan: false, staged: true, ..Default::default() })
        .await.map_err(|e| e.to_string())?.revision.map(|r| r.revision);
    let history = history::history(&api, RevisionHistoryArgs::default()).await.map_err(|e| e.to_string())?;
    let mut entries = Vec::new();
    for item in history.entries {
        let details = info::info(&api, RevisionInfoArgs { revision: item.revision.clone(), delta: true, metadata: true })
            .await.map_err(|e| e.to_string())?;
        let content_delta = details.deltas.iter().filter(|d| d.path.replace('\\', "/") == "content").collect::<Vec<_>>();
        if content_delta.is_empty() { continue; }
        let title = details.message().unwrap_or("Version").to_owned();
        let created_at = details.timestamp().and_then(|raw| raw.parse::<i64>().ok()).and_then(|ts| {
            let dt = if ts.unsigned_abs() >= 100_000_000_000_000_000 {
                chrono::DateTime::from_timestamp(ts.div_euclid(1_000_000_000), ts.rem_euclid(1_000_000_000) as u32)
            } else if ts.unsigned_abs() >= 100_000_000_000 {
                chrono::DateTime::from_timestamp_millis(ts)
            } else { chrono::DateTime::from_timestamp(ts, 0) };
            dt.map(|v| v.to_rfc3339())
        }).unwrap_or_else(|| chrono::Utc::now().to_rfc3339());
        entries.push(json!({
            "versionId": item.revision,
            "revisionNumber": item.revision_number,
            "parentRevisionIds": item.parents,
            "title": title,
            "createdAt": created_at,
            "sizeBytes": content_delta.iter().map(|d| d.size).max().unwrap_or(0),
        }));
    }
    Ok(json!({"entries":entries,"headRevisionId":head}))
}

async fn state(root: &Path, entity: &str, source: &Path, known_versions: &[String]) -> Result<Value, String> {
    validate_regular(source)?;
    let (_, work, _) = paths(root, entity)?;
    if !work.join(".lore").exists() { return Ok(json!({"status":"unversioned","currentVersionId":null,"matchingVersionId":null})); }
    let (api, _) = open_repo(root, entity).await?;
    let before = fs::metadata(source).map_err(|e| e.to_string())?;
    let source_path = source.to_path_buf();
    let source = hash::hash(&api, FileHashArgs { paths: vec![source_path.to_string_lossy().into_owned()] })
        .await.map_err(|e| e.to_string())?.files.into_iter().next().ok_or("could not hash source file")?;
    let current = status::status(&api, RepositoryStatusArgs { scan: true, staged: true, ..Default::default() })
        .await.map_err(|e| e.to_string())?.revision.map(|revision| revision.revision);
    let history = history::history(&api, RevisionHistoryArgs::default()).await.map_err(|e| e.to_string())?;
    let mut candidates = Vec::new();
    if let Some(current) = current.as_ref() { candidates.push(current.clone()); }
    candidates.extend(known_versions.iter().cloned());
    let history_entries = history.entries.into_iter().map(|entry| entry.revision).collect::<Vec<_>>();
    if current.is_none() && known_versions.is_empty() && history_entries.is_empty() {
        return Ok(json!({"status":"unversioned","currentVersionId":null,"matchingVersionId":null}));
    }
    candidates.extend(history_entries);
    let mut seen = std::collections::HashSet::new();
    let mut matching = None;
    for revision in candidates.into_iter().filter(|revision|seen.insert(revision.clone())) {
        let saved = file_info::info(&api, lore_vm::ops::file::info::FileInfoArgs {
            paths: vec!["content".into()], revision: revision.clone(), local: false, filtered: false,
        }).await.map_err(|e| e.to_string())?.entries.into_iter().find(|file| file.is_file);
        if saved.as_ref().is_some_and(|saved| saved.hash == source.hash && saved.size == source.size) {
            matching = Some(revision);
            break;
        }
    }
    let after = fs::metadata(&source_path).map_err(|e| e.to_string())?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("file changed while checking saved versions; retry".into());
    }
    let status_name = match matching.as_deref() {
        Some(id) if current.as_deref() == Some(id) => "saved",
        Some(_) => "matches_saved_version",
        None => "modified",
    };
    Ok(json!({"status":status_name,"currentVersionId":current,"matchingVersionId":matching}))
}

fn stamp_time(raw: Option<&str>) -> String {
    let Some(timestamp) = raw.and_then(|value| value.parse::<i64>().ok()) else { return chrono::Utc::now().to_rfc3339(); };
    let parsed = if timestamp.unsigned_abs() >= 100_000_000_000_000_000 {
        chrono::DateTime::from_timestamp(timestamp.div_euclid(1_000_000_000), timestamp.rem_euclid(1_000_000_000) as u32)
    } else if timestamp.unsigned_abs() >= 100_000_000_000 {
        chrono::DateTime::from_timestamp_millis(timestamp)
    } else { chrono::DateTime::from_timestamp(timestamp, 0) };
    parsed.map(|value| value.to_rfc3339()).unwrap_or_else(|| chrono::Utc::now().to_rfc3339())
}

async fn pending_merge_from_status(
    api: &LoreApi,
    status: &lore_vm::ops::repository::status::RepositoryStatusResult,
) -> Result<Option<Value>, String> {
    let Some(revision) = status.revision.as_ref() else { return Ok(None) };
    if revision.revision_merged.is_empty() { return Ok(None) }

    // An interrupted merge can survive even if its source branch is archived
    // after the merge began. Include archived branches when reconstructing the
    // source name; the active current branch still identifies the target.
    let branches = branch_list::list(api, BranchListArgs { archived: true })
        .await.map_err(|e| e.to_string())?;
    let current = branches.entries.iter().find(|branch| branch.is_current)
        .ok_or("pending Lore merge has no current target branch")?;
    let target_branch = if revision.branch_name.is_empty() { current.name.clone() } else { revision.branch_name.clone() };
    if target_branch != current.name {
        return Err("pending Lore merge target does not match the active branch".into());
    }

    let mut source_branch = None;
    for branch in branches.entries.iter().filter(|branch| branch.name != target_branch) {
        let history = history::history(api, RevisionHistoryArgs {
            branch: branch.name.clone(), only_branch: true, ..Default::default()
        }).await;
        let history = match history {
            Ok(history) => history,
            // Archived branches may no longer have a traversable local history
            // in Lore. They cannot prove the incoming revision, so keep trying
            // other branches and eventually retain the revision id fallback.
            Err(_) if branch.archived => continue,
            Err(error) => return Err(error.to_string()),
        };
        if history.entries.iter().any(|entry| entry.revision == revision.revision_merged) {
            source_branch = Some(branch.name.clone());
            break;
        }
    }
    let source_branch = source_branch.unwrap_or_else(|| revision.revision_merged.clone());
    let conflict_files = status.files.iter().filter(|file| file.conflict)
        .map(|file| file.path.clone()).collect::<Vec<_>>();
    if current.latest.is_empty() {
        return Err("pending Lore merge target has no base revision".into());
    }
    Ok(Some(json!({
        "sourceBranch": source_branch,
        "targetBranch": target_branch,
        "conflictFiles": conflict_files,
        "targetBaseRevisionId": current.latest
    })))
}

async fn branch_graph(root: &Path, entity: &str, include_archived: bool) -> Result<Value, String> {
    let (_, work, _) = paths(root, entity)?;
    if !work.join(".lore").exists() { return Ok(json!({"branches":[],"graphState":"empty","pendingMerge":null})); }
    let (api, _) = open_repo(root, entity).await?;
    let repo_status = status::status(&api, RepositoryStatusArgs { scan: true, staged: true, ..Default::default() })
        .await.map_err(|e| e.to_string())?;
    let pending_merge = pending_merge_from_status(&api, &repo_status).await?;
    let listed = branch_list::list(&api, BranchListArgs { archived: include_archived }).await.map_err(|e| e.to_string())?;
    let mut branches = Vec::new();
    for branch in listed.entries {
        let history = history::history(&api, RevisionHistoryArgs { branch: branch.name.clone(), only_branch: true, ..Default::default() }).await;
        let entries = match history {
            Ok(value) => value.entries,
            Err(error) if branch.archived && error.to_string().contains("branch not found") => Vec::new(),
            Err(error) => return Err(error.to_string()),
        };
        let mut revisions = Vec::new();
        for item in entries {
            let details = info::info(&api, RevisionInfoArgs { revision:item.revision.clone(),delta:true,metadata:true }).await.map_err(|e| e.to_string())?;
            let size = details.deltas.iter().filter(|delta| delta.path.replace('\\',"/")=="content").map(|delta|delta.size).max().unwrap_or(0);
            let is_current_revision = repo_status.revision.as_ref().is_some_and(|current| current.revision == item.revision);
            revisions.push(json!({
                "entityId":entity,"versionId":item.revision,"revisionNumber":item.revision_number,
                "parentRevisionIds":item.parents,"title":details.message().unwrap_or("Lore revision"),
                "createdAt":stamp_time(details.timestamp()),"sizeBytes":size,"contentType":null,"thumbnailPath":null,
                "isCurrent":is_current_revision
            }));
        }
        branches.push(json!({
            "branchId":branch.id,"name":branch.name,"category":branch.category,
            "headRevisionId":if branch.latest.is_empty(){None::<String>}else{Some(branch.latest)},
            "isCurrent":branch.is_current,"isArchived":branch.archived,"createdAtUnix":branch.created,
            "stack":branch.stack.into_iter().map(|point| json!({"branchId":point.branch,"revisionId":point.revision})).collect::<Vec<_>>(),
            "revisions":revisions
        }));
    }
    Ok(json!({"branches":branches,"graphState":"ready","pendingMerge":pending_merge,"currentRevisionId":repo_status.revision.map(|current| current.revision)}))
}

async fn branch_action(root: &Path, entity: &str, source: &Path, request: &Request) -> Result<Value, String> {
    validate_regular(source)?;
    let expected_source = request.expected_source_sha256.as_deref();
    ensure_expected_source(source, expected_source)?;
    let action = request.action.as_deref().ok_or("action is required")?;
    let (_, work, _) = paths(root, entity)?;
    if !work.join(".lore").exists() { return Err("file has no Lore history".into()); }
    let (api, content) = open_repo(root, entity).await?;
    let state = status::status(&api, RepositoryStatusArgs { scan:true, staged:true, ..Default::default() }).await.map_err(|e|e.to_string())?;
    if state.files.iter().any(|file| file.conflict) && !matches!(action, "resolve" | "abort") {
        return Err("pending conflicts block this branch action".into());
    }
    match action {
        "create" => {
            if !state.files.is_empty() || !same_content(source,&content).map_err(|e|e.to_string())? { return Err("save a version before creating a branch".into()); }
            let name = validate_branch_name(request.name.as_deref().ok_or("name is required")?)?;
            let branch = branch_create::create(&api, BranchCreateArgs { branch:name.into(),category:"feature".into(),id:String::new() }).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            Ok(json!({"action":"create","branch":branch.name,"completed":true}))
        }
        "switch" => {
            if !request.overwrite && (!state.files.is_empty() || !same_content(source,&content).map_err(|e|e.to_string())?) { return Err("unsaved changes block branch switch".into()); }
            let name = validate_branch_name(request.name.as_deref().ok_or("name is required")?)?;
            let exists = branch_list::list(&api,BranchListArgs{archived:false}).await.map_err(|e|e.to_string())?.entries.iter().any(|branch|branch.name==name);
            if !exists { return Err("branch not found".into()); }
            let switched = branch_switch::switch(&api,BranchSwitchArgs{branch:name.into(),revision:String::new(),reset:request.overwrite,bare:false}).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            ensure_expected_source(source, expected_source)?;
            replace_atomic(&content,source).map_err(|e|e.to_string())?;
            Ok(json!({"action":"switch","branch":switched.branch,"completed":true,"fileChanged":true}))
        }
        "archive" => {
            if !state.files.is_empty() || !same_content(source,&content).map_err(|e|e.to_string())? { return Err("unsaved changes block branch archive".into()); }
            let name = validate_branch_name(request.name.as_deref().ok_or("name is required")?)?;
            let selected = branch_list::list(&api,BranchListArgs{archived:false}).await.map_err(|e|e.to_string())?.entries.into_iter().find(|branch|branch.name==name).ok_or("branch not found")?;
            if selected.is_current { return Err("cannot archive the current branch".into()); }
            branch_archive::archive(&api,BranchArchiveArgs{branch:name.into()}).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            Ok(json!({"action":"archive","branch":name,"completed":true}))
        }
        "merge" => {
            if !state.files.is_empty() || !same_content(source,&content).map_err(|e|e.to_string())? { return Err("unsaved changes block branch merge".into()); }
            let source_branch=validate_branch_name(request.source_branch.as_deref().ok_or("sourceBranch is required")?)?;
            let branches=branch_list::list(&api,BranchListArgs{archived:false}).await.map_err(|e|e.to_string())?;
            let current=branches.entries.iter().find(|branch|branch.is_current).ok_or("current branch not found")?;
            if current.name==source_branch { return Err("cannot merge branch into itself".into()); }
            if !branches.entries.iter().any(|branch|branch.name==source_branch) { return Err("source branch not found".into()); }
            let merged=merge_start::merge_start(&api,BranchMergeStartArgs{branch:source_branch.into(),message:format!("Merge {source_branch} into {}",current.name),no_commit:false,link:String::new(),ignore_links:false}).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            if merged.has_conflicts { return Ok(json!({"action":"merge","completed":false,"hasConflicts":true,"sourceBranch":source_branch,"targetBranch":current.name,"targetBaseRevisionId":current.latest,"conflictFiles":merged.conflict_files})); }
            ensure_expected_source(source, expected_source)?;
            replace_atomic(&content,source).map_err(|e|e.to_string())?;
            Ok(json!({"action":"merge","completed":true,"hasConflicts":false,"sourceBranch":source_branch,"targetBranch":current.name,"fileChanged":true}))
        }
        "resolve" => {
            let discovered = pending_merge_from_status(&api, &state).await?;
            let pending: Value=discovered.or(request.pending_merge.clone()).ok_or("pendingMerge is required")?;
            let source_branch=pending.get("sourceBranch").and_then(Value::as_str).ok_or("invalid pending merge source")?;
            let target_branch=pending.get("targetBranch").and_then(Value::as_str).ok_or("invalid pending merge target")?;
            let base=pending.get("targetBaseRevisionId").and_then(Value::as_str).unwrap_or_default();
            if base.is_empty() || !source_matches_revision(&api, source, base).await? {
                return Err("source file no longer matches the target branch snapshot from when the merge started".into());
            }
            let selected=pending.get("conflictFiles").and_then(Value::as_array).ok_or("invalid conflict list")?.iter().filter_map(Value::as_str).map(str::to_owned).collect::<Vec<_>>();
            if !selected.is_empty() {
                match request.strategy.as_deref().ok_or("strategy is required")? {
                    "ours" => { merge_resolve_mine::merge_resolve_mine(&api,BranchMergeResolveMineArgs{paths:selected.clone()}).await.map_err(|e|e.to_string())?; }
                    "theirs" => { merge_resolve_theirs::merge_resolve_theirs(&api,BranchMergeResolveTheirsArgs{paths:selected.clone()}).await.map_err(|e|e.to_string())?; }
                    _ => return Err("strategy must be ours or theirs".into())
                }
            }
            let resolved_paths=if selected.is_empty() {
                Vec::new()
            } else {
                merge_resolve::merge_resolve(&api,BranchMergeResolveArgs{paths:selected}).await.map_err(|e|e.to_string())?.resolved_paths
            };
            ensure_expected_source(source, expected_source)?;
            if !source_matches_revision(&api, source, base).await? {
                return Err("source file changed during merge resolution; file bytes were preserved".into());
            }
            let mut remaining=pending.get("conflictFiles").and_then(Value::as_array).cloned().unwrap_or_default();
            remaining.retain(|path| !resolved_paths.iter().any(|done|path.as_str()==Some(done.as_str())));
            if !remaining.is_empty() { flush::flush(&api).await.map_err(|e|e.to_string())?; return Ok(json!({"action":"resolve","completed":false,"hasConflicts":true,"sourceBranch":source_branch,"targetBranch":target_branch,"targetBaseRevisionId":base,"conflictFiles":remaining})); }
            let commit=commit::commit(&api,CommitArgs{message:format!("Merge {source_branch} into {target_branch}")}).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            ensure_expected_source(source, expected_source)?;
            if !source_matches_revision(&api, source, base).await? {
                return Err("source file changed during merge resolution; file bytes were preserved".into());
            }
            replace_atomic(&content,source).map_err(|e|e.to_string())?;
            Ok(json!({"action":"resolve","completed":true,"hasConflicts":false,"sourceBranch":source_branch,"targetBranch":target_branch,"mergeRevisionId":commit.revision,"fileChanged":true}))
        }
        "abort" => {
            merge_abort::merge_abort(&api,BranchMergeAbortArgs{link:String::new(),ignore_links:false}).await.map_err(|e|e.to_string())?;
            flush::flush(&api).await.map_err(|e|e.to_string())?;
            Ok(json!({"action":"abort","completed":true,"hasConflicts":false}))
        }
        _ => Err("action must be create, switch, archive, merge, resolve, or abort".into())
    }
}

async fn create_version(root: &Path, entity: &str, source: &Path, title: &str, expected_source: Option<&str>) -> Result<Value, String> {
    let title = title.trim();
    if title.is_empty() || title.chars().count() > 240 || title.chars().any(char::is_control) {
        return Err("title must be 1–240 printable characters".into());
    }
    let before = validate_regular(source)?;
    ensure_expected_source(source, expected_source)?;
    let (api, content) = open_repo(root, entity).await?;
    let status_before = status::status(&api, RepositoryStatusArgs { scan: true, staged: true, ..Default::default() })
        .await.map_err(|e| e.to_string())?;
    prepare_snapshot_commit(&api, &content, &status_before).await.map_err(|e| format!("prepare snapshot: {e}"))?;
    copy_atomic(source, &content).map_err(|e| e.to_string())?;
    ensure_expected_source(source, expected_source)?;
    let after = validate_regular(source)?;
    if before.len() != after.len() || before.modified().ok() != after.modified().ok() {
        return Err("file changed while creating a version; retry".into());
    }
    let staged = stage::stage(&api, FileStageArgs {
        paths: vec![content.to_string_lossy().into_owned()],
        case_change: CaseChange::Error,
        scan: true,
    }).await.map_err(|e| format!("stage snapshot: {e}"))?;
    if staged.files.is_empty() { return Err("file content already matches the saved version".into()); }
    let commit = commit::commit(&api, CommitArgs { message: title.into() }).await.map_err(|e| format!("commit snapshot: {e}"))?;
    flush::flush(&api).await.map_err(|e| e.to_string())?;
    let history = history::history(&api, RevisionHistoryArgs::default()).await.map_err(|e| e.to_string())?;
    let parents = history.entries.iter().find(|entry| entry.revision == commit.revision)
        .map(|entry| entry.parents.clone()).unwrap_or_default();
    let details = info::info(&api, RevisionInfoArgs { revision: commit.revision.clone(), delta: true, metadata: true })
        .await.map_err(|e| e.to_string())?;
    let size = fs::metadata(source).map_err(|e| e.to_string())?.len();
    let created_at = stamp_time(details.timestamp());
    Ok(json!({
        "versionId": commit.revision,
        "revisionNumber": commit.revision_number,
        "parentRevisionIds": parents,
        "title": title,
        "createdAt": created_at,
        "sizeBytes": size,
        "contentType": mime_guess::from_path(source).first_raw(),
    }))
}

async fn prepare_snapshot_commit(
    api: &LoreApi,
    content: &Path,
    before: &lore_vm::ops::repository::status::RepositoryStatusResult,
) -> Result<(), String> {
    if before.files.iter().any(|file| file.conflict)
        || before.revision.as_ref().is_some_and(|revision| !revision.revision_merged.is_empty()) {
        return Err("pending conflicts must be resolved before creating a version".into());
    }
    let branches = branch_list::list(api, BranchListArgs { archived:false }).await.map_err(|e|e.to_string())?;
    let target=before.revision.as_ref().and_then(|revision| branches.entries.iter().find(|branch|branch.is_current && branch.latest.bytes().any(|byte|byte!=b'0') && branch.latest!=revision.revision).map(|branch|branch.latest.clone()));
    let staged=before.files.iter().any(|file|file.staged);
    let Some(target)=target else {
        if staged { return Err("private Lore worktree has staged changes; inspect before retrying".into()); }
        return Ok(());
    };
    if before.files.iter().any(|file|file.path.replace('\\',"/")!="content") {
        return Err("private Lore worktree has unexpected changed paths".into());
    }
    if staged {
        unstage::unstage(api,FileUnstageArgs{paths:vec![content.to_string_lossy().into_owned()]}).await.map_err(|e|e.to_string())?;
    }
    sync::sync(api,RevisionSyncArgs{revision:target,reset:true,..Default::default()}).await.map_err(|e|e.to_string())?;
    flush::flush(api).await.map_err(|e|e.to_string())?;
    Ok(())
}

async fn restore(root: &Path, entity: &str, target: &Path, version_id: &str, expected_source: Option<&str>) -> Result<Value, String> {
    validate_regular(target)?;
    let expected_source = expected_source.ok_or("expected source digest is required")?;
    if let Some(journal) = read_restore_journal(root, entity)? {
        if journal.source_path != target.to_string_lossy().into_owned() || journal.version_id != version_id {
            return Err("an interrupted Lore restore is pending for another request; the source file was preserved".into());
        }
        ensure_expected_source(target, Some(expected_source))?;
        if recover_restore(root, entity, target, version_id, &journal.expected_source_sha256).await? {
            return Ok(json!({"restored":true,"versionId":version_id,"recovered":true}));
        }
    }
    ensure_expected_source(target, Some(expected_source))?;
    let (api, content) = open_repo(root, entity).await?;
    let status_now = status::status(&api, RepositoryStatusArgs { scan: true, staged: true, ..Default::default() })
        .await.map_err(|e| e.to_string())?;
    if !status_now.files.is_empty() || !same_content(target, &content).map_err(|e|e.to_string())? {
        return Err("unsaved file or Lore worktree changes block restore".into());
    }
    let before = fs::metadata(target).map_err(|e|e.to_string())?;
    info::info(&api, RevisionInfoArgs { revision: version_id.into(), delta: false, metadata: false })
        .await.map_err(|_| "version was not found".to_string())?;
    let previous_head_revision_id = current_head(&api).await?;
    write_restore_journal(root, &RestoreJournal {
        version: 1,
        entity_id: entity.to_string(),
        source_path: target.to_string_lossy().into_owned(),
        version_id: version_id.to_string(),
        previous_head_revision_id,
        expected_source_sha256: expected_source.to_string(),
    })?;
    sync::sync(&api, RevisionSyncArgs { revision: version_id.into(), reset: false, ..Default::default() })
        .await.map_err(|e| e.to_string())?;
    flush::flush(&api).await.map_err(|e| e.to_string())?;
    if current_head(&api).await?.as_deref() != Some(version_id)
        || !source_matches_revision(&api, &content, version_id).await? {
        return Err("Lore did not durably select the requested revision; the pending restore was retained".into());
    }
    let immediately_before = fs::metadata(target).map_err(|e|e.to_string())?;
    if before.len() != immediately_before.len() || before.modified().ok() != immediately_before.modified().ok() {
        return Err("source file changed during restore; the original file was not replaced".into());
    }
    ensure_expected_source(target, Some(expected_source))?;
    replace_atomic(&content, target).map_err(|e| e.to_string())?;
    if !same_content(target, &content).map_err(|e| e.to_string())? {
        return Err("restored source does not match Lore content; the restore journal was retained".into());
    }
    clear_restore_journal(root, entity)?;
    Ok(json!({"restored":true,"versionId":version_id}))
}

async fn current_head(api: &LoreApi) -> Result<Option<String>, String> {
    // A historical checkout moves the working-copy anchor, not the branch tip.
    let current = status::status(api, RepositoryStatusArgs { scan: false, staged: true, ..Default::default() })
        .await.map_err(|error| error.to_string())?;
    Ok(current.revision.map(|revision| revision.revision))
}

async fn recover_restore(root: &Path, entity: &str, target: &Path, version_id: &str, expected_source: &str) -> Result<bool, String> {
    let Some(journal) = read_restore_journal(root, entity)? else { return Ok(false) };
    if journal.source_path != target.to_string_lossy().into_owned() || journal.version_id != version_id
        || journal.expected_source_sha256 != expected_source {
        return Err("pending Lore restore does not match this source file and version".into());
    }
    let (api, content) = open_repo(root, entity).await?;
    let head = current_head(&api).await?;
    let source_already_restored = same_content(target, &content).map_err(|error| error.to_string())?;

    if head.as_deref() == Some(version_id) {
        if !source_matches_revision(&api, &content, version_id).await? {
            return Err("pending Lore restore revision does not match private worktree content; source file preserved".into());
        }
        if !source_already_restored {
            ensure_expected_source(target, Some(expected_source))
                .map_err(|_| "source file changed after the interrupted restore; external content was preserved".to_string())?;
            validate_regular(target)?;
            replace_atomic(&content, target).map_err(|error| error.to_string())?;
            if !same_content(target, &content).map_err(|error| error.to_string())? {
                return Err("recovered source does not match Lore content; the restore journal was retained".into());
            }
        }
        clear_restore_journal(root, entity)?;
        return Ok(true);
    }

    // The durable intent was written, but Lore did not advance to the requested
    // revision. Only the recorded prior HEAD plus original source digest and
    // clean private worktree prove this was a pre-sync crash. A third HEAD may
    // represent an external branch operation, so keep the journal as a fence.
    if head != journal.previous_head_revision_id {
        return Err("Lore HEAD changed during an interrupted restore; source file and journal were preserved for inspection".into());
    }
    ensure_expected_source(target, Some(expected_source))
        .map_err(|_| "source file changed while a Lore restore was interrupted; external content was preserved and the journal was retained".to_string())?;
    if !source_already_restored {
        return Err("Lore content changed during an interrupted restore; source file and journal were preserved for inspection".into());
    }
    clear_restore_journal(root, entity)?;
    Ok(false)
}

async fn abandon_restore(root: &Path, entity: &str, target: &Path, version_id: &str, expected_source: Option<&str>) -> Result<Value, String> {
    validate_regular(target)?;
    ensure_expected_source(target, expected_source)?;
    let journal = read_restore_journal(root, entity)?
        .ok_or("there is no pending Lore restore to abandon")?;
    if journal.source_path != target.to_string_lossy().into_owned() || journal.version_id != version_id {
        return Err("pending Lore restore does not match this source file and version".into());
    }
    if sha256_file(target).map_err(|error| error.to_string())? == journal.expected_source_sha256 {
        return Err("source still has its pre-restore bytes; retry the restore instead of abandoning it".into());
    }
    let (api, _) = open_repo(root, entity).await?;
    if source_matches_revision(&api, target, version_id).await? {
        return Err("source already matches the requested Lore version; retry restore to finish journal cleanup".into());
    }
    clear_restore_journal(root, entity)?;
    Ok(json!({"abandoned":true,"versionId":version_id,"sourceChanged":true,"loreHeadUnchanged":true}))
}

async fn restore_status(root: &Path, entity: &str, source_path: Option<&str>) -> Result<Value, String> {
    let Some(journal) = read_restore_journal(root, entity)? else {
        return Ok(json!({"pending":false,"sourcePath":null,"versionId":null,"expectedSourceSha256":null,"currentSourceSha256":null,"sourceAvailable":false,"sameSourceBytes":false,"sourceIsTarget":false}));
    };
    let source_path = source_path.ok_or("sourcePath is required while a Lore restore is pending")?;
    if source_path != journal.source_path {
        return Err("sourcePath does not match the pending Lore restore journal".into());
    }
    let target = Path::new(source_path);
    let base = json!({
        "pending":true,
        "sourcePath":journal.source_path,
        "versionId":journal.version_id,
        "expectedSourceSha256":journal.expected_source_sha256,
    });
    if let Err(error) = validate_regular(target) {
        return Ok(json!({
            "pending":true,
            "sourcePath":journal.source_path,
            "versionId":journal.version_id,
            "expectedSourceSha256":journal.expected_source_sha256,
            "currentSourceSha256":null,
            "sourceAvailable":false,
            "sameSourceBytes":false,
            "sourceIsTarget":false,
            "diagnostic":error,
        }));
    }
    let current_source_sha256 = sha256_file(target).map_err(|error| error.to_string())?;
    let same_source_bytes = current_source_sha256 == journal.expected_source_sha256;
    let (_, work, _) = paths(root, entity)?;
    if !work.join(".lore").exists() {
        return Err("pending Lore restore repository is missing; read-only status cannot verify the target revision".into());
    }
    // Constructing the API is read-only. Do not call open_repo here: that helper
    // creates a repository when absent, which is inappropriate for a status read.
    let api = LoreApi::from_global(
        LoreGlobal::new(work).offline(true).in_memory(false).identity("desksuite-local"),
    );
    let source_is_target = source_matches_revision(&api, target, &journal.version_id).await?;
    let (content, _, _) = paths(root, entity)?;
    let worktree_is_target = source_matches_revision(&api, &content, &journal.version_id).await?;
    let mut status = base;
    if let Some(object) = status.as_object_mut() {
        object.insert("diagnostic".into(), Value::String(format!("workingRevision={:?}; targetRevision={}; worktreeMatchesTarget={worktree_is_target}", current_head(&api).await?, journal.version_id)));
        object.insert("sourceAvailable".into(), Value::Bool(true));
        object.insert("currentSourceSha256".into(), Value::String(current_source_sha256));
        object.insert("sameSourceBytes".into(), Value::Bool(same_source_bytes));
        object.insert("sourceIsTarget".into(), Value::Bool(source_is_target));
    }
    Ok(status)
}

async fn execute(req: Request) -> Result<Value, String> {
    let root = PathBuf::from(req.root.clone());
    if let Some(journal) = read_restore_journal(&root, &req.entity_id)? {
        let is_retry = req.operation == "restore"
            && req.source_path.as_deref() == Some(journal.source_path.as_str())
            && req.version_id.as_deref() == Some(journal.version_id.as_str());
        let is_abandon = req.operation == "abandonRestore"
            && req.source_path.as_deref() == Some(journal.source_path.as_str())
            && req.version_id.as_deref() == Some(journal.version_id.as_str());
        let is_status = req.operation == "restoreStatus"
            && req.source_path.as_deref() == Some(journal.source_path.as_str());
        // `list` is needed by the UI after restoreStatus; it only reads the
        // existing repository and returns Lore history rows. Keep state and
        // branchGraph fenced so only the explicitly scoped status probe is
        // available while an interrupted restore is pending.
        let is_read_only = req.operation == "list" || req.operation == "fingerprints";
        if !is_retry && !is_abandon && !is_status && !is_read_only {
            return Err("an interrupted Lore restore is pending; retry the same restore before other version operations".into());
        }
    }
    match req.operation.as_str() {
        "fingerprints" => {
            let (api, content) = open_repo(&root, &req.entity_id).await?;
            let directory = root.join("fingerprint-work").join(&req.entity_id);
            fs::create_dir_all(&directory).map_err(|e| e.to_string())?;
            let output = directory.join(format!("{}.tmp", std::process::id()));
            let mut hashes = serde_json::Map::new();
            for revision in &req.version_ids {
                let result = lore_vm::ops::file::write::write(&api, lore_vm::ops::file::write::FileWriteArgs {
                    address: String::new(), path: content.to_string_lossy().into_owned(),
                    revision: revision.clone(), output: output.to_string_lossy().into_owned(),
                }).await.map_err(|e| e.to_string());
                if let Err(error) = result { let _ = fs::remove_file(&output); return Err(error); }
                let digest = sha256_file(&output).map_err(|e| e.to_string());
                let _ = fs::remove_file(&output);
                hashes.insert(revision.clone(), Value::String(digest?));
            }
            Ok(Value::Object(hashes))
        }
        "list" => list(&root, &req.entity_id).await,
        "create" => {
            let source = req.source_path.ok_or("sourcePath is required")?;
            let title = req.title.ok_or("title is required")?;
            create_version(&root, &req.entity_id, Path::new(&source), &title, req.expected_source_sha256.as_deref()).await
        }
        "restore" => {
            let source = req.source_path.ok_or("sourcePath is required")?;
            let version = req.version_id.ok_or("versionId is required")?;
            restore(&root, &req.entity_id, Path::new(&source), &version, req.expected_source_sha256.as_deref()).await
        }
        "abandonRestore" => {
            let source = req.source_path.ok_or("sourcePath is required")?;
            let version = req.version_id.ok_or("versionId is required")?;
            abandon_restore(&root, &req.entity_id, Path::new(&source), &version, req.expected_source_sha256.as_deref()).await
        }
        "restoreStatus" => restore_status(&root, &req.entity_id, req.source_path.as_deref()).await,
        "state" => {
            let source = req.source_path.ok_or("sourcePath is required")?;
            state(&root, &req.entity_id, Path::new(&source), &req.version_ids).await
        }
        "branchGraph" => branch_graph(&root, &req.entity_id, req.include_archived).await,
        "branchAction" => {
            let source = req.source_path.as_deref().ok_or("sourcePath is required")?;
            branch_action(&root, &req.entity_id, Path::new(source), &req).await
        }
        _ => Err("unsupported Lore operation".into()),
    }
}

#[tokio::main]
async fn main() {
    let stdin = io::stdin();
    let mut stdout = io::BufWriter::new(io::stdout().lock());
    for line in stdin.lock().lines() {
        let response = match line {
            Ok(line) => match serde_json::from_str::<Request>(&line) {
                Ok(req) => match execute(req).await {
                    Ok(result) => Response { ok: true, result: Some(result), error: None },
                    Err(error) => Response { ok: false, result: None, error: Some(error) },
                },
                Err(error) => Response { ok: false, result: None, error: Some(format!("invalid request: {error}")) },
            },
            Err(error) => Response { ok: false, result: None, error: Some(format!("stdin read failed: {error}")) },
        };
        if serde_json::to_writer(&mut stdout, &response).is_err() { break; }
        if stdout.write_all(b"\n").is_err() || stdout.flush().is_err() { break; }
    }
}

