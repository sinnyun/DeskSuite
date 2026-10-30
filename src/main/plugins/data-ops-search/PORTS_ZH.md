# data-ops-search

- 域 / 子类 / 名称：`data` / `ops` / `search`
- 入口：`index.ts`
- 依赖：Cordis `db`、`ipc`、`mcp`。

## IPC

服务：`search`；方法 `query({ query?, limit?, offset?, kind?, tagId?, minRating?, favorite?, root? })`。

- 对已索引文件名与路径执行转义后的 SQL `LIKE` 搜索。
- 支持类型、标签、最低评分、收藏状态和根目录过滤。
- 返回 `{ items, total, limit, offset }`，`items` 最多 200 条。
- 按名称匹配位置、最近修改时间、名称排序。

## MCP

- `search_files` 接受相同过滤条件并返回 JSON 文本，只读。

## 存储与事件

- 通过注入的 catalog `db` 服务读取 `files`、`meta`、`file_tags`。
- 不注册迁移、不读取配置、不创建作业或广播事件。
