# PORTS — data-ops-quick-bookmarks

- Metadata: domain `data`, category `ops`, name `quick-bookmarks`, entry `index.ts`.
- Injects: `ipc`, `mcp`, `store`. No exported provider service or consumed config keys.
- IPC `quickBookmarks.act({ action, groupId?, itemId?, name?, paths?, path? })`: actions `list`, `createGroup`, `renameGroup`, `deleteGroup`, `add`, `edit`, `remove`; returns all groups. Group/item IDs are stable UUIDs (default group ID `common`). Add accepts multiple absolute existing directories and deduplicates within each group; edit requires name and directory path. Writes are serialized and atomic; failed validation preserves previous data. Limits: 100 groups, 1000 entries/group, 120 characters/name.
- IPC `quickBookmarks.complete(requestId, { value?, error? })`: renderer acknowledgement for MCP pane operations.
- MCP `quick_bookmarks`: same arguments as `act`; mutating, low impact. Removes references only, never filesystem contents.
- MCP `quick_bookmarks_explorer({ action: navigate | select | addSelected | open, path?, paths?, groupId?, itemId? })`: operates active pane through a renderer request, 15s acknowledgement timeout. `select` validates current entries; `addSelected` captures selected folders only; `open` resolves stored bookmark.
- Events: `quickBookmarks:changed` invalidates group snapshots; `quickBookmarks:explorer` carries renderer request and ID.
- Persistence: versioned Store key `quick-bookmarks`, isolated with Electron userData. Initial group 常用; deleting all groups remains empty after restart. Missing targets are retained and produce visible navigation errors.


`quick_bookmarks_explorer` also accepts `action: "view"` with required `viewMode: "list" | "grid" | "gallery" | "grouped"` to use the active pane's existing view switch. No filesystem writes.


View composition: display mode list/grid/gallery and per-pane `groupingEnabled` are independent and persisted together. Legacy `viewMode: grouped` restores as grid + grouping enabled. Explorer owns the shared 152px FileCard and supplies list/grid/gallery renderers for each group. Embedded lists use bounded virtual scroll and group-local select-all; gallery has one preview stage per pane, with a 20% single-card-column navigation rail (192px minimum) and an 80% viewer. Group layout, collapse and recursive scope apply to the rail only; the focused file is previewed once. MCP `quick_bookmarks_explorer` action view accepts optional `viewMode`, `groupingEnabled`, `groupBy` (kind/modifiedMinute/rating/folder), `includeChildren`, and returns current composition. Legacy grouped remains an MCP compatibility alias. Group options are passed only via renderer service injection.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
