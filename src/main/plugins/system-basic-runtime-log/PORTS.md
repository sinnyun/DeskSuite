# PORTS — system-basic-runtime-log

Main-process runtime log ring buffer, IPC/MCP/broadcast trace events and runtime environment info.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `system` |
| Category | `basic` |
| Name | `runtime-log` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `mcp`
- `config`

## IPC services provided

Service name: `runtime`

| Method | Arguments | Returns |
| --- | --- | --- |
| `history` | — | `LogEntry[]` newest first (max 3000) |
| `clear` | — | `true` |
| `info` | — | `{ appName, appVersion, electron, chrome, node, platform, arch, mcpPort, mcpTools, services }` |

`mcpTools` is an array of tool info objects `{ name, mutating, impact: 'low'|'high' }[]` sorted by name,
used by the control center to render read-only / write (low) / write (high) badges. It carries no access
level; the current level is read separately via `mcp.getAccess`.

`LogEntry` also supports `category`, `traceId`, `phase`, `durationMs`, and `status`. Input/output payloads are credential-redacted and bounded to 48 KB per entry; the main ring buffer retains 3000 entries.

## MCP tools provided

| Tool | Arguments | Returns |
| --- | --- | --- |
| `get_runtime_logs` | `limit?: number` (1-500, default 50) | text (JSON) |
| `clear_runtime_logs` | — | text |

## Events consumed

| Event | Payload |
| --- | --- |
| `mcp/tool-call` | `{ name, phase: start\|end, traceId, args?, result?, ms?, error? }` |
| `ipc/invoke` | `{ requestId, service, method, phase, args?, result?, durationMs?, error? }` |
| `ipc/broadcast` | `{ channel, payload }` |

## Events broadcast

| Channel | Payload |
| --- | --- |
| `runtime:log` | `LogEntry` |

## Config keys consumed

- `mcp.port`

### Background failure diagnostics
- Injects `jobs` and `audit` in addition to `ipc`, `mcp`, `config`.
- MCP `get_job_status({ jobId? })`: returns a retained job snapshot (including `state`, `error`, `summary`), or all retained jobs. Finished jobs are limited to 50; unknown IDs return an error object.
- MCP `get_audit_logs({ limit?: 1..500 })`: returns persistent audit entries, including background failures after restart.
