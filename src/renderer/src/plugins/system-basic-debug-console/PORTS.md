# PORTS — system-basic-debug-console (renderer)

Aggregates application actions, IPC request/response traffic, main-process broadcasts, MCP calls, and manually reported renderer logs in a resizable floating panel.

## Metadata

| Field | Value |
| --- | --- |
| Kind | renderer plugin |
| Domain / category / name | `system` / `basic` / `debug-console` |
| Entry | `index.tsx` |

## Contributions

| Slot | Contribution | Purpose |
| --- | --- | --- |
| `sidebar.activity` | `console.activity` | Opens or closes the debug floating panel |
| `floating.panels` | `debug-console.panel` | Resizable 1320×820 panel with category/level filters, search, collapsible traces, payload inspection, copy, export, and clear |
| `statusbar.right` | `console.status` | Record/error counts; opens the floating panel |

## Services and data

- Consumes `ui` and the workbench layout/log stores.
- Reads IPC/MCP/broadcast diagnostics from `runtime:log`; renderer feature logs enter through the workbench `log()` API.
- The workbench bridge records renderer send/receive phases; `IpcService` records main-process request/response data. Shared operation trace IDs group both sides and any synchronous broadcasts.
- `mcp/tool-call` records include arguments, results, duration, and trace ID. Renderer plugins can add semantic action/processing/result entries through `log()` metadata or use `callWithTrace()` to group multiple IPC calls.
- The console applies a plugin-local Chinese label catalog to sources, IPC services/methods, MCP tools, event channels, phases, and common payload keys. Search matches both Chinese display text and original identifiers; raw identifiers remain available in tooltips and JSON export. Unknown identifiers use Chinese fallback labels and do not affect capture or business services.
- Payloads redact credential-like keys and are bounded to 48 KB per record; long strings/arrays are limited, and base64 data URLs are summarized by MIME type and estimated byte size.
- The in-memory ring buffer retains up to 3000 records. Clearing is local to the visible log store; main-process history remains until application restart.
