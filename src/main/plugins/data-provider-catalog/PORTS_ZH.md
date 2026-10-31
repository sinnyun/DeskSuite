# data-provider-catalog

- 域 / 子类 / 名称：`data` / `provider` / `catalog`
- 入口：`index.ts`
- 依赖：仅使用平台内置 `node:sqlite`

## 提供的服务

插件提供 Cordis 服务 `db`。本插件是 `<userData>/data/desksuite.db` 中唯一的 `DatabaseSync` 连接所有者；消费插件必须注入 `db`，不得自行打开 SQLite。

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

所有 API 均为同步接口。`tx` 使用 `BEGIN IMMEDIATE` 与嵌套 savepoint；传入异步回调会报错。`migrate(owner, migrations)` 按 owner 隔离迁移，逐项在事务中执行一次，写入 `catalog_migrations`，并将 `PRAGMA user_version` 更新为已应用迁移的最高版本。迁移 owner 与 ID 必须是稳定的小写标识。

## 初始 schema

- `meta` 与 `file_tags` 使用规范化 `path_key`，不引用 `files`，因此尚未索引的路径也能保存标注。
- `tags` 保存父子关系；标注插件可通过自己的迁移扩展此表。
- `files` 保存索引文件记录，包含稳定整数 ID 与唯一规范化路径键。
- `folders` 独立保存索引目录记录。

## 配置、事件与 MCP

- 不消费配置项。
- 不注册 IPC 服务、广播事件或 MCP 工具。
- Cordis 插件生命周期结束时关闭连接；会等待依赖消费者释放服务。

## 已知限制

- 本插件不负责文件扫描、标注或搜索功能。
- 打包态 Electron 的 WAL/FTS5 行为待最终 Windows 验证批次确认。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
