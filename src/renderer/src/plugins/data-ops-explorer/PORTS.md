# PORTS — data-ops-explorer (renderer)

Renderer plugin that implements the file explorer surface: directory tree sidebar, toolbar, list /
card / gallery / grouped workspace views, property inspector, status-bar summary, and independent 1 / 2 / 4 pane workspaces.

## Metadata

| Field | Value |
| --- | --- |
| Kind | renderer plugin |
| Domain | `data` |
| Category | `ops` |
| Name | `explorer` |
| Entry | `index.tsx` |
| Main capability | `data-ops-filesystem` |

## Slot contributions

| Slot | Contribution id | Content |
| --- | --- | --- |
| `sidebar.activity` | `explorer.activity` | Activity-rail folder button (toggles left sidebar) |
| `sidebar.left.tabs` | `files` | Tab titled 资源管理 |
| `sidebar.left.content` | `files` | `FileTree` — quick access, drives, custom quick bookmark groups |
| `workspace.toolbar` | `explorer.toolbar` | Row 1: back/forward/up/refresh/open-folder, clickable path breadcrumb, current-folder search, basket. Row 2: workspace/pane controls, kind/tag/rating filters, favorites-only, clear filters, sort field/order and current-view controls. Optional `data-ops-explorer-grouped` supplies an inline grouped-mode switch and group controls for row 2. |
| `workspace.views` | `explorer.views` | `FileWorkspace` — list / grid / gallery / grouped by `viewMode` |
| `sidebar.right.tabs` | `inspector` | Tab titled 属性信息 |
| `sidebar.right.content` | `inspector` | `Inspector` — multi-select summary, metadata editing, text/image/media preview, actions |
| `statusbar.left` | `explorer.status` | Path, folder/file counts, selected count, focused item, filter count, total size, virtual-scroll hint |

## Interaction

- Multi-select: `Ctrl`/`Meta` click toggles, `Shift` click selects a range, plain click replaces; `FileTree` highlights the current directory.
- Metadata: favorite, 1–5 star rating, free-form tags; persisted by absolute path, empty records pruned.
- Filter/sort: kind, tag, minimum rating, favorites-only, search; sort by `name` / `modifiedAt` / `size` / `kind` / `rating` with ascending/descending toggle.
- Gallery: 50%–200% zoom (image scale, text width/font), video/audio playback, bottom filmstrip (max 80 items).
- Grouped view is supplied by optional `data-ops-explorer-grouped`; its toolbar supports kind, modification minute, rating, and containing-folder groups, preserves current order within groups, and can recursively aggregate child folders.
- Inspector: multi-select summary, favorite/rating/tag editing, line-numbered text preview (max 400 lines), audio/video playback, manifest JSON export.

## Services

Provides (renderer service registry):

- `selection` — `{ getSnapshot(), subscribe() }`; snapshot `{ path, entries, selected }` for the
  active pane's directory and selection.
- `panes` — snapshot/subscription plus `getActiveStore()`, `setActivePane(id)`, `setLayout(1|2|4)`,
  `activateWorkspace(id)`, `createWorkspace(name)`, `initialize()`, `showTagAggregate({ tagId, name })`,
  and `clearTagFocus()`; exposes workspace layout, pane stores, active pane, and the workspace catalog.
  `showTagAggregate` switches the active pane to a virtual listing of every file carrying the tag
  (including descendant tags) regardless of directory; any directory navigation exits that mode.

Consumes:

- `ui` (required) — primitives from `system-provider-ui-kit`.
- `basket` (optional) — offered by `data-ops-explorer-insights`; the toolbar/暂存 buttons render only
  when the service exists.

## Main-process IPC used

| Service | Method | Purpose |
| --- | --- | --- |
| `filesystem` | `drives` / `quickAccess` | Shortcuts and drive capacity |
| `filesystem` | `listDir` | Directory listing (also for lazy tree expansion) |
| `filesystem` | `listMore` | Append the next 200 entries without resetting selection or scroll |
| `filesystem` | `statPaths` | Stat changed paths reported by `fs:changed` for incremental row updates |
| `filesystem` | `readText` | Text preview in inspector |
| `filesystem` | `readImage` | Full image preview in the inspector |
| `thumbnails` | `get(path, 320)` | Lazy 240px JPEG gallery/filmstrip thumbnails, backed by the bounded main-process cache and a renderer cache of at most 60 entries / 3.5 MB |
| `filesystem` | `readMedia` | Audio/video preview (64MB cap, returns a data URL) |
| `fileOps` | `saveText` / `approve` / `execute` | Export manifest JSON through a planned, approved write operation |
| `fileOps` | `startDrag` | Start the native OS drag for list/grid/gallery file items and the current selection |
| `filesystem` | `open` / `reveal` / `pickDirectory` | Open with OS, reveal in folder, choose folder |
| `clipboard` | `writeText` | Copy full path / text content |
| `session` | `get` / `set(patch, paneId?)` | Restore and mirror the active pane session snapshot |
| `workspaces` | `list` / `create` / `setLayout` / `setPane` / `activate` | Restore, create, switch, resize, and persist workspaces and pane state |
| `watch` | `setPaneDirectories` / `clearPane` | Watch each pane's current and expanded directories; in tag-aggregate mode, the distinct parent directories of aggregated entries (up to 16 globally) |

