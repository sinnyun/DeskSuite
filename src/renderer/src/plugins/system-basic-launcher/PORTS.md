# PORTS — system-basic-launcher (renderer)

Search and launch installed applications from a fixed-size floating panel.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `system` / `basic` / `launcher` |
| Entry | `index.tsx` |
| Main capability | `system-basic-launcher` |

## Contributions

- `sidebar.activity`: opens the launcher panel.
- `floating.panels`: `launcher.panel`, resizable initial size 1240×760 px with category rail, app card grid and selected-program inspector.

## Services and IPC

Consumes `ui` and `launcher.list(query?, offset?)`, `launcher.summary(query?)`, `launcher.refresh()`, `launcher.open(id)`, `launcher.icon(id)`,
`launcher.groups()`, `launcher.createGroup(name)`, `launcher.renameGroup(id, name)`, `launcher.deleteGroup(id)`,
and `launcher.assignGroup(id, groupId?)`. The panel supports user categories and per-program classification.

Renderer IPC results consumed by panel state are runtime-decoded with plugin-local Zod schemas: paged entries (maximum 250), groups (maximum 100), summary counts, and nullable image data URLs. Invalid responses are rejected and shown through the panel's normal error path; icon decode failures fall back to the generic icon.

No MCP tools, events, or config keys are consumed.

## Context menus

The panel content registers `launcher.panel` (order 10): launch entries (`data-launcher-entry/-name/-path`) offer launch, reveal in the file manager, copy path, an assign-to-group submenu (ungrouped plus each group, current group checked) and rescan; group rows (`data-launcher-group/-name`) offer rename and delete; blank space offers rescan. Requires the `contextMenu` service.
