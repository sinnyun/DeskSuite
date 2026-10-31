# data-ops-versions

Lore-backed per-file immutable history service. Metadata is owned by `data-provider-version-info`; file revisions live under the application data directory in isolated Lore worktrees and shared stores.

## Metadata

- Domain / class / name: `data` / `ops` / `versions`
- Entry: `index.ts`
- Injects: `ipc`, `mcp`, `jobs`, `audit`, `config`, `db`, `versionInfo`, `window`, `storage`, `commands`
- Lore engine: pinned Rust sidecar at `native/lore-bridge/`, using the same `lore-vm` revision as the reference project.

## IPC service

Service: `versions`.

- `list(path)` reads the persisted SQLite version catalog only; it never starts Lore, reconciles history, or requires the source file to exist.
- `preview(path, versionId)` returns a bounded JPEG data URL only for a version owned by that path. It preserves the no-symlink/regular-file check and matches the opened handle's device/inode to `lstat`; reads use same-handle `fstat` and are capped at 512 KiB + 1 bytes to reject growth races. The renderer never opens `userData` paths directly.
- `state(path)` reads persisted state, current/matching titles, source metadata, pending restore diagnostics, and synchronization state. A background local filesystem observer maintains content state using persisted SHA-256 fingerprints; UI queries never hash files or invoke Lore.
- `create(path, title)` starts a background job that commits one immutable snapshot. The source digest is captured before queueing and checked by the sidecar before staging; image previews are copied into plugin owned immutable files after the commit.
- `restore(path, versionId, confirm)` requires `confirm === true`, an existing version entity, and a regular file. MCP callers must already target a configured MCP write root. Confirmed renderer operations use only the target directory as an operation-local scope, never read or modify `mcp.writeRoots`, and retain forbidden-directory and source SHA-256 checks before replacement; matching pending targets can resume interrupted restores. It refreshes the file index and broadcasts `fs:changed` on success.
- `abandonInterruptedRestore(path, versionId, confirm)` requires explicit confirmation and a matching pending journal. It rehashes the current source before clearing the journal, and is accepted only when the source changed and does not match the target Lore revision. It preserves source bytes and Lore content. Since it only removes DeskSuite's internal restore journal and never writes the source file, the source path need not be inside an MCP write root; MCP calls still require Full access and `confirm: true`.
- `branchGraph(path, includeArchived?)` reads and filters the complete persisted graph, including pending merges, without querying Lore.
- `branchAction(path, { action, ... }, confirm)` supports `create`, `switch`, `archive`, `merge`, `resolve`, and `abort`. Pending merge state is durable; source bytes are replaced only when a branch switch or merge has completed. Switch, merge, and resolve capture and recheck the source SHA-256 before replacement, and follow the same write-root rules as `restore`.

Restore and source-writing branch actions never accept paths in application `userData`, and MCP callers are never prompted for authorization: they must satisfy the configured roots up front. Command execution preserves its asynchronous call origin, so MCP `command_run` calls forwarded to IPC still require MCP write roots. Mutations and background observations are serialized per entity; database queries continue reading the last complete committed projection during operations.

## MCP

- `versions_list` is read-only.
- `versions_state` reports `interrupted_restore` when a journal is pending; this includes the recorded target version and whether the source is unchanged, already restored, externally changed, or unavailable. It does not write file content.
- `versions_branch_graph` reads SQLite only.
- `versions_create` is high impact, requires Full access and explicit `confirm: true`, creates a snapshot, and returns a `jobId`.
- `versions_restore` is high impact, requires Full access and explicit `confirm: true`, and returns a `jobId`.
- `versions_restore_abandon` is high impact and requires Full access plus explicit `confirm: true`. It clears a confirmed interrupted-restore journal without writing source bytes or Lore content, and does not require the source path to be in an MCP write root.
- `versions_branch_action` is high impact, requires Full access and explicit `confirm: true`, and returns a `jobId`.

MCP and renderer calls use the same service path. Jobs and audit entries report mutations and failures.

## Events

- `versions:changed` after history changes (`kind: "history"`, omitted for compatibility) or a watcher-only source-status update (`kind: "source"`).
- `fs:changed` after restore or a branch action that changes source bytes so Explorer reloads the file and visible metadata.
- Standard `job:progress` / `job:done` from the jobs service.

## Storage

- Lore worktrees: `<userData>/data/versions/worktrees/<entityId>/`
- Shared object stores: `<userData>/data/versions/stores/<entityId>/shared-store/`
- Version records and branch graph: `desksuite.db`, owned by `data-provider-version-info`.
- Immutable image previews: `<userData>/data/versions/previews/<entityId>/<versionId>.jpg`; `thumbnailPath` stores the userData relative path `data/versions/previews/<entityId>/<versionId>.jpg`.

The Lore bridge runs only for version mutations and explicit metadata reconciliation. Commands publish entity, version, graph, state, and fingerprint data as one SQLite transaction after reading engine results. Source-byte safety validation remains authoritative in Lore operations.

## Current limits

- Worktree conflicts block snapshots and branch actions that cannot safely proceed; `resolve` and `abort` remain available. Unrecognized staged changes preserve source bytes and are never discarded automatically.
- A recovered merge with no remaining conflict paths can be completed after a restart; source and target branch names are reconstructed from the incoming revision and current Lore branch list.
- While a restore journal is pending, version list, state, and branch graph reads remain available. The sidecar fence permits only a retry for the journal's exact path/version or explicit abandonment; other version operations remain blocked.
- The Rust bridge binary is built by `npm run build:lore-bridge` and packaged as the `lore-bridge` extra resource. Runtime installation requires the pinned Rust toolchain during packaging.

### Restore recovery semantics
Historical checkout verification uses the repository working-copy revision, not the branch tip. Pending restore diagnostics include the working revision and whether private worktree bytes match the target. Retrying an interrupted restore does not query the fenced branch graph.
Branch graph current revision markers use the working-copy revision. While interrupted restore is pending, branch graph reads return the stored graph without invoking fenced Lore operations.

## Durable read model
- `reconcile(path, true)` / MCP `versions_reconcile({path,confirm:true})` explicitly rebuilds the database projection for existing histories or interrupted operations. Full access required; this is never called by normal UI refresh/startup. It does not change the source file or checkout.
- `versions_storage_info({path})` reads synchronization metadata, fingerprint count, and the process-local Lore launch counter; no engine call.
- `version_snapshots` stores observed state, source metadata, all historical SHA-256 fingerprints, pending restores, synchronization timestamp, operation marker and last error. Mutation intent is persisted before engine calls; failed synchronization retains the last complete projection and the marker/error for explicit recovery.
- Missing legacy snapshots display `unknown` until explicitly reconciled. Missing source files do not hide persisted history or previews. Local directory watchers update file availability/content status and publish `versions:changed` with `kind: "source"`; they never invoke Lore.
- Metadata discovery follows entity path rebinding and closes watchers on plugin disposal. Historical fingerprints are materialized from Lore snapshots only during operations/reconciliation into private scratch files which are deleted after hashing. Original file bytes and the working-copy anchor are preserved.

Version UI actions consume command approval plans and execute them before tracking a job. Existing restore/abandon confirmations authorize the matching plan. Version descriptions are optional: an empty title is named `版本 N` inside the entity lock. Business operation failures remain in jobs/audit; the synchronization error field is populated only if rebuilding the read model fails.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
