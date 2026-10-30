# PORTS — note-ops-panel（主进程）

- 域 / 子类 / 名称：`note` / `ops` / `panel`
- 入口：`index.ts`

## 依赖（inject）

- `ipc`
- `mcp`
- `store`
- `config`
- `window`

## 提供的 IPC 服务

服务名：`notePanel`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `pickDirectory` | 无 | 用户选择的目录或 null；选择框明确说明写入授权，校验禁写/符号链接路径后追加到 `mcp.writeRoots`，不改变权限等级 |
| `complete` | `requestId: string, result: { error?: string; value?: unknown }` | —（由渲染层回填挂起的请求） |
| `loadPreferences` | 无 | `{ rootDir: string \| null, lastNote: string \| null, recentPaths: string[] }`，来自持久化存储 |
| `rememberPreferences` | `{ rootDir: string \| null, lastNote: string \| null, recentPaths?: string[] }` | 通过 zod 校验并写入后返回同一对象 |
| `loadDraft` | `path: string` | 返回规范化路径匹配的文本草稿 `{ path, markdown, updatedAt }`，无草稿时为 null |
| `saveDraft` | `{ path: string, markdown: string }` | 原子保存并返回 `{ path, updatedAt }`；最多保留 100 篇草稿，每篇最多 200,000 字符 |
| `clearDraft` | `path: string` | 删除该路径草稿后返回 true |
| `listDrafts` | — | `{ entries: Array<{ path, markdown, updatedAt }> }` |

## 提供的 MCP 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `note_panel` | `action: 'setroot' \| 'open' \| 'select' \| 'reload' \| 'new' \| 'setbody' \| 'setattrs' \| 'sourceMode' \| 'readingMode' \| 'findReplace' \| 'archive' \| 'restoreTrash' \| 'createVersion' \| 'restoreVersion' \| 'inspect'`；可选 `path`、`title`、`markdown`、`attributes`、`enabled`、`operation`、`query`、`replacement`、`versionId` | 渲染层返回的 JSON 文本；标记 `mutating: true` |
| `note_query` | `action: 'search' \| 'outline' \| 'inspect' \| 'versions'`；可选 `title`（搜索词）、`path`（版本查询路径） | 渲染层返回的 JSON 文本；标记 `mutating: false` |
| `note_task_status` | `requestId: string` | 只读任务状态；等待超时不代表任务已取消 |

- `setroot`：把笔记根目录设为 `path`（不弹系统目录选择框，路径不存在时报错）。
- `open`：激活笔记悬浮面板。
- `select`：优先按完整 `path` 加载笔记，也可按唯一 `title` 加载；同名标题必须指定路径。切换前自动完成当前文档的防抖保存。
- `reload`：丢弃编辑器当前改动，从磁盘重新读取当前笔记。
- `new`：在当前根目录按 `title` 新建一篇尚未落盘的笔记，与界面内联「新建」走同一路径（Electron 没有 `window.prompt`，所以不用弹窗输入标题）。
- `setbody`：通过编辑器 API 替换正文，并立即把新的序列化结果回报给面板，随后触发防抖自动保存。
- `setattrs`：通过 YAML 文档模型更新 `title/tags/category/status/date`，保留未知字段与注释；错误 YAML 会返回错误。
- `sourceMode`：设置源码/所见即所得模式，参数为 `enabled`。
- `findReplace`：`operation` 为 `next`、`replaceCurrent` 或 `replaceAll`，使用 `query` 与可选 `replacement`。
- `archive`、`restoreTrash`：归档当前笔记或从回收区恢复，需在应用内确认，文件操作仍经计划与批准链路。
- `createVersion`、`restoreVersion`：创建 Lore 文本快照或恢复当前笔记的指定 `versionId`；恢复需应用内确认。`note_query.versions` 只读列出版本元数据，不读取附件或资源字节。
- `inspect`：回报根目录、当前笔记、篇数、脏标记、自动保存状态、正文长度、面板状态里的正文样本、编辑器实时 Markdown 与 Crepe 实例是否挂载。
- `note_query.search`：用 `title` 搜索已加载笔记标题、路径和正文；`outline` 返回标题树与文本统计；`inspect` 只读查看当前状态；`versions` 按 `path`（缺省为当前笔记）列出 Lore 版本。

## 广播事件

| 频道 | 载荷 | 消费方 |
| --- | --- | --- |
| `note:action` | `{ action, path?, title?, markdown?, attributes?, enabled?, operation?, query?, replacement?, versionId?, requestId }` | 渲染层 `note-ops-markdown` 面板，处理后经 `notePanel.complete` 回填 |

请求最多等待 15 秒。超时后 `note_panel` 会返回 `requestId`，可用 `note_task_status` 查询 `pending`、`wait_timed_out`、`completed` 或 `failed`。等待超时不会取消渲染层操作。插件生命周期内保留最近 200 项状态。

## 存储

| 键 | 结构 | 用途 |
| --- | --- | --- |
| `note-panel-preferences` | `{ rootDir: string \| null, lastNote: string \| null, recentPaths: string[] }` | 渲染进程重载后恢复笔记目录、打开项和最多 20 篇最近笔记；目录被改名或删除时在面板内提示原因，不会自动弹系统目录选择框 |
| `note-panel-drafts` | `{ entries: Array<{ path: string, markdown: string, updatedAt: number }> }` | 版本化原子持久化文本草稿，以规范化路径为键；自动保存流程另行将实际文档变化写入已授权笔记文件 |

## 消费的配置项

`mcp.writeRoots`：仅通过系统目录选择框授权用户选定的目录；MCP `setroot` 不授予写入权限。

草稿与笔记文件分离，保存草稿本身不会执行文件写操作。每篇最多 200,000 字符，拒绝内嵌 `data:image/...;base64` 数据，图片应保留在共享资源系统中；最多保留 100 个路径草稿。笔记正文防抖自动保存；`inspect` 回报 `autoSaveStatus`、`pendingExecution` 和 `error`，面板筛选/布局等 UI 状态不触发写入。

笔记内容在目录授权后自动保存；`inspect` 回报 `autoSaveStatus`、`pendingExecution` 和 `error`。面板筛选、排序、布局等 UI 状态不触发文件写入。
