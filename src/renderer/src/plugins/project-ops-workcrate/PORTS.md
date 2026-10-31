# PORTS — project-ops-workcrate

Renderer extension for managing VectorCraft projects and viewing cached native artboards and material data.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `project` / `ops` / `workcrate` |
| Entry | `index.tsx` |
| Main services | `workcrateProjects`, `workcrateBoards` |

## Contributions

- `sidebar.activity`: opens the WorkCrate floating panel.
- `floating.panels`: project repository, native artboard matrix, cached artboard preview, and read-only material sidebar.

## Current workflow

1. Create a project by choosing a destination folder. WorkCrate creates a native `.vectorcraft` document there through the official CLI and keeps its own project metadata beside it.
2. Treat each VectorCraft artboard as a WorkCrate page. The page matrix shows local cached previews and the material fields read from the native document.
3. Edit artwork and export in VectorCraft. Use the WorkCrate material sidebar to edit material values; saving writes the native material bar through the official CLI. After editing artwork in VectorCraft, use Sync to refresh the board catalogue, cached previews, and material data.
4. WorkCrate creates the native material header on new documents/artboards and owns the material form. Saving material values updates that header in the native VectorCraft document through the official CLI.

## IPC used

- Projects: `list(includeArchived?)`, `get(projectId)`, `create(name)`, `delete(projectId)`, `relocateProject({projectId,directory})`, and `getDocumentPath(projectId)`.
- Boards: `boardCatalog(projectId)`, `preview(projectId,boardId)`, `createProjectDocument({projectId,directory})`, `createPage(projectId)`, `refresh(projectId)`, `openInVectorCraft(projectId)`, and `openProjectFolder(projectId)`.
- Events: listens to `workcrate:boards-changed`, `workcrate:sync-error`, `workcrate:sync-recovered`, and `workcrateProjects:changed` to refresh visible data or synchronization status; opens the panel on `workcrate:panel-open` requested through MCP.

## Boundaries

- VectorCraft owns the document, rendering, editing, and export. The WorkCrate renderer contains no drawing tools, canvas gestures, object inspector, or artwork export settings; page exports call the native adapter.
- The native preview is a local cache. Unsaved VectorCraft changes appear after saving there and invoking WorkCrate Sync.
- The material sidebar is the WorkCrate plugin's supported editing surface. It edits only material-bar fields and sends those changes to the native document through the Boards adapter. Artwork editing remains in VectorCraft. Batch page export is available in the page manager through native export commands.
- Renderer code uses `window.bridge` through the SDK; it does not import Electron or other plugins.
- No old application project, document, or version data is imported.
- Project lists/snapshots, board catalogues, presets, VectorCraft config, PNG previews, quick-create results and export results are runtime-decoded by plugin-local Zod schemas before entering UI state. PNG data URLs are capped at 45 MB, matching the main-process 32 MiB source limit plus base64 expansion.

## Refresh and page navigation

Tabs are 项目管理 / 页面管理 / 页面编辑. Board-change events update data and previews while preserving the current view and selected board. Page thumbnails reload on refreshed records, including unchanged IDs. The page editor includes New Artboard and draggable page thumbnails. Drops call `workcrateBoards.reorderPages` with the complete board IDs; the backend saves native order. `workcrate:sync-error` is surfaced without navigation; renderer-visible errors use the shared bounded error-text helper to scrub credentials and local paths while retaining Chinese fallbacks. `workcrate:panel-open` is decoded as a strict object with optional project UUID, board ID, settings section, quick-create flag/table and timestamp. Quick tables are limited to 30 columns, 200 rows and 1,024 characters per cell. Malformed requests are ignored with a visible Chinese message.

## Basic-information UI

`BasicInformation.tsx` provides the material suggestion editor and input/dropdown pair, using the host UI service. Program defaults has Connection and Basic Information tabs; the latter edits one option per line and supports adding/removing custom fields. All five main material inputs have adjacent suggestion dropdowns; extra parameter names select custom field labels and their value dropdowns use that field's suggestions. Selection fills the draft; saving the material form writes the native document. Free text remains supported.

Program data uses Projects IPC `getProgramPresets/saveProgramPresets/effectivePresets` and refreshes on `workcrateProjects:changed`. Basic values initialize only when the active board/material changes, preserving a draft during unrelated preview refreshes. Success, progress, and error messages occupy the panel's bottom footer; content scrolls independently.

`workcrate:sync-recovered` clears the matching project’s stale automatic-sync error without navigation.

Board-change events require a project UUID and integer timestamp (plus an optional source-project UUID). Sync errors require a project UUID and a 1–4,096 character message; recovery events require a project UUID. `workcrateProjects:changed` requires a nullable project UUID, positive revision number and integer timestamp. Malformed events are ignored with a short Chinese notice.

## Page manager selection and export

`PageManager.tsx` owns page-card selection (single/multiple, Ctrl/Meta toggle, Shift range, Select All, Clear), stable across catalogue refreshes by board ID. Card selection is separate from the Edit Page action. Switching projects resets selection. It consumes `workcrate:pages-selection` for MCP selection, without changing the native editor's artwork selection.

The toolbar offers selected images, all images, and all PDF pages. Images support PNG/JPG and 1×/2×/4×. The user chooses an output folder via Filesystem IPC; Boards IPC `exportBoards` returns file paths and native warnings for the bottom notification bar. No selection disables selected export. All controls disable during UI operations. Exports invoke VectorCraft's native artboard exporters; previews are only for the cards.


## Quick-create view

`QuickCreate.tsx` is an internal component opened by the page manager's quick-create action after project creation. It supports Excel/WPS clipboard text, CSV, an editable cell table, adding/deleting rows, blank-row counts and a reuse-initial-board option. It calls `workcrateBoards.previewQuickCreate` and `quickCreate` only through the bridge. Success returns to the refreshed page matrix; failure preserves the editable draft and displays bounded error text with credentials and local paths scrubbed. The `workcrate:panel-open` payload may include `quickCreate: true` and a parsed `table` for MCP-driven draft inspection. The panel retains fixed dimensions with internal scrolling; all new copy is Chinese.
