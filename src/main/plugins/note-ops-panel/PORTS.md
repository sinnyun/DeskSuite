# PORTS — note-ops-panel (main)

- Domain / class / name: `note` / `ops` / `panel`
- Entry: `index.ts`

## Dependencies (inject)

- `ipc`
- `mcp`
- `store`
- `config`
- `window`

## Provided IPC services

Service name: `notePanel`

| Method | Arguments | Returns |
| --- | --- | --- |
| `pickDirectory` | — | User-selected directory or null; the dialog explicitly grants writes to that directory, validates forbidden/symlink paths, and adds it to `mcp.writeRoots` without changing access level |
| `complete` | `requestId: string, result: { error?: string; value?: unknown }` | — (renderer answers a pending request) |
| `loadPreferences` | — | `{ rootDir: string \| null, lastNote: string \| null, recentPaths: string[] }` read from the store |
| `rememberPreferences` | `{ rootDir: string \| null, lastNote: string \| null, recentPaths?: string[] }` | same object after zod validation and store write |
| `loadDraft` | `path: string` | matching text-only draft `{ path, markdown, updatedAt }` or null |
| `saveDraft` | `{ path: string, markdown: string }` | `{ path, updatedAt }`; atomically persists a maximum of 100 drafts, each up to 200,000 characters |
| `clearDraft` | `path: string` | true after removing that path's draft |
| `listDrafts` | — | `{ entries: Array<{ path, markdown, updatedAt }> }` |

## Provided MCP tools

| Tool | Arguments | Returns |
| --- | --- | --- |
| `note_panel` | `action: 'setroot' \| 'open' \| 'select' \| 'reload' \| 'new' \| 'setbody' \| 'setattrs' \| 'sourceMode' \| 'readingMode' \| 'findReplace' \| 'archive' \| 'restoreTrash' \| 'createVersion' \| 'restoreVersion' \| 'inspect'`; optional `path`, `title`, `markdown`, `attributes`, `enabled`, `operation`, `query`, `replacement`, `versionId` | JSON text from the renderer; `mutating: true` |
| `note_query` | `action: 'search' \| 'outline' \| 'inspect' \| 'versions'`; optional `title` (search query), `path` (version listing) | JSON text from the renderer; `mutating: false` |
| `note_task_status` | `requestId: string` | Read-only task status; a wait timeout does not imply cancellation |

`setroot`, `open`, exact-path `select`, `reload`, `new`, `setbody`, `setattrs`, `sourceMode`, `findReplace`, `archive`, `restoreTrash`, `createVersion`, and `restoreVersion` are semantic panel actions. Document changes autosave after the selected notes directory is authorized; archive/restore and Lore restore request in-product confirmation. `note_query.search` searches loaded note titles, paths, and body text using `title`; `outline` returns headings and text statistics; `inspect` reads the current editor and autosave state; `versions` lists Lore revision metadata for `path` or the active note. `note_panel` never writes a note outside the existing file operation or Lore services.

## Broadcast events

| Channel | Payload | Consumers |
| --- | --- | --- |
| `note:action` | `{ action, path?, title?, markdown?, attributes?, enabled?, operation?, query?, replacement?, versionId?, requestId }` | `note-ops-markdown` renderer panel, which answers through `notePanel.complete` |

Requests wait at most 15 seconds. On timeout, `note_panel` includes a `requestId`; `note_task_status` reports `pending`, `wait_timed_out`, `completed`, or `failed`. A wait timeout does not cancel the renderer action. The most recent 200 task statuses are retained for the plugin lifetime.

## Storage

| Key | Schema | Purpose |
| --- | --- | --- |
| `note-panel-preferences` | `{ rootDir: string \| null, lastNote: string \| null, recentPaths: string[] }` | lets the renderer restore the notes directory, open note, and up to 20 recent notes after a reload; a missing or renamed directory surfaces an error in the panel instead of opening a system dialog |
| `note-panel-drafts` | `{ entries: Array<{ path: string, markdown: string, updatedAt: number }> }` | versioned atomic text-only recovery drafts, keyed by normalized path; autosave separately writes actual document changes to the authorized note file |

## Configuration consumed

`mcp.writeRoots`: only the native directory picker can append a user-selected writable directory. MCP `setroot` never grants write access.

Drafts are separate from note files and never execute a file write. Draft content is limited to 200,000 characters; embedded `data:image/...;base64` payloads are rejected so image bytes must remain in the shared resource system. Up to 100 paths are retained.

Document contents autosave after a debounce. `inspect` reports `autoSaveStatus`, `pendingExecution`, and `error`; panel filters, layout, and other UI state do not trigger file writes.
