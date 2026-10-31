# system-basic-session

- Domain / class / name: `system` / `basic` / `session`
- Entry: `index.ts`
- Injected services: `ipc`, `store`
- Persistence: version 1 `session.json` and `workspaces.json` documents, registered with the atomic store. Writes are coalesced with a 500 ms debounce; callers may invoke `flush` before an orderly shutdown or explicit checkpoint.

## IPC services

### `session`

- `get()` returns the active session snapshot.
- `set(patch, paneId?)` merges validated session fields and nested scroll/width values, then schedules persistence. A supplied pane ID updates that pane in the active workspace and mirrors it to `session.json`; without one, the first pane is updated for compatibility.
- `reset()` restores defaults in the active pane and mirrors that state to `session.json`.
- `flush()` writes pending session and workspace snapshots immediately.

Session fields include current path, view mode, sort field/order, search and kind/tag/favorite/rating filters, selected/focused paths, scroll anchor path and offset, left/right/bottom pane dimensions, and expanded directories.

### `workspaces`

- `list()` returns `{ activeId, activePaneId, items }`; `get(id)` and `active()` read one workspace.
- `create(name, layout?)`, `rename(id, name)`, `setLayout(id, layout)`, `setPane(id, paneId, state)`, `activate(id, paneId?)`, and `remove(id)` manage workspaces.
- Updating the active pane with `setPane` also mirrors that pane into `session.json`. Switching workspaces or panes updates both the active workspace and pane IDs.
- Layout is restricted to 1, 2, or 4 panes. Each pane owns a complete session snapshot. Changing layout preserves existing panes and creates defaults for newly added panes.
- `flush()` writes pending snapshots immediately.

All fields are validated in the main process by Zod before entering memory or the store. Removing the active workspace selects the first remaining workspace; removing the last one clears the active workspace and resets the current session. The renderer remains responsible for collecting UI state and restoring it through these IPC services.


View composition: display mode list/grid/gallery and per-pane `groupingEnabled` are independent and persisted together. Legacy `viewMode: grouped` restores as grid + grouping enabled. Explorer owns the shared 152px FileCard and supplies list/grid/gallery renderers for each group. Embedded lists use bounded virtual scroll and group-local select-all; gallery has one preview stage per pane, with a 20% single-card-column navigation rail (192px minimum) and an 80% viewer. Group layout, collapse and recursive scope apply to the rail only; the focused file is previewed once. MCP `quick_bookmarks_explorer` action view accepts optional `viewMode`, `groupingEnabled`, `groupBy` (kind/modifiedMinute/rating/folder), `includeChildren`, and returns current composition. Legacy grouped remains an MCP compatibility alias. Group options are passed only via renderer service injection.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
