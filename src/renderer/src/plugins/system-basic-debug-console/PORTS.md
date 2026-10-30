# PORTS — system-basic-debug-console (renderer)

Renderer plugin that surfaces the workbench log stream: activity-rail entry, bottom dock tab,
toolbar actions and a status-bar counter.

## Metadata

| Field | Value |
| --- | --- |
| Kind | renderer plugin |
| Domain | `system` |
| Category | `basic` |
| Name | `debug-console` |
| Entry | `index.tsx` |

## Slot contributions

| Slot | Contribution id | Content |
| --- | --- | --- |
| `sidebar.activity` | `console.activity` | Terminal button; toggles the bottom dock |
| `bottom.tabs` | `console` | Tab titled 调试控制台; the `label` component shows a live error-count badge |
| `bottom.content` | `console` | `ConsolePanel` — level filter bar + search, newest-first log list with expandable payloads |
| `bottom.toolbar` | `console.toolbar` | Copy filtered logs, export JSON, clear |
| `statusbar.right` | `console.status` | Log count + error count pills; click opens the console tab |

## Services

Provides: none.
Consumes: `ui` (required).

## Data sources

- Host log store (`useLogs`, `logStore`, `log`) — renderer logs plus `runtime:log` broadcasts from
  `system-basic-runtime-log` in the main process.
- `clipboard.writeText` IPC for copying the transcript.
- `filesystem.saveText` IPC for exporting the filtered log as JSON (OS save dialog).

## Behaviour notes

- The activity button shows the current log count as a badge.
- View filters (levels/search/expanded) live in the plugin-local `consoleViewStore`; they are not persisted.
- Clearing logs is local to the log store; the main-process ring buffer is untouched.
