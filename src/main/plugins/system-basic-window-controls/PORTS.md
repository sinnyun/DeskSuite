# PORTS — system-basic-window-controls

Frameless window controls for the custom title bar.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `system` |
| Category | `basic` |
| Name | `window-controls` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `window`

## IPC services provided

Service name: `windowControl`

| Method | Arguments | Returns |
| --- | --- | --- |
| `minimize` | — | `true` |
| `toggleMaximize` | — | `boolean` (maximized after toggle) |
| `close` | — | `true` |
| `reload` | — | `true` |
| `state` | — | `{ maximized, fullscreen, focused }` |

## MCP tools provided

None.

## Events broadcast

| Channel | Payload | When |
| --- | --- | --- |
| `window:state` | `{ maximized, fullscreen, focused }` | maximize / unmaximize / fullscreen / focus / blur |

## Config keys consumed

None.
