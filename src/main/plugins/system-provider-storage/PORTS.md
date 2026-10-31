# PORTS — system-provider-storage

Aggregates each plugin's private data locations under `<userData>` and reports their on-disk size.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `system` |
| Class | `provider` |
| Name | `storage` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `store`
- `mcp`

## Provided service: `storage`

| Method | Parameters | Returns |
| --- | --- | --- |
| `register` | `pluginId: string`, `registration: { title, entries }` | — |

`entries[]` accepts exactly one of:

- `storeKey` — a key already registered with the `store` service; the file path is resolved by `store.resolvePath`.
- `relativePath` — a file or directory relative to `<userData>`; `kind: 'file' | 'directory'` defaults to `file`.
- `label` is required; `description` is optional.

Registration throws on duplicate plugin ids, invalid ids, or paths escaping `<userData>`.

## IPC service: `storage`

| Method | Parameters | Returns |
| --- | --- | --- |
| `list` | — | `StorageSnapshot` |
| `open` | `path: string` | `true` |

- `StorageSnapshot` = `{ userData, groups, size, files, measuredAt }`; each group is `{ plugin, title, entries, size, files }`; each entry is `{ label, description?, path, kind, exists, size, files }`.
- Sizes are measured recursively at request time. Missing paths report `exists: false` and are not opened.
- Store documents that no plugin claims are reported under the `unclassified` group (`其他数据`) so new store-backed data still appears automatically.
- `open` only accepts a path that exactly matches a registered entry. Directories open in the file manager; files are revealed with the item selected.

## MCP tools

- `plugin_storage` — read-only JSON dump of the same snapshot.

## Broadcast events

None.

## Consumed configuration

None.

## Known boundaries

Only userData-relative locations can be registered; application-wide `config.json` is registered by this plugin itself. Renderer `localStorage` is owned by Chromium and is not included.
