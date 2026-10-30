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

Source `Insights` (lifecycle, clipboard actions, basket changes).
