# PORTS — system-basic-debug-console（渲染层插件）

把工作台日志流呈现出来：活动栏入口、底部抽屉标签、工具栏操作与状态栏计数。

## 元数据

| 字段 | 值 |
| --- | --- |
| 类型 | 渲染层插件 |
| 域 | `system` |
| 子类 | `basic` |
| 名称 | `debug-console` |
| 入口 | `index.tsx` |

## 槽位贡献

| 槽位 | 贡献 id | 内容 |
| --- | --- | --- |
| `sidebar.activity` | `console.activity` | 终端按钮，切换底部抽屉 |
| `bottom.tabs` | `console` | 标签「调试控制台」，`label` 组件动态显示错误数徽标 |
| `bottom.content` | `console` | `ConsolePanel`：级别筛选条 + 搜索 + 按时间倒序的日志列表，可按行展开载荷 |
| `bottom.toolbar` | `console.toolbar` | 复制筛选结果、导出 JSON、清空按钮 |
| `statusbar.right` | `console.status` | 日志条数与错误条数胶囊，点击打开控制台标签 |

## 服务

提供：无。

消费：`ui`（必需）。

## 数据来源

- 宿主日志仓库（`useLogs`、`logStore`、`log`）—— 渲染层日志，以及主进程
  `system-basic-runtime-log` 广播的 `runtime:log`。
- `clipboard.writeText` IPC，用于复制日志文本。
- `filesystem.saveText` IPC，用于导出日志 JSON（系统保存对话框）。

## 行为说明

- 活动栏按钮以当前日志条数作为徽标。
- 视图筛选（级别/搜索/展开状态）由插件内部 `consoleViewStore` 维护，不持久化。
- 清空只作用于渲染层日志仓库，不影响主进程环形缓冲。
