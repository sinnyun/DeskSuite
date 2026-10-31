# PORTS — data-ops-basket

Persistent cross-session file basket. Data lives in the main-process `store` service under the `basket` key; the renderer no longer uses `localStorage`.

## Metadata

| Field | Value |
| --- | --- |
| Domain | `data` |
| Category | `ops` |
| Name | `basket` |
| Entry | `index.ts` |

## Dependencies (inject)

- `ipc`
- `store`

## Provided IPC service

Service name: `basket`

| Method | Arguments | Returns |
| --- | --- | --- |
| `list` | — | `BasketItem[]` |
| `add` | `items: Omit<BasketItem, 'addedAt'>[]` | Updated `BasketItem[]` |
| `remove` | `path: string` | Updated `BasketItem[]` |
| `clear` | — | `[]` |

`BasketItem` = `{ path, name, isDirectory, kind, size, modifiedAt, addedAt }`.

## Data contract

- Storage key: `basket`, persisted at `<userData>/data/basket.json`; the envelope (version + `.bak`) is owned by the `store` service.
- Capped at 200 items; duplicates by `path` are ignored.
- `addedAt` is assigned by the main process; values sent by the renderer are ignored.

## Broadcast events

None.

## Consumed configuration

None.

## Known limits

The renderer `BasketService` keeps a synchronous signature (`list/add/remove/clear`) while main-process writes are async: the UI updates optimistically and then adopts the array returned by the main process. When the main process is unavailable the basket degrades to session-only and logs one error.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
