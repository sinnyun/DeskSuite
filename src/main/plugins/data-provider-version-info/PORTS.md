# data-provider-version-info

Typed durable metadata provider for the Lore file history plugin. It stores metadata in the shared DeskSuite catalog database; Lore owns snapshot contents.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `data` / `provider` / `version-info` |
| Entry | `index.ts` |
| Dependencies | Cordis service `db` |
| Provided service | `versionInfo` |

## Storage

- Owns `version_entities`, `versions`, and `version_graph` in `desksuite.db` through the catalog migration API.
- Entity IDs are generated UUIDs. Normalized path identity maps to an entity; moving a file can rebind the path without changing its entity ID or history.
- Version rows store revision metadata and a current marker, not file bytes. A partial unique index allows at most one current revision per entity.
- Branch graph snapshots and pending merge state are stored as JSON owned by the provider. The service exposes typed operations only and no arbitrary SQL.
- This is a new product store. It performs no import from another product or standalone legacy database.

## Service contract

- `getOrCreateEntity(path)` returns `{ entityId, pathKey, path }`.
- `getEntityByPath(path)` returns the matching entity or `null`.
- `rebindPath(oldPath, newPath)` retains the entity ID after a move/rename; returns `undefined` when the old path has no version entity and rejects a target already bound to a different history.
- `list(entityId)`, `save(record)`, and `setCurrent(entityId, versionId)` manage typed version metadata.
- `graph(entityId)` and `putGraph(entityId, graph)` manage the typed branch graph and pending merge snapshot.

## Events, IPC, MCP, settings

None. This provider is consumed through Cordis service injection by `data-ops-versions`.

## Persistent read snapshots (migration 2)
Owns `version_snapshots` in addition to entity/version/graph tables. `entities()` lists known entity identities. `snapshot(entityId)` / `putSnapshot(entityId,snapshot)` manage the complete typed observation: `state`, SHA-256 `fingerprints`, `synchronizedAt`, `operation`, and `error`. State includes source metadata and pending restore diagnostics. These APIs never import or invoke Lore. Legacy databases retain all rows; missing snapshots default to `unknown` until explicit reconciliation. Consumers publish snapshots, graph and version updates in one catalog transaction.
