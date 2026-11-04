# data-ops-search-ui

- Domain / class / name: `data` / `ops` / `search-ui`
- Entry: `index.tsx`
- Dependencies: UI kit and layout services; main-process `search.query` and `filesystem.reveal` IPC.
- Contributions: a global indexed-search action in `top.actions` and a fixed-size panel in `floating.panels`.
- Search covers indexed file names and paths, with optional annotation filters supplied by the main search service. Results are paginated at 50 items per page.
- Before storing results, the renderer decodes `search.query` with a plugin-local Zod schema and checks that the returned page metadata matches the request.
- Unindexed directories remain available through normal Explorer browsing.
- Storage, configuration, events, and MCP tools are owned by the corresponding main-process plugins.
- Interface copy is Chinese.
- Contributes the `search.results` context menu (order 10) on result rows (`data-search-path/-name/-dir/-kind/-size/-mtime`): reveal in the file manager, open, copy path, add to basket (when the `basket` service is available) and favorite toggle (when the `annotations` service is available). Requires the `contextMenu` service; registration is skipped when it is missing.
