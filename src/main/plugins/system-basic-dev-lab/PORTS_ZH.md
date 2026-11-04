# system-basic-dev-lab

- 域 / 子类 / 名称：`system` / `basic` / `dev-lab`
- 入口：`index.ts`
- 注入依赖：Cordis 服务 `db`、`ipc`、`mcp`、`jobs`、`audit`。
- 数据所有权：仅在 catalog 的 `files` 表维护虚拟记录。合成 `path_key` 固定使用 `devlab:<profile>:` 前缀，路径使用 `devlab://synthetic/` URI；插件不会创建或修改磁盘文件。

## IPC

服务名：`devLab`。

- `inject(count, profile?)` 以每批 500 行插入或更新 1–200,000 条合成图片记录，返回 `{ jobId, count, profile }`。
- `clear(profile?)` 分批删除指定 profile 前缀下的记录，返回 `{ jobId, profile }`。
- `status(profile?)` 返回 `{ profile, rows, runningJobId, maxRows }`。
- profile 默认是 `default`；仅接受最多 32 个字符的 ASCII 字母、数字和连字符。每个 profile 同时最多运行一个任务。
- 长操作使用共享 `jobs` 服务、广播进度，并在每批事务之间响应取消。

## MCP

- `dev_inject_data({ count, profile? })` 启动低影响写任务并返回作业 ID。
- `dev_clear_data({ profile? })` 启动低影响写任务，只清理本插件创建的虚拟记录。
- `dev_status({ profile? })` 为只读工具。
- `dev_open_context_menu({ zoneId, x?, y?, selector? })` 广播 `dev:context-menu`，让渲染层直接打开指定 `data-context-zone` 的右键菜单（仅供验收；区域无贡献时回退内置兜底菜单）。`selector` 可指定菜单目标元素（如 `[data-entry-path]`）模拟在卡片上右键；缺省使用区域元素。

## 事件与设置

- 使用共享 `job:progress` 与 `job:done` 事件。
- 注入与清理结果写入 `audit`。
- 不消费配置项，也不注册额外广播事件。
