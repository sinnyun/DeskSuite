# data-provider-catalog

- Domain / class / name: `data` / `provider` / `catalog`
- Entry: `index.ts`
- Dependencies: platform `node:sqlite` only

## Provided service

The plugin provides the Cordis service `db`. This plugin is the sole owner of the `DatabaseSync` connection at `<userData>/data/desksuite.db`; consumers must inject `db` and must not open SQLite themselves.

```ts
interface CatalogDatabase {
  query<T>(sql: string, ...params: SQLInputValue[]): T[]
  all<T>(sql: string, ...params: SQLInputValue[]): T[]
  get<T>(sql: string, ...params: SQLInputValue[]): T | undefined
  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges
  tx<T>(work: (database: CatalogDatabase) => T): T
  migrate(owner: string, migrations: CatalogMigration[]): void
}

interface CatalogMigration {
  id: string
  version: number
  sql: string
}
```

All APIs are synchronous. `tx` uses `BEGIN IMMEDIATE` and nested savepoints; asynchronous callbacks are rejected. `migrate(owner, migrations)` applies each owner-scoped migration once inside a transaction, records it in `catalog_migrations`, and advances `PRAGMA user_version` to the highest applied version. Migration IDs and owners must be stable lowercase identifiers.

## Initial schema

- `meta` and `file_tags` use normalized `path_key` values and do not reference `files`, so annotations work before indexing.
- `tags` stores parent relationships. The annotation plugin may extend this table through its own migration.
- `files` stores indexed file rows with stable integer IDs and a unique normalized path key.
- `folders` stores indexed directory rows independently from files.

## Configuration, events, and MCP

- No configuration keys are consumed.
- No IPC service, broadcast event, or MCP tool is registered.
- The provider closes the connection when its Cordis plugin lifecycle ends, after dependent consumers release it.

## Known limits

- This plugin does not scan files or implement annotation/search behavior.
- Packaged Electron WAL/FTS5 behavior remains pending the final Windows verification pass.
