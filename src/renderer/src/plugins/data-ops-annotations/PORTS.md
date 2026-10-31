# data-ops-annotations (renderer)

- Domain / class / name: `data` / `ops` / `annotations`
- Entry: `index.tsx`
- Host access: `workbench/sdk` only.
- Optional renderer dependency: `selection` from `data-ops-explorer`; the page remains usable without it and shows an empty-selection state.
- Optional renderer dependency: `panes` from `data-ops-explorer`; clicking a tag calls `showTagAggregate` so the central file area lists every file carrying that tag (and its descendants). Clicking the active tag again or the missing service degrades gracefully.
- Main process dependency: IPC service `annotations`; event `annotations:changed`.
- Slot contributions: `sidebar.left.tabs` and `sidebar.left.content`, both with contribution id `annotations`.
- Renderer service: `annotations`; it exposes cached snapshot, subscription and compatibility methods `get`, `toggleFavorite`, `setRating`, `addTag`, `removeTag`, `allTags`, and `exportFor`, plus `prime`, `forPaths`, `tree`, `setNote`, and `importLegacy`.
- Metadata is held in an annotations-owned Zustand vanilla store. `subscribePath(path, listener)` notifies only when that path's metadata reference changes; `getSnapshot()` remains the all-path compatibility snapshot.
- Data: `forPaths`, `tree`, `counts`, tag creation and legacy import results are decoded with renderer-plugin-local Zod schemas before entering the cache or page state. `annotations:changed` event payloads are checked before triggering refresh; writes remain optimistic and are sent through IPC.
- Configuration / localStorage: none.
- Interface text is Chinese. Tag create/rename/merge/remove and batch assignment controls are provided in the tag page.
