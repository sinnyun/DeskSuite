# PORTS — data-ops-clipboard (renderer)

Floating clipboard workbench with a live text/image preview, draft editor and persistent classified history.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `data` / `ops` / `clipboard` |
| Entry | `index.tsx` |
| Main capability | `system-basic-clipboard` |

## Contributions

- `sidebar.activity`: opens the clipboard workbench.
- `floating.panels`: resizable 1260×760 px initial three-column panel (filters, history cards, selected-item editor).

## Services and IPC

Consumes `ui` and main IPC `clipboard`: `readText`, `readImage`, `writeText`, `capture`, `history`,
`historyImage`, `importLegacy`, `setFavorite`, `removeHistory`, `clearHistory`, `useHistory`, `updateHistory`,
`groups`, `createGroup`, `renameGroup`, `deleteGroup`, and `assignGroup`.

## Storage and behavior

- History is owned by main-process `store`; the old `desksuite.clipboard.history` localStorage key is imported once and removed after the IPC migration succeeds.
- Up to 50 entries, SHA-256 deduplication, automatic text/link/code/image classification, seven day expiry for temporary entries, favorites, and persistent user groups.
- Clipboard capture runs every 1.5 seconds only while the panel is open.
- MCP `read_clipboard` may return PNG image content; `write_clipboard` remains text-only.
