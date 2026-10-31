# PORTS — project-provider-workcrate-boards

WorkCrate's adapter for the official VectorCraft CLI. WorkCrate owns project material-bar data and writes its native representation to VectorCraft documents; VectorCraft owns ordinary canvas editing, display, and export.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `project` / `provider` / `workcrate-boards` |
| Entry | `index.ts` |
| Injects | `ipc`, `mcp`, `settings`, `window`, `workcrateProjects` |
| Provided IPC | `workcrateBoards` |
| Consumed service | `workcrateProjects` |
| Settings | `vectorcraft` |

## IPC

- `getConfig()` / `setConfig({ cliExecutable, guiExecutable, defaultImageFormat, port })` configure VectorCraft.
  Executable paths are trimmed and matching surrounding single/double quotes are removed, including when reading existing settings copied with Windows “Copy as path”.
- `getDocumentPath(projectId)` returns the associated native document path.
- `openProjectFolder(projectId)` reveals the associated document in the file manager.
- `openInVectorCraft(projectId)` opens the document with the configured GUI (or the executable beside the CLI), enabling its control server for live synchronization.
- `boardCatalog(projectId)` reads the local board cache.
- `preview(projectId, boardId)` returns a PNG data URL from the project-owned preview cache.
- `refresh(projectId)` explicitly reads the saved document with the official CLI, refreshes the board catalogue, and stores page previews.
- `createProjectDocument({ projectId, directory })` creates and associates a native VectorCraft document in a user-selected existing folder. The selected folder is the authorization scope for this UI operation; it does not change global MCP write roots.
- `createPage(projectId)` adds an A3 landscape artboard to the associated document.
- `updateInfo({ boardId, info })` creates or updates the WorkCrate material bar and structured fields in the associated native document.

## MCP tools

- `workcrate_panel_open()` opens the WorkCrate floating panel in DeskSuite through a renderer event.
- `workcrate_vectorcraft_config_get()` reads the VectorCraft executable and control-port settings.
- `workcrate_vectorcraft_config_set({ config, confirm: true })` validates executable paths and updates the VectorCraft settings. Requires full MCP access and explicit confirmation.
- `workcrate_project_create({ name, directory, confirm: true })` creates a WorkCrate project, its native `.vectorcraft` document, an initial board, and the initial material bar. `directory` must be under a configured `mcp.writeRoots` path. Returns the project, document path, initial board catalogue, project-data path, and any portable-relocation warning.
- `workcrate_document_create({ projectId, directory, confirm: true })` creates and associates a native document for an existing project. Requires full MCP access and a configured writable root.
- `workcrate_board_catalog({ projectId })` reads the cached board catalogue.
- `workcrate_boards_refresh({ projectId })` explicitly updates the catalogue and preview cache from the saved native document.
- `workcrate_board_create_page({ projectId, confirm: true })` creates an A3 artboard.
- `workcrate_board_update_info({ boardId, info, confirm: true })` writes WorkCrate-owned material-bar content to the native artboard.

MCP mutations follow the shared path policy and require the configured access level. The MCP project-create tool also requires `confirm: true` and an allowed `mcp.writeRoots` directory. UI operations use the explicit folder selected by the user and keep `app.getPath('userData')` forbidden.

## Storage and lifecycle

- The Projects service owns project metadata and project-data locations.
- This plugin stores `boards-cache.json` and `native-previews/` in the project data directory. Cache records bind to the current native document association.
- CLI sessions are hidden, bounded headless processes with explicit document read/write roots and project-scoped CLI configuration.
- A WorkCrate material-bar save writes the native VectorCraft objects and structured metadata, saves the native document, then refreshes the board cache.
- Ordinary VectorCraft editing stays in VectorCraft. WorkCrate sync reads the saved canvas and refreshes cached board previews; it does not provide canvas editing; page export delegates to the native export commands.

## Events

- `workcrate:boards-changed` is broadcast after document association, cache refresh, or a successful native mutation.


## Live synchronization and ordering

