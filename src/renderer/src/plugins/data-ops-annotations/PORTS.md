# data-ops-annotations (renderer)

- Domain / class / name: `data` / `ops` / `annotations`
- Entry: `index.tsx`
- Host access: `workbench/sdk` only.
- Optional renderer dependency: `selection` from `data-ops-explorer`; the page remains usable without it and shows an empty-selection state.
- Optional renderer dependency: `panes` from `data-ops-explorer`; clicking a tag calls `showTagAggregate` so the central file area lists every file carrying that tag (and its descendants). Clicking the active tag again or the missing service degrades gracefully.
- Main process dependency: IPC service `annotations`; event `annotations:changed`.
- Slot contributions: `sidebar.left.tabs` and `sidebar.left.content`, both with contribution id `annotations`.
- Renderer service: `annotations`; it exposes cached snapshot, subscription and compatibility methods `get`, `toggleFavorite`, `setRating`, `addTag`, `removeTag`, `allTags`, and `exportFor`, plus `prime`, `forPaths`, `tree`, `setNote`, and `importLegacy`.
- Metadata is held in an annotations-owned Zustand vanilla store. `subscribePath(path, listener)` notifies only when that path's metadata reference changes; `getSnapshot()` remains the all-path compatibility snapshot. Batch write-backs keep the previous frozen object when `favorite`/`rating`/`tags` are unchanged, so unchanged rows never re-notify.
- Event refresh is path-scoped: a `metadata` broadcast carrying `paths` reloads only cached rows matching those paths; `tree` broadcasts and path-less `metadata` broadcasts (legacy import) reload the whole cache and rebuild the tag tree.
- Broadcasts are coalesced in a 50 ms window that starts with the first event of a burst: `metadata` paths accumulate into one reload batch, and any `tree` / path-less event seen inside the same window upgrades that flush to the whole-cache variant. A burst therefore costs at most one `forPaths` round trip plus one tag-tree fetch, and refreshes stay at least 50 ms apart. Unmounting the service clears the pending window. While the window is hidden or occluded Chromium clamps that timer to roughly one second, so a broadcast can take that long to reach the rows.
- Reloads run through one serialized drain queue: `get`/`prime`/event refreshes only enqueue the paths they still need, and the drain hands back its task handle in the same frame it leaves the queue empty, so no queued path can be stranded behind a stale handle.
- Data: `forPaths`, `tree`, `counts`, tag creation and legacy import results are decoded with renderer-plugin-local Zod schemas before entering the cache or page state. `annotations:changed` event payloads are checked before triggering refresh; writes remain optimistic and are sent through IPC.
- Configuration / localStorage: none.
- Interface text is Chinese. Tag create/rename/merge/remove and batch assignment controls are provided in the tag page.
