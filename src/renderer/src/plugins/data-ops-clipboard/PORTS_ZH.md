# PORTS — data-ops-clipboard（渲染层）

剪贴板悬浮工作台，支持文本/图片实时预览、草稿编辑和分类历史。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `data` / `ops` / `clipboard` |
| 入口 | `index.tsx` |
| 主进程能力 | `system-basic-clipboard` |

## 槽位贡献

- `sidebar.activity`：打开剪贴板工作台。
- `floating.panels`：初始尺寸 1260×760 px 的可调整三栏面板，包含筛选导航、历史卡片和选中项编辑器。

## 服务与 IPC

消费 `ui` 和主进程 IPC `clipboard`：`readText`、`readImage`、`writeText`、`capture`、`history`、
`historyImage`、`importLegacy`、`setFavorite`、`removeHistory`、`clearHistory`、`useHistory`、`updateHistory`、
`groups`、`createGroup`、`renameGroup`、`deleteGroup`、`assignGroup`。

一次性旧历史导入由主进程限制为最多 500 条、单条 1,000,000 字符、总计 2 MiB。
- 渲染层在写入 React 状态前会解码历史（最多 50 条）、分组（最多 50 个）、文本（最多 4,000,000 字符）和 PNG data URL。图片预览上限为 8 MiB；无效或超限的磁盘图片返回 `null`。

## 存储与行为

- 历史由主进程 `store` 持有；旧 `desksuite.clipboard.history` localStorage 仅用于一次迁移，IPC 成功后删除。
- 最多 50 条，SHA-256 去重，自动分类文本/链接/代码/图片，临时项七天过期，支持收藏和持久化用户分组。
- 仅在面板打开期间每 1.5 秒采集剪贴板。
- MCP `read_clipboard` 可返回 PNG 图片内容；`write_clipboard` 仍只写文本。
