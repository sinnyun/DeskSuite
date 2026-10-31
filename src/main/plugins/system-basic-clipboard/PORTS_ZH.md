# PORTS — system-basic-clipboard

系统剪贴板读写与持久化文本/图片历史能力。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `system` / `basic` / `clipboard` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `mcp`
- `store`

## IPC 服务

服务名：`clipboard`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `readText` / `writeText` | 写入需要 `text` | 文本 / `true`；写入上限 100 万字符 |
| `readImage` / `writeImage` | 写入参数为 PNG data URL | PNG data URL 或 `null` / `true`；写入上限 8 MiB |
| `hasImage` | — | 系统剪贴板当前是否含图片 |
| `capture` | — | 当前历史项或 `null` |
| `history` | — | 最多 50 条未过期记录 |
| `groups` / `createGroup` / `renameGroup` / `deleteGroup` | 分组操作；创建传 `name`，重命名传 `id`、`name`，删除传 `id` | 持久化剪贴板分组 |
| `assignGroup` | `id`、`groupId: string \| null` | 设置或清除历史项所属分组 |
| `updateHistory` | `id`、`content` | 更新文本历史并重新计算分类与去重 id |
| `historyImage` | `id` | PNG data URL 或 `null` |
| `importLegacy` | `texts: string[]`（最多 500 条、单条 1,000,000 字符、总计 2 MiB） | `true` |
| `setFavorite` | `id`、`favorite` | `true` |
| `removeHistory` | `id` | `true` |
| `clearHistory` | — | 清除临时项并保留收藏 |
| `useHistory` | `id` | 将历史项写回系统剪贴板 |

## MCP 工具

| 工具 | 参数 | 返回 | 权限 |
| --- | --- | --- | --- |
| `read_clipboard` | — | 文本或 PNG 图片内容 | 只读 |
| `clipboard_history_list` | — | 未过期历史条目的 JSON 文本列表，不含图片正文 | 只读 |
| `clipboard_history_image` | `id` | PNG 图片块；槽位缺失、损坏或超过 8 MiB 时返回错误 | 只读 |
| `write_clipboard` | `text` | 确认文本 | 写·低影响 |

`write_clipboard` 需要 MCP 访问级别至少为 `standard`，并写入审计日志。

## 持久化与上限

- store 文档 key：`clipboard-history`、`clipboard-groups`（`data/clipboard-*.json`）。
- PNG 字节保存在 `data/clipboard-images/` 下 50 个固定槽位，只能淘汰临时项。
- 读取 PNG 时确认磁盘文件是 1 字节到 8 MiB 的普通文件；损坏/超限的预览返回 `null`，`useHistory` 会在写入系统剪贴板前拒绝。
- 临时项 7 天过期；50 条历史上限内保留收藏。
- 剪贴板历史 JSON store 的序列化文档上限为 64 MiB。
- 分类：文本、链接、代码、图片；用 SHA-256 去重。

## 事件 / 配置

无。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
- PNG 历史恢复只打开一次文件，在同一句柄上 fstat，并最多读取 8 MiB + 1 字节。读取期间增长会被拒绝且不会无界分配；`historyImage` 对缺失/损坏槽位仍返回 `null`，`useHistory` 保留原有缺失/非法文件报错语义。
