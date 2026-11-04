# PORTS — data-ops-explorer-versions

Renderer UI for Lore file history. Lore content and metadata are owned by main-process plugins.

## Metadata and contributions

- Domain / category / name: `data` / `ops` / `explorer-versions`.
- `sidebar.right.tabs` and `sidebar.right.content`, contribution ID `versions`.
- Uses the Explorer `selection` service; if unavailable or no regular file is selected, it shows an empty state.
- The timeline combines `versions.list(path)` with revisions from `versions.branchGraph(path, true)`, deduplicates by immutable version ID, and displays branch membership. Revisions from other or archived branches remain available for restore in the same history list.

## Main-process IPC

Consumes `versions.list(path)`, `preview(path,versionId)`, `state(path)`, `create(path,title)`, `restore(path,versionId,confirm)`, `abandonInterruptedRestore(path,versionId,confirm)`, `branchGraph(path,includeArchived?)`, and `branchAction(path,action,confirm)`. Preview bytes arrive as a bounded data URL through IPC; the renderer never reads userData paths. Mutations return a job ID or result; a 120 ms per-path scheduler coalesces adjacent history-change events into one full refresh, while `kind: "source"` changes refresh only status. Tracked `job:done` updates task notices and errors without starting another full refresh. Preview values and in-flight requests are cached by path and immutable version ID. Refresh and preview responses are discarded after the selected path changes.

Restore requires an in-product confirmation and is checked again by the main process against forbidden directories and unsaved content changes; local operations never expand MCP write roots. An interrupted restore exposes a resume action only for its recorded target. If the source changed externally, the user may confirm that the restore fence should be cleared while preserving the current file. MCP confirmation is controlled separately by the host MCP Full-access gate; abandoning only removes the internal restore journal and does not require the source path to be in a write root.

The compact panel uses white/gray cards for state and current-version summary, a purple save action, a vertical-node version timeline, and purple/cyan/gray branch tracks for current, active, and archived branches. Interrupted restore keeps both safe paths and their conditions visible: resume is enabled only when the source is unchanged or already matches the target; abandon is enabled only after an external change and preserves the current file. The main-process provider sanitizes unavailable-source `diagnostic` text with the shared error formatter before returning it over IPC; `diagnostic` and `synchronizationError` are also passed through the bounded, credential/path-scrubbing renderer helper before display. If the source is unavailable, the panel shows a safe diagnostic and disables both actions. All visible copy is Chinese. The panel scrolls internally within the host right sidebar.

Failed background version jobs clear the submission notice and refresh interrupted restore state before displaying the error through the shared bounded, credential/path-scrubbing renderer error-text helper.

Normal list/state/branchGraph refreshes read the persistent database only, including panel reopen and renderer restart. Explicit `versions.reconcile(path,true)` is available for legacy or failed synchronization; it is never called automatically. Unknown/unavailable states have distinct Chinese UI labels. All real create/restore/branch operations publish fresh persisted metadata before completion events.

UI mutations handle `requiresApproval` command plans through approve/execute before using jobId. Restore/abandon reuse their explicit confirmations. Empty descriptions keep Save enabled and receive an automatic version name. Submission notices clear on job completion.

Cancelled confirmation ends normally without a failure notice.

## Context menus

Registers `versions.panel` (order 10): version rows (`data-version-id`) offer restore and copy description; branch rows (`data-branch-name`) offer switch / merge / archive with disabled reasons while a version task is running; blank space offers refresh status, sync metadata and create branch.
