# PORTS — data-ops-filesystem

Real filesystem capability plugin. Exposes directory browsing, text/image preview, shell open/reveal and folder picking to the renderer, plus read-only AI tools over MCP.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `data` |
| Category | `ops` |
| Name | `filesystem` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `mcp`
- `window`
- `store`

## IPC services provided

Service name: `filesystem`

| Method | Arguments | Returns |
| --- | --- | --- |
| `drives` | — | `{ name, path, total, free, isNetwork }[]` |
| `quickAccess` | — | `{ id, label, path }[]` (home / desktop / documents / downloads / pictures) |
| `listDir` | `path: string, limit?: number` (absolute; default 200, max 500) | `{ path, parent, entries, truncated, nextCursor, stale }`; entry = `{ name, path, isDirectory, kind, size, modifiedAt }` |
| `listMore` | `cursor: string, limit?: number` | Next page with the same result shape. Cursors expire after two minutes; `stale: true` means the directory changed and should be reloaded. |
| `statPaths` | `paths: string[]` (max 2,000) | `FsEntry[]` for paths that still exist; missing paths are silently skipped. Used by consumers that hold path lists outside a directory (e.g. tag aggregation). |
| `readText` | `path: string` | `{ path, content, truncated }` — max 2 MB, rejects binary |
| `readImage` | `path: string` | `{ path, dataUrl }` — max 12 MB, png/jpg/gif/webp/bmp/ico/svg |
| `readMedia` | `path: string` | `{ path, dataUrl, mimeType }` — max 64 MB, mp4/webm/mov/mkv/mp3/wav/ogg/flac/m4a/aac |
| `open` | `path: string` | `true`; opens with the OS default handler |
| `reveal` | `path: string` | `true`; shows the item in the OS file manager |
| `pickDirectory` | — | `string \| null`; native folder picker |

This plugin only reads user files; all writes are planned and executed by `data-ops-file-operations`.

All three preview readers open the path once, inspect that open handle, and read at most the configured limit plus one byte. This keeps the memory bound in force if the file grows or the path is replaced between metadata lookup and reading. Directories are rejected for text/media previews; non-regular files are rejected.

## MCP tools provided

| Tool | Arguments | Returns |
| --- | --- | --- |
| `list_drives` | — | text (JSON) |
| `list_directory` | `path?: string, cursor?: string, limit?: number` (defaults to home / 200 / max 500) | text (formatted page; includes `nextCursor` when more entries remain) |
| `read_text_file` | `path: string` | text (file content, max 2 MB) |
| `filesystem_preview_image` | `path: string` | MCP image block; max 12 MB |
| `filesystem_inspect_media_preview` | `path: string` | JSON text `{ path, mimeType, byteLength }`; reads at most 64 MB and does not transmit the media body |

## Events broadcast

`filesystem:drivePreferences` — saved `{ showNetworkDrives: boolean }`.

## Config keys consumed

None.

## Network drive visibility

Injects `store` in addition to the dependencies above. `drives` / `list_drives` now return `isNetwork: boolean` on every drive. On Windows, mapped network drive letters are identified using `Win32_LogicalDisk.DriveType=4` through a hidden, bounded PowerShell query; capacity probing is unchanged. If classification is unavailable, entries remain visible as local/unknown. Non-Windows root is not classified as network.

IPC `getDrivePreferences()` returns `{ showNetworkDrives: boolean }`; `setDrivePreferences(preferences)` validates and persists that object, then broadcasts `filesystem:drivePreferences` with the saved value. Store key `explorer-drive-preferences`, default true, independent of workspaces. MCP `explorer_drive_preferences({ showNetworkDrives?: boolean })` reads or updates the same preference (low-impact mutating tool). Visibility affects only the renderer sidebar; `list_drives` always returns all drives. No drive is disconnected and bookmarks/navigation remain usable.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
