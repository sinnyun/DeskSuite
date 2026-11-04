# Data Operations: File Actions

- Domain: `data`
- Class: `ops`
- Name: `file-actions`
- Entry: `index.tsx`

## Dependencies

- Renderer service `selection` from `data-ops-explorer` (optional; the overlay stays inert when unavailable).
- Main process command registry `commands`; context-menu file actions dispatch `file.*` definitions through the shared approval flow.
- Main process IPC service `fileOps`.
- Main process events `fileOps:approval`, `fileOps:done`, `job:progress`, `job:done`, and `fs:changed`.
- Undo entries are read through `fileOps.getUndoStack()` and refreshed from `fileOps:undo-stack`.
- Renderer host slot `overlay.root`.

## Contributions

- `file-actions.overlay` contributes the global operation menu, human approval dialog, and fixed size progress panel.

## IPC consumed

- `fileOps.plan({ op, sources, target?, conflictPolicy? })`
- `fileOps.approve(planId)`, `fileOps.reject(planId)`, `fileOps.execute(planId)`, `fileOps.get(planId)`, `fileOps.cancel(planIdOrJobId)`, and `fileOps.startDrag(paths)`.
- `fileOps.getUndoStack()` and `fileOps.undo(undoId?)`; successful undo returns a `jobId`, while stale/conflict returns a status and message.

## Data and settings

- The progress panel exposes the latest reversible operation when the undo stack is nonempty and expands completed jobs to show every item status and message.
- No persistent data or configuration is owned by this renderer plugin.
- Interface copy is Chinese.
- Contributes a `explorer.workspace` context-menu entry group (order 20, merged below the explorer's own order-10 menu with a separator): on selected entries a "文件操作" submenu (app clipboard copy/cut, copy / move / rename / trash with approval plans) plus an OS "拖到其他应用" drag-out item; on blank space a paste item (labelled with the pending clip count and disabled reasons) and "新建文件夹…". Requires the `contextMenu` service; registration is skipped when it is missing.