- `reorderPages({ projectId, boardIds })` (IPC) and `workcrate_boards_reorder({ projectId, boardIds, confirm: true })` (MCP) validate the complete current board list, write native artboard order and page-number headers, save, and refresh previews.
- `workcrate_document_open({ projectId, confirm: true })` opens the desktop editor with its control server and document-scoped automation roots (or connects to the existing server). The optional GUI executable defaults to the executable beside the configured CLI.
- `workcrate_panel_open({ projectId?, boardId? })` opens the project repository, page manager, or specified page editor.
- Saved-file stamps and live desktop revisions are checked every 1.5 seconds, serially per project. Errors emit `workcrate:sync-error` with `{ projectId, message }` and are retried.
- Reads and edits use the matching active desktop document, including unsaved edits. WorkCrate edits save that live document. Mutations reject a different active document; switch to the project in VectorCraft first. A desktop launched externally must enable `--control <configured port>` for live synchronization; without control, saved-file sync remains available.

`workcrate_panel_open` also accepts optional `section: connection | basic` to open the corresponding program-default settings tab.

### Empty desktop state

A connected desktop with no open document is normal: automatic revision checks skip it, explicit read sync uses the saved file in a headless session, and mutations open the bound project in the empty desktop before editing. `openInVectorCraft` / `workcrate_document_open` also recover an empty desktop. Only the explicit `no document open` inspection error is treated as absence; connection and other inspection failures still propagate. Successful automatic recovery emits `workcrate:sync-recovered` with `{ projectId }` so the renderer clears stale automatic-sync errors. Other active documents remain protected from implicit replacement during mutations.

## Native page export and selection

- IPC `exportBoards({ projectId, directory, boardIds?, format: png|jpg|pdf, scale?: 1 })` exports to an existing user-selected folder. Selection authorizes only that folder, without changing global MCP roots.
- MCP `workcrate_boards_export({ projectId, directory, boardIds?, format, scale?, confirm: true })` requires full access and a directory under configured write roots. Omitting IDs exports all boards; empty, duplicate, foreign and stale IDs are rejected. Selected boards retain native document order.
- Images invoke VectorCraft `document.export` for each artboard; PDFs invoke `document.exportPdf` with all requested artboard indices, producing one multi-page PDF. No screenshots or preview-cache images are used. The native returned bytes are validated and exclusively written in a new unique export subfolder; existing files and the native document are not overwritten. Export reads live unsaved data when the matching desktop document is active.
- Results are `{ directory, files, warnings }`. Image scale is 0.25–4; individual images are limited to 40 million pixels and the MCP response limit. Partial failures report their folder and completed file count; already completed outputs are retained. Document binding and revision are rechecked before writing each output.
- MCP `workcrate_pages_select({ projectId, mode: single|multiple|all|clear, boardIds?: [] })` validates current cached page IDs and emits `workcrate:pages-selection` with `{ projectId, mode, boardIds }`; the mounted page manager applies that selection. It does not change native artwork selection.


## Quick create from a material table

- IPC `previewQuickCreate(text)` parses Excel/WPS TSV or CSV with quoted cells, doubled quotes and multiline values. Chinese headers may be reordered; unknown headers become extra material fields. Without headers the six columns are page title, material category, material, size label, size and quantity. Empty rows are ignored.
- IPC `quickCreate({ projectId, table: { columns, rows }, reuseInitial?: true })` creates one A3 landscape canvas per effective row, writes native material headers, saves once, and refreshes previews. Quantity is material metadata, not a canvas multiplier. Limit: 1–200 rows, 30 columns, 24 extra fields. Titles default to page numbers. Existing artwork is preserved; the sole initial board is reused only when material metadata is empty and all artwork belongs to WorkCrate's header.
- MCP `workcrate_quick_create_preview({ text })` exposes the same parser without writes. `workcrate_quick_create_open({ projectId, text? })` opens an editable draft through `workcrate:panel-open` with `quickCreate: true` and optional `table`.
- MCP `workcrate_boards_quick_create({ projectId, table, reuseInitial?: true, confirm: true })` uses configured full access/write roots. The UI authorizes only the existing associated document folder. Returns `{ count, reusedInitial, boards }`.
- Each batch runs serially per project in one native undo group. Row failures cancel the group before saving; errors identify the row. A post-save preview failure explicitly asks to refresh instead of importing again. Native material-bar layout limits still apply. `header.ts` accepts an internal `manageUndo` flag so batch writes share their outer undo group.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
