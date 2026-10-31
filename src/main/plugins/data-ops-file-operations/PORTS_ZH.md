# data-ops-file-operations

- 域 / 子类 / 名称：`data` / `ops` / `file-operations`
- 入口：`index.ts`
- 注入依赖：Cordis 服务 `ipc`、`mcp`、`window`、`config`、`jobs`、`audit`、`store`、`db`、`commands`
- 版本历史联动：注入 `data-provider-version-info` 提供的 `versionInfo`；移动/重命名成功后重绑匹配的版本实体，目录移动包含子路径。重绑失败会作为已完成单项的警告返回并写入 audit，不会将已完成的文件系统操作改报为失败。
- IPC 服务：`fileOps`
  - `plan({ op, sources, target?, conflictPolicy? })` 创建只读计划并记录来源、目标指纹。操作为 `copy`、`move`、`rename`、`mkdir`、`trash`；冲突策略为 `skip`、`overwrite`、`rename`、`cancel`。
  - `writeText(path, content, { noOverwrite? })` 创建单项 `writeText` 计划；内容仅保存在主进程内存中。调用方必须调用 `approve(planId)` 后再执行 `execute(planId)`。写入限制为 10 MiB，先写入并同步临时文件，再经目标指纹检查后改名替换。`noOverwrite: true` 使用 `cancel` 冲突策略：已有目标报告 conflict，计划后变化的目标报告 stale，最终提交使用同目录排他硬链接，避免最后竞争窗口内新建的目标被替换。
  - `saveText(defaultName, content, extension?)` 弹出系统保存对话框并返回相同的已批准写入计划；不会直接写文件。
  - `approve(planId)` 与 `reject(planId)` 接收渲染层批准决定。计划获批后 `execute(planId)` 返回 `{ jobId }`。另提供 `cancel(planIdOrJobId)`、`get(planId)`、`getResults()`、`getWriteRoots()`、`undo(undoId?)`、`getUndoStack()`、`startDrag(paths)`。
- MCP 工具：`file_copy`、`file_move`、`file_rename`、`file_mkdir`、`file_trash`。均标记为 mutating；`file_trash` 为 high impact。MCP 调用等待渲染层决定最多 60 秒；超时返回 `pending`，拒绝或无窗口返回 `rejected`。
- 向共享命令注册表注册 `file.copy`、`file.move`、`file.rename`、`file.mkdir` 和 `file.trash`；命令面板与 MCP 命令调用共用同一计划执行器。
- 事件：`fileOps:approval` 携带计划摘要；`fileOps:done` 携带全部逐项结果；`fileOps:undo-stack` 携带可撤销项；作业结束 200ms 后广播 `fileOps:fs-changed`，载荷为 `{ planId, jobId, paths: [{ source?, target }], at }`，并广播供 Explorer/watch 消费的 `fs:changed`（受影响目录与路径）；`jobs` 服务广播通用 `job:progress` 与 `job:done` 快照。
- 存储：每个作业结果都通过 `store` 注册为 `file-operations.job-<jobId>`，文件位于 `data/jobs/<jobId>.json`。启动时插件枚举最近修改的 50 个普通 `job_*.json` 文件，通过 `store` 注册并读取；`getResults()` 返回最近 50 条。更早的文件保留在磁盘。
- `getWriteRoots()` 只读返回当前配置的可写根目录，不会修改设置。
- 生命周期：新建计划或读取计划时清理过期计划；拒绝、超时、取消和作业结束时释放关联状态；不使用轮询定时器。
- 路径策略：所有来源和目标都必须使用 `config.mcp.writeRoots` 通过 `assertWritable`；应用 userData 目录禁止写入。
- 复制的来源只读，可位于配置的可写根目录之外；移动、重命名、回收站删除的来源与所有目标都必须在可写根目录内。
- 移动/重命名成功后，在同一个同步 `db.tx` 中迁移 `meta`、`file_tags`、`files`、`folders` 的路径键；目录操作包含所有子路径，覆盖时先清除目标旧标注与索引子树。复制不迁移标注。
- `cancel(planId)` 会取消关联的运行作业。冲突策略为 `cancel` 时仍先检查全部来源/目标指纹，变化项返回 `stale`。
- 逐项状态：`completed`、`skipped`、`conflict`、`failed`、`stale`。
- 撤销：内存栈最多保留 20 个符合条件的已完成项目，支持重命名、同卷移动和新建空目录。撤销前复查已保存指纹，并复用普通计划/执行流程；用户主动触发撤销时跳过批准。复制、回收站删除、跨卷移动、覆盖旧目标、指纹变化及已写入内容的新建目录不可撤销。重启后撤销历史不会保留。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
