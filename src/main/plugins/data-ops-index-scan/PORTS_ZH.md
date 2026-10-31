# data-ops-index-scan

- 域 / 子类 / 名称：`data` / `ops` / `index-scan`
- 入口：`index.ts`
- 依赖：Cordis `db`、`ipc`、`mcp`、`jobs`、`audit`、`settings`、`commands`。
- 设置命名空间 `indexing`：`roots`（最多 32 个绝对路径，默认空）和 `ignore`（默认忽略目录及可选 glob 规则）。MCP/IPC 扫描调用可覆盖设置。

## IPC

服务：`indexScan`。

- `start(roots, ignore?)` 启动一个可取消的后台扫描并返回 `{ jobId }`。
- `cancel(jobId)` 在目录项或批次边界取消任务。
- `status()` 返回当前运行作业 ID 和扫描根目录。
- 使用 `fs.opendir` 遍历，跳过符号链接及默认忽略目录名（`node_modules`、`.git`、`$RECYCLE.BIN`、`System Volume Information`）。可选 `*`、`?` 规则匹配目录项名称或根目录相对路径。
- 每 500 行提交一次 upsert。只有所有根目录遍历完成后才删除本次未发现的行；取消或失败会保留已有索引，不执行过期清理。
- 过期清理按降序 `path_key` 对 `files` 和 `folders` 游标分页，每次最多读取 500 行。所有分页删除与暂存行清理都在一个外层事务中，因此清理仍是全有或全无；分页内部事务使用 savepoint。根目录范围通过 JavaScript 对规范化路径做包含判断，不使用 SQL `LIKE`。完成的作业摘要新增 `staleFilesRemoved` / `staleFoldersRemoved`；只有完整扫描结束后才清理，页间不让出事件循环。
- `devlab://` 合成行不属于磁盘根目录，不受影响。

## MCP

- `index_scan({ roots?, ignore? })` 启动相同的后台任务；省略时使用设置中的根目录和规则。它是低影响写工具，遵循配置的 MCP 写入权限档位。
- 向命令注册表注册 `index.scan`；该命令预览已配置的根目录，并在批准后开始扫描。

## 存储与事件

- 通过注入的 `db` 服务访问数据库，只写 catalog 的 `files`、`folders` 和本插件私有的 `index_scan_seen` 暂存行。
- 使用共享 `jobs` 进度/完成事件，并通过 `audit` 记录结果。
- 不广播自定义事件。
