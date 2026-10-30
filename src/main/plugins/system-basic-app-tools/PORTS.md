# PORTS — system-basic-app-tools

Base plugin exposing program-level operations and screenshots to external AI via MCP.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `system` |
| Category | `basic` |
| Name | `app-tools` |
| Entry | `index.ts` |

## Dependencies (inject)

- `mcp`

## IPC services provided

None (surfaces capabilities through MCP only).

## MCP tools provided

| Tool | Arguments | Returns | Notes |
| --- | --- | --- | --- |
| `get_app_info` | — | text (JSON) | App version, platform, electron/node/chrome versions, hardwareAcceleration and gpuFeatures (read-only Electron diagnostics) |
| `list_windows` | — | text (JSON) | id / title / url / visible of all windows |
| `control_window` | `action: focus\|close\|reload\|resize`, `windowId?: number`, `width?: number`, `height?: number` | text | Defaults to main window; resize requires integer content size width 960–7680, height 620–4320 DIP; used by MCP viewport resize verification |
| `capture_window` | `windowId?: number` | image (PNG) | Renders window contents; defaults to main window |
| `capture_screen` | — | image (PNG) | Full primary screen via desktopCapturer |

## Events broadcast

None.

## Config keys consumed

None.
