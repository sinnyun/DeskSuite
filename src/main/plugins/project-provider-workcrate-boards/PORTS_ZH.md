# PORTS — project-provider-workcrate-boards

WorkCrate 对 VectorCraft 官方 CLI 的适配。WorkCrate 管理物料栏数据并把原生结构写入 VectorCraft 文档；普通画布编辑、显示和导出由 VectorCraft 负责。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `project` / `provider` / `workcrate-boards` |
| 入口 | `index.ts` |
| inject | `ipc`、`mcp`、`settings`、`window`、`workcrateProjects` |
| IPC 服务 | `workcrateBoards` |
| 消费服务 | `workcrateProjects` |
| 配置 | `vectorcraft` |

## IPC

- `getConfig()` / `setConfig({ cliExecutable, guiExecutable, defaultImageFormat, port })` 配置 VectorCraft。
  可执行文件路径会去除首尾空白和成对的单/双引号；读取既有设置时同样兼容 Windows“复制文件地址”生成的带引号路径。
- `getDocumentPath(projectId)` 返回工程关联的原生文档路径。
- `openProjectFolder(projectId)` 在文件管理器中定位关联文档。
- `openInVectorCraft(projectId)` 使用配置的 GUI 程序（缺省为 CLI 同目录的程序）打开文档，并启用控制服务器用于双向同步。
- `boardCatalog(projectId)` 读取本地画板缓存。
- `preview(projectId, boardId)` 返回工程缓存中的 PNG data URL。
- `refresh(projectId)` 通过官方 CLI 读取已保存文档，更新画板目录和页面预览缓存。
- `createProjectDocument({ projectId, directory })` 在用户选择的现有文件夹中创建并关联 VectorCraft 原生文档。该 UI 操作以用户选择的文件夹作为授权范围，不修改全局 MCP 可写根目录。
- `createPage(projectId)` 在关联文档中新增 A3 横向画板。
- `updateInfo({ boardId, info })` 在原生画板中创建或更新 WorkCrate 物料栏及结构化字段。

## MCP 工具

- `workcrate_panel_open()` 通过渲染层事件打开 DeskSuite 中的 WorkCrate 浮动面板。
- `workcrate_vectorcraft_config_get()` 读取 VectorCraft 程序路径和控制端口配置。
- `workcrate_vectorcraft_config_set({ config, confirm: true })` 校验程序路径并更新 VectorCraft 配置。需要完整 MCP 权限和明确确认。
- `workcrate_project_create({ name, directory, confirm: true })` 创建 WorkCrate 工程、原生 `.vectorcraft` 文档、初始画板和物料栏。`directory` 必须位于已配置的 `mcp.writeRoots` 下。返回工程、文档路径、初始画板目录、工程资料路径和可选的便携目录迁移警告。
- `workcrate_document_create({ projectId, directory, confirm: true })` 为已有工程创建并关联原生文档。需要完整 MCP 权限和已配置的可写根目录。
- `workcrate_board_catalog({ projectId })` 读取缓存画板目录。
- `workcrate_boards_refresh({ projectId })` 显式从已保存的原生文档刷新目录和预览缓存。
- `workcrate_board_create_page({ projectId, confirm: true })` 新增 A3 画板。
- `workcrate_board_update_info({ boardId, info, confirm: true })` 将 WorkCrate 管理的物料栏内容写入原生画板。

MCP 写操作遵循共享路径策略和当前 MCP 权限设置。MCP 创建工程还要求 `confirm: true`，并要求目标目录位于配置的 `mcp.writeRoots` 下。UI 操作使用用户明确选择的文件夹，并始终禁止写入 `app.getPath('userData')`。

## 存储与生命周期

- 工程元数据和资料位置由 Projects 服务管理。
- 本插件在工程资料目录中保存 `boards-cache.json` 和 `native-previews/`。缓存记录与当前原生文档绑定关联。
- CLI 会话使用隐藏、带超时的 headless 子进程，明确限定文档读写根目录，并使用工程隔离的 CLI 配置。
- 保存物料栏时，WorkCrate 写入 VectorCraft 原生对象及结构化元数据、保存文档，再刷新画板缓存。
- 普通画面编辑继续由 VectorCraft 完成。WorkCrate 显式同步已保存的画布并更新画板预览，不提供画布编辑或导出功能。

## 事件

- 文档关联、缓存刷新或原生变更成功后广播 `workcrate:boards-changed`。


## 双向同步与排序

