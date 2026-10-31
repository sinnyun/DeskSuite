# PORTS — system-basic-clipboard

System clipboard read/write capability with persistent, categorized text and image history.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `system` / `basic` / `clipboard` |
| Entry | `index.ts` |

## Dependencies

- `ipc`
- `mcp`
- `store`

## IPC service

Service: `clipboard`

| Method | Arguments | Returns |
| --- | --- | --- |
| `readText` / `writeText` | `text` required for writes | Text / `true`; writes capped at 1,000,000 chars |
| `readImage` / `writeImage` | PNG data URL for writes | PNG data URL or `null` / `true`; writes capped at 8 MiB |
| `hasImage` | — | Whether the system clipboard currently contains image data |
| `capture` | — | Current history item or `null` |
| `history` | — | Up to 50 non-expired entries |
| `groups` / `createGroup` / `renameGroup` / `deleteGroup` | group data; create takes `name`, rename takes `id` and `name`, delete takes `id` | Persistent clipboard groups |
| `assignGroup` | `id`, `groupId: string \| null` | Assigns or clears a history item's group |
| `updateHistory` | `id`, `content` | Updates text history and recalculates its category and deduplication id |
| `historyImage` | `id` | PNG data URL or `null` |
| `importLegacy` | `texts: string[]` | `true` |
| `setFavorite` | `id`, `favorite` | `true` |
| `removeHistory` | `id` | `true` |
| `clearHistory` | — | Removes temporary entries and preserves favorites |
| `useHistory` | `id` | Writes the selected history entry to the system clipboard |

## MCP tools

| Tool | Arguments | Returns | Permission |
| --- | --- | --- | --- |
| `read_clipboard` | — | Text or PNG image content | read-only |
| `write_clipboard` | `text` | Confirmation text | mutating, low impact |

`write_clipboard` requires MCP access level `standard` or higher and is audited.

## Persistence and limits

- Store document keys: `clipboard-history` and `clipboard-groups` (`data/clipboard-*.json`).
- PNG bytes are stored in 50 fixed slots under `data/clipboard-images/`; only temporary items can be evicted.
- Temporary entries expire after seven days. Favorites are retained within the 50-entry history cap.
- Categories: text, link, code, image. SHA-256 deduplicates entries.

## Events / config

None.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
