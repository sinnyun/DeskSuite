# PORTS — data-ops-explorer-insights (renderer)

Renderer plugin providing directory analytics and a persistent file basket. It owns the `basket`
service and consumes the `selection` service published by `data-ops-explorer`.

## Metadata

| Field | Value |
| --- | --- |
| Kind | renderer plugin |
| Domain | `data` |
| Category | `ops` |
| Name | `explorer-insights` |
| Entry | `index.tsx` |

## Slot contributions

| Slot | Contribution id | Content |
| --- | --- | --- |
| `sidebar.activity` | `insights.activity` | Two buttons: 统计 (analytics) and 暂存 (basket) |
| `floating.panels` | `analytics.panel` | Kind distribution, totals and largest-files panel (`analytics`) |
| `floating.panels` | `basket.panel` | Three-column file-kind navigation, selectable file card grid, details and copy/clear/reveal/remove actions (`basket`) |

Panel ids are opened by the shell via `openFloatingPanel('analytics')` / `('basket')` and the
`Alt+1` / `Alt+2` shortcuts.

## Services

Provides:

- `basket` — `{ list(), add(items), remove(path), clear(), subscribe() }` returning `BasketItem[]`
  (SelectionItem + `addedAt`). Persisted by the main-process `basket` IPC service
  (`<userData>/data/basket.json`, max 200 items); the renderer keeps an optimistic cache only.
  The cache uses a plugin-owned Zustand vanilla store and remains scoped to this renderer plugin.
  Each IPC snapshot/result is decoded with a plugin-local Zod schema before entering the cache; malformed rows or more than 200 items are rejected.

Consumes:

- `ui` (required) — UI primitives and floating panel.
- `selection` (optional at runtime) — `{ getSnapshot(), subscribe() }` from `data-ops-explorer`;
  when missing, panels show an empty state.

## Main-process IPC used

| Service | Method | Purpose |
| --- | --- | --- |
| `clipboard` | `writeText` | Copy basket paths |
| `filesystem` | `reveal` | Locate a basket item in its folder |
| `basket` | `list` / `add` / `remove` / `clear` | Basket persistence (main plugin `data-ops-basket`) |

## Renderer storage

None. Basket data is owned by the main process.

## Logs

Source `Insights` (lifecycle, clipboard actions, basket changes). Error payloads use the shared bounded error-text helper to scrub credentials and local paths.

## Context menus

AnalyticsPanel registers `insights.analytics` (order 10): open the analysed directory in the system file manager and copy its path (nothing is produced when no directory is analysed). BasketPanel registers `insights.basket` (order 10): item cards (`data-basket-path`) offer reveal / open / copy path / remove from basket; blank space offers copy all paths and clear basket (with confirm). The clear entry is omitted while the basket is empty.