Consumes the `fs:changed` bridge event. Changes inside a pane's current directory are applied incrementally: only changed paths are re-statted, existing rows are updated, new entries appended, and deleted entries removed, keeping selection and scroll. The tag-aggregate view behaves the same for paths already in the aggregate; untagged files elsewhere in those directories are ignored. A full reload happens only when `invalidate` is set (more than 200 changes in one batch).

## Renderer storage

- Pane path, view, filters, sorting, selection, focus, scroll anchor, pane widths, expanded
  directories and tag-aggregate focus (`{ tagId, name }`) are persisted by `workspaces` and mirrored
  for the active pane by `session`; a restored tag focus reopens the aggregate instead of a folder.
- `desksuite.explorer.thumbnails` stores only bounded JPEG data URLs for gallery rendering (60 entries / 3.5 MB); source files and metadata remain owned by main-process services.
- Legacy `desksuite.explorer.meta` is imported once through the annotations IPC service and removed
  only after a successful import. Current annotations are owned by `data-ops-annotations`.

## Logs

Channel prefix `Explorer` (lifecycle, navigation, errors, basket additions).

## Quick bookmark groups

The previous current-directory subtree is replaced by `QuickBookmarks`: create/rename/delete groups, fold groups, add selected folders from the active central pane with each group's + button, edit bookmark names/absolute paths, remove references, and click to navigate. Quick access and drives remain. Group deletion requires inline confirmation; reference deletion never deletes files. Empty selection disables +; mixed selection adds folders only. Errors appear inline and long paths truncate with full-path tooltips.

Consumes IPC `quickBookmarks.act` / `complete` and events `quickBookmarks:changed` / `quickBookmarks:explorer`. The plugin setup installs the MCP renderer request listener and removes it on teardown. Persistent data belongs to the main `data-ops-quick-bookmarks` plugin (Store), with no new localStorage keys. The renderer MCP bridge reuses the same add-selected/open functions as UI controls.

## Network drive toggle

The drive section header provides a network icon toggle (`aria-pressed`, Chinese tooltip), initially showing all drives. Turning it off filters `DriveInfo.isNetwork` entries from the sidebar only. Network drives also use a network icon. The renderer reads `filesystem.getDrivePreferences`, writes `filesystem.setDrivePreferences`, and subscribes to `filesystem:drivePreferences` so MCP updates and UI changes share persisted state. The control is disabled while loading/saving, and failures appear inline. No new localStorage keys.


File drag / 文件拖动：list/grid/gallery 的文件项、画廊大图预览与详情面板图片预览在 `dragstart` 中调用 `fileOps.startDrag`（命中当前选择时拖出整组选中文件，否则只拖出自身，仅文件），由主进程 `webContents.startDrag` 发起原生拖拽，可直接放到资源管理器等外部应用；应用内拖放目标按原生 `Files` 接收。缩略图与预览 `<img>` 统一设置 `draggable={false}`，避免浏览器自带的图片拖拽抢占文件拖拽。目录不可拖动。


Concept-aligned presentation: blue accents, compact controls, flat inspector sections, fixed 152px grouped cards with file size, rating and favorite indicators. The grouped layout consumes `renderGroup(entries)` and `getRating(path)`; cards belong to the explorer. Explorer forwards MCP `quick_bookmarks_explorer` view actions to the active pane.

Toolbar refinement: 28px controls, combined workspace caption and create/pane controls, persistent tag filter, right-aligned sort/view/group/scope controls. Pane layout contributes to `top.actions` via explorer; compact widths wrap the display group intact.


View composition: display mode list/grid/gallery and per-pane `groupingEnabled` are independent and persisted together. Legacy `viewMode: grouped` restores as grid + grouping enabled. Explorer owns the shared 152px FileCard and supplies list/grid/gallery renderers for each group. Embedded lists use bounded virtual scroll and group-local select-all; gallery has one preview stage per pane, with a 20% single-card-column navigation rail (192px minimum) and an 80% viewer. Group layout, collapse and recursive scope apply to the rail only; the focused file is previewed once. MCP `quick_bookmarks_explorer` action view accepts optional `viewMode`, `groupingEnabled`, `groupBy` (kind/modifiedMinute/rating/folder), `includeChildren`, and returns current composition. Legacy grouped remains an MCP compatibility alias. Group options are passed only via renderer service injection.

Gallery no longer writes the legacy `desksuite.explorer.thumbnails` renderer cache; shared FileCard requests thumbnails through the existing main-process thumbnail service.
