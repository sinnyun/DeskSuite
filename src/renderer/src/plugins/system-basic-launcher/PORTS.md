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

No MCP tools, events, or config keys are consumed.