- IPC `reorderPages({ projectId, boardIds })` 和 MCP `workcrate_boards_reorder({ projectId, boardIds, confirm: true })` 校验完整的当前画板列表，把排序和页码物料栏写入原生文档并保存、刷新预览。
- MCP `workcrate_document_open({ projectId, confirm: true })` 启动带控制服务器和文档目录读写范围的桌面编辑器，或连接已有控制服务器；GUI 路径为空时使用 CLI 同目录下的桌面程序。
- MCP `workcrate_panel_open({ projectId?, boardId? })` 分别打开项目管理、页面管理或指定页面编辑。
- 每 1.5 秒检查保存文件的时间/大小和桌面文档版本，按工程串行刷新。失败时广播 `workcrate:sync-error`，载荷为 `{ projectId, message }`，并自动重试。
- 桌面当前文档与工程匹配时，直接读取和编辑该文档，包含未保存修改；WorkCrate 修改会保存该桌面文档。当前显示其他文档时拒绝写入，需先在 VectorCraft 切回工程。外部启动桌面程序时须启用 `--control <配置端口>` 才能实时双向同步；无控制连接时仍支持保存后的文件同步。

`workcrate_panel_open` 还支持可选 `section: connection | basic`，分别打开程序默认信息中的程序连接或基础信息分页。

### 桌面空文档状态

控制连接正常但未打开文档是合法状态：自动版本检查跳过空窗口；手动读取同步通过无界面会话读取已保存文件；执行编辑时先在空窗口中打开绑定工程。`openInVectorCraft` / `workcrate_document_open` 同样能从空窗口打开工程。仅明确的 `no document open` 检查错误会被识别为空文档，其他检查或连接故障继续抛出。自动同步恢复后广播 `workcrate:sync-recovered`，载荷为 `{ projectId }`，渲染端清除过期的自动同步错误。编辑时仍不会擅自替换其他活动文档。

## 原生页面导出与选择

- IPC `exportBoards({ projectId, directory, boardIds?, format: png|jpg|pdf, scale?: 1 })` 输出至用户选择的已有文件夹，仅授权该文件夹，不改变全局 MCP 根目录。
- MCP `workcrate_boards_export({ projectId, directory, boardIds?, format, scale?, confirm: true })` 需 full 权限和配置可写根内的目录。省略 ID 导出全部；空列表、重复、其他工程或过期 ID 被拒绝。选中页面仍按原生文档顺序输出。
- 图片逐画板调用 VectorCraft `document.export`；PDF 调用 `document.exportPdf`，传入所需画板序号生成一个多页 PDF。不使用截图或缓存预览。校验原生返回字节后，以独占写入方式保存到唯一的新导出子文件夹，不覆盖已有文件，不保存或修改原工程。匹配的桌面文档已打开时，读取包含未保存修改的当前画板。
- 返回 `{ directory, files, warnings }`。图片倍率 0.25–4；单张上限 4000 万像素，同时受 MCP 响应大小限制。部分失败会报告输出目录和已完成数量，保留已完成文件。每次写入前重新校验文档绑定与版本。
- MCP `workcrate_pages_select({ projectId, mode: single|multiple|all|clear, boardIds?: [] })` 校验当前缓存页面 ID，广播 `workcrate:pages-selection`，载荷 `{ projectId, mode, boardIds }`，由已挂载的页面管理界面应用选中状态。不改变原生画布中的对象选择。


## 表格快速创建

- IPC `previewQuickCreate(text)` 解析 Excel/WPS 的 TSV 或 CSV，支持引号、转义引号、多行单元格、中文表头乱序和扩展物料字段。无表头默认六列：页面名称、物料类别、物料名称、尺寸标签、尺寸、数量；自动忽略空行。
- IPC `quickCreate({ projectId, table: { columns, rows }, reuseInitial?: true })` 每个有效行生成一张 A3 横向空白画布及原生物料栏，数量仅为物料信息。每批 1–200 行、最多 30 列/24 个扩展字段。未填页面名称自动使用页码。仅在唯一初始画板物料为空且没有非 WorkCrate 内容时复用，否则追加并保留已有画板。
- MCP `workcrate_quick_create_preview({ text })` 只解析；`workcrate_quick_create_open({ projectId, text? })` 广播 `workcrate:panel-open`（`quickCreate: true`、可选 `table`），打开可编辑草稿。
- MCP `workcrate_boards_quick_create({ projectId, table, reuseInitial?: true, confirm: true })` 遵循 full 权限及可写根；UI 仅授权已关联文档所在目录。返回 `{ count, reusedInitial, boards }`。
- 同工程串行操作，每批共用一个原生撤销组，逐行错误取消整组后不保存；保存后预览失败明确提示刷新，避免重复导入。保留原生物料栏单行布局限制。内部 `header.ts` 的 `manageUndo` 参数让批量物料写入复用外层撤销组。
