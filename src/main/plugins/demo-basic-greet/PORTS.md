# PORTS — demo-basic-greet

Demo plugin showing the minimal plugin shape. Not a real product feature.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `demo` |
| Category | `basic` |
| Name | `greet` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `config`

## IPC services provided

| Service | Method | Signature | Notes |
| --- | --- | --- | --- |
| `greet` | `ping` | `(name: string) => string` | In-memory call counter, per app run |

## MCP tools provided

None.

## Events broadcast

None.

## Config keys consumed

None (declares `config` only to demonstrate dependency waiting).
