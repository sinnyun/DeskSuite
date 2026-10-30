# data-ops-search

- Domain / class / name: `data` / `ops` / `search`
- Entry: `index.ts`
- Dependencies: Cordis `db`, `ipc`, and `mcp`.

## IPC

Service: `search`; method `query({ query?, limit?, offset?, kind?, tagId?, minRating?, favorite?, root? })`.

- Searches indexed file names and paths with escaped SQL `LIKE` matching.
- Supports kind, tag, minimum rating, favorite state, and root path filters.
- Returns `{ items, total, limit, offset }`; `items` is capped at 200.
- Orders by name match position, newest modification time, then name.

## MCP

- `search_files` accepts the same filters and returns JSON text. It is read-only.

## Storage and events

- Reads `files`, `meta`, and `file_tags` through the injected catalog `db` service.
- Registers no migrations, config keys, jobs, or broadcast events.
