# data-ops-index-scan

- Domain / class / name: `data` / `ops` / `index-scan`
- Entry: `index.ts`
- Dependencies: Cordis `db`, `ipc`, `mcp`, `jobs`, `audit`, `settings`, and `commands`.
- Settings namespace `indexing`: `roots` (up to 32 absolute roots, default empty) and `ignore` (default ignored directories plus optional glob patterns). The MCP/IPC scan call can override either setting.

## IPC

Service: `indexScan`.

- `start(roots, ignore?)` starts one cancelable background scan and returns `{ jobId }`.
- `cancel(jobId)` cancels a running scan between directory entries / batches.
- `status()` returns the currently running job ID and roots.
- Traversal uses `fs.opendir`, skips symlinks and the default ignored directory names (`node_modules`, `.git`, `$RECYCLE.BIN`, `System Volume Information`). Optional `*` and `?` ignore patterns match entry names or root relative paths.
- Upserts are committed in batches of 500. Rows absent from the seen set are removed only after every root finishes; canceled or failed scans retain existing rows and never run stale cleanup.
- Stale cleanup keyset-pages `files` and `folders` by descending `path_key`, reading at most 500 rows at a time. All pages and staging-row removal are enclosed in one outer transaction, so cleanup remains all-or-nothing; nested page transactions use savepoints. Root containment is checked against the normalized path in JavaScript (not SQL `LIKE`). The completed job summary includes `staleFilesRemoved` and `staleFoldersRemoved`; cleanup begins only after a complete scan and does not yield between pages.
- Synthetic `devlab://` rows are outside filesystem roots and are not affected.

## MCP

- `index_scan({ roots?, ignore? })` starts the same background job, using configured roots/rules when omitted. It is a low impact mutating tool and requires the configured MCP access level for writes.
- Registers `index.scan` in the command registry; it previews configured roots and requires approval before scanning.

## Storage and events

- Uses the injected `db` service and only writes catalog `files`, `folders`, and private `index_scan_seen` staging rows.
- Uses shared `jobs` progress/done events and records completion through `audit`.
- Emits no custom broadcast events.
