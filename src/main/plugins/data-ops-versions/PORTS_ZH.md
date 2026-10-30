# data-ops-versions

基于 Lore 的单文件不可变历史服务。版本元数据由 `data-provider-version-info` 持有；文件版本内容位于应用数据目录中彼此隔离的 Lore 工作区和共享对象库。

## 元数据

- 域 / 子类 / 名称：`data` / `ops` / `versions`
- 入口：`index.ts`
- 注入：`ipc`、`mcp`、`jobs`、`audit`、`config`、`db`、`versionInfo`
- Lore 引擎：`native/lore-bridge/` 下的 Rust sidecar，固定使用参考项目相同的 `lore-vm` 提交。

## IPC 服务

服务名：`versions`。

- `list(path)` 仅读取持久化数据库中的版本条目，不查询 Lore、不做隐式同步；源文件丢失时仍可查询历史。
- `preview(path, versionId)` 仅为该路径拥有的版本返回有大小上限的 JPEG data URL。渲染层不会直接读取 `userData` 路径。
- `state(path)` 仅读取已持久化文件状态、标题、源文件大小/时间、内容匹配结果与中断恢复诊断。后台本地文件监听根据已存储的 SHA-256 指纹更新状态；界面查询本身既不读取源文件字节，也不启动 Lore。
- `create(path, title)` 启动后台作业，提交不可变快照。排队前捕获源文件摘要，sidecar 暂存前会校验；提交后将图片预览复制为插件拥有的不可变文件。
- `restore(path, versionId, confirm)` 要求 `confirm === true`、版本实体已存在、目标是普通文件且位于配置的 MCP 可写根目录内。操作选择时捕获的 SHA-256 必须在原子替换前仍匹配；匹配同一待处理目标时可续做中断恢复。成功后刷新文件索引并广播 `fs:changed`。
- `abandonInterruptedRestore(path, versionId, confirm)` 要求显式确认且与待处理记录匹配；重新计算当前源文件 SHA-256 后才清除恢复日志。只允许源文件已改变且未匹配目标 Lore 版本时解除；保留当前源文件字节和 Lore 内容。它只移除应用自己的恢复日志，不写源文件，因此不要求该路径位于 MCP 写入根；MCP 调用仍要求 Full 权限和 `confirm: true`。
- `branchGraph(path, includeArchived?)` 仅读取数据库中的完整分支图并过滤归档项，包括待处理合并信息；不调用 Lore。
- `branchAction(path, { action, ... }, confirm)` 支持 `create`、`switch`、`archive`、`merge`、`resolve`、`abort`。待处理合并状态持久化；只有分支切换或合并完成后才替换源文件字节。切换、合并和解决操作会在替换前校验捕获的源 SHA-256。

恢复会拒绝应用 userData 内的目标。变更和文件监听按实体串行；数据库查询不等待 Lore 操作，始终读取最后完整提交的投影。

## MCP

- `versions_list` 为只读工具。
- `versions_state` 在存在恢复日志时返回 `interrupted_restore`、目标版本及源文件未变/已恢复/外部改写/不可用状态，不写入文件内容。
- `versions_branch_graph` 仅读取 SQLite 中的分支图和历史。
- `versions_create` 为高影响工具，需要 Full 权限和显式 `confirm: true`，创建快照并返回 `jobId`。
- `versions_restore` 为高影响工具，需要 Full 权限和显式 `confirm: true`，返回 `jobId`。
- `versions_restore_abandon` 为高影响工具，需要 Full 权限和显式 `confirm: true`；只清除已确认的中断恢复日志，不改写源文件或 Lore 内容，不要求源路径位于 MCP 写入根。
- `versions_branch_action` 为高影响工具，需要 Full 权限和显式 `confirm: true`，返回 `jobId`。

MCP 与渲染层调用同一服务实现。作业和 audit 记录变更及失败。

## 事件

- 保存、恢复或分支操作成功后广播 `versions:changed`。
- 恢复或会改变源文件字节的分支操作后广播 `fs:changed`，促使 Explorer 刷新文件和可见元信息。
- 作业进度和完成使用 jobs 服务的 `job:progress` / `job:done`。

## 存储

- Lore 工作区：`<userData>/data/versions/worktrees/<entityId>/`
- 共享对象库：`<userData>/data/versions/stores/<entityId>/shared-store/`
- 版本记录与分支图：`desksuite.db`，由 `data-provider-version-info` 持有。
- 不可变图片预览：`<userData>/data/versions/previews/<entityId>/<versionId>.jpg`；`thumbnailPath` 保存相对于 userData 的 `data/versions/previews/<entityId>/<versionId>.jpg`。

Lore bridge 是 JSON Lines 进程，仅在显式服务调用时启动。请求字段经 stdin 传递，不把用户输入拼入可执行文件命令行。

## 当前限制

- 工作区冲突会阻止无法安全继续的快照与分支操作；仍可执行 `resolve` 和 `abort`。无法识别的暂存改动会保留源文件字节，不会自动丢弃。
- 重启后发现已无剩余冲突路径的待合并状态仍可完成提交；来源与目标分支从 incoming revision 和 Lore 当前分支列表重建。
- 中断恢复期间允许读取版本列表、状态和分支图；只有匹配 journal 的同版本恢复重试或显式解除操作可以通过 sidecar 栅栏，其他版本操作保持阻塞。
- Rust bridge 通过 `npm run build:lore-bridge` 构建，并作为 `lore-bridge` extra resource 打包；打包时需要固定版本的 Rust 工具链。

### 恢复语义
历史版本切换校验读取工作区实际版本，不使用分支最新版本。中断恢复状态 diagnostic 提供工作区版本和私有文件是否匹配目标的信息。重试中断恢复不再查询被恢复保护拦截的分支图。
分支图当前版本标记使用工作区实际版本；存在中断恢复时返回已持久化分支图，不调用被保护拦截的 Lore 查询。

## 持久化读取模型
- 新增 `reconcile(path,true)` / MCP `versions_reconcile({path,confirm:true})`，显式从 Lore 同步旧历史或修复中断后的数据库投影，需要 full 权限。普通界面刷新、打开、重启均不调用该能力；不会改变源文件或当前检出版本。
- `versions_storage_info({path})` 仅读取同步时间、操作标记、错误、指纹数量以及当前进程 Lore 启动计数，供诊断和验收。
- `version_snapshots` 持久化状态、源文件元数据、历史版本 SHA-256 指纹、中断恢复、同步时间、操作标记与失败信息。版本操作读取 Lore 后，用一个 SQLite 事务更新版本条目、当前版本、完整分支图和状态。
- 变更前持久化操作标记；同步失败保留上一次完整投影并记录错误。旧版本信息缺失时显示待同步，提供显式“同步版本信息”操作。底层异常不会由界面刷新触发重试。
- 本地目录监听会追踪文件改写、失联以及实体路径重绑，通过数据库更新和 versions:changed 自动通知界面。插件卸载清理监听；监听不调用 Lore。历史指纹只在版本操作或显式同步时导出到私有临时文件计算，计算后清理，不改变工作区或原文件。

版本说明允许为空，在实体锁内自动命名为“版本 N”。业务操作失败记录在 jobs/audit；只有读取模型同步本身失败才写 synchronizationError，同步成功清除该错误。
