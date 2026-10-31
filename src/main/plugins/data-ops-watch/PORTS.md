# PORTS — data-ops-watch

Watches the directories currently displayed by Explorer panes and broadcasts debounced filesystem changes.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `data` |
| Category | `ops` |
| Name | `watch` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `settings`

## IPC services provided

Service: `watch`

| Method | Arguments | Returns |
| --- | --- | --- |
| `setPaneDirectories` | `paneId: string, directories: string[]` (absolute paths) | Active watched directories; the combined set is capped at 16 |
| `clearPane` | `paneId: string` | Active watched directories |
| `getDirectories` | — | Reconciled active watched directories |

## Events broadcast

- `fs:changed` — validated watcher payload `{ paths: string[], dirs: [string], invalidate: boolean }`. `paths` contains at most 200 absolute paths; when capped, `invalidate` is true and `paths` is empty. Events are debounced by `watch.debounceMs` (100–5000 ms, default 500).
- `fs:watch:error` — validated `{ message: string }` when the underlying watcher reports an error; error text is bounded and sanitized before broadcast.
- Watcher return values (`setPaneDirectories`, `clearPane`, `getDirectories`) are decoded as at most 16 absolute directory strings before returning.

## Dependencies and behavior

- Uses `chokidar@6.0.0` through dynamic import; watches are non-recursive, with atomic-save coalescing and write-stability filtering.
- Watches only pane current directories and expanded/pinned directories supplied by the renderer. The global cap is 16.
- Reconciliation tracks only the directories this plugin adds. chokidar also watches parent and child directories internally; unwatching those tears down the subtree and stops all events, so they are never touched.
- Settings: `watch.debounceMs`; changes apply immediately to new event batches. No MCP tools.
