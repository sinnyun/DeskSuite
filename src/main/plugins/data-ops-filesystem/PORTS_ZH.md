# PORTS — data-ops-filesystem

真实文件系统能力插件。向渲染层提供目录浏览、文本/图片预览、系统打开/定位与文件夹选择，同时通过 MCP 暴露只读 AI 工具。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `data` |
| 子类 | `ops` |
| 名称 | `filesystem` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `mcp`
- `window`

## 提供的 IPC 服务

服务名：`filesystem`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `drives` | — | `{ name, path, total, free, isNetwork }[]` |
| `quickAccess` | — | `{ id, label, path }[]`（主目录/桌面/文档/下载/图片） |
| `listDir` | `path: string, limit?: number`（绝对路径；默认 200，最大 500） | `{ path, parent, entries, truncated, nextCursor, stale }`；条目为 `{ name, path, isDirectory, kind, size, modifiedAt }` |
| `listMore` | `cursor: string, limit?: number` | 返回下一页，结构相同。游标两分钟后过期；`stale: true` 表示目录已变化，应重新加载。 |
| `statPaths` | `paths: string[]`（最多 2,000） | 返回仍存在路径的 `FsEntry[]`；不存在的路径自动跳过。供持有目录外路径列表的消费方使用（如标签聚合）。 |
| `readText` | `path: string` | `{ path, content, truncated }`，上限 2MB，二进制拒绝 |
| `readImage` | `path: string` | `{ path, dataUrl }`，上限 12MB，支持 png/jpg/gif/webp/bmp/ico/svg |
| `readMedia` | `path: string` | `{ path, dataUrl, mimeType }`，上限 64MB，支持 mp4/webm/mov/mkv/mp3/wav/ogg/flac/m4a/aac |
| `open` | `path: string` | `true`，用系统默认程序打开 |
| `reveal` | `path: string` | `true`，在系统文件管理器中定位 |
| `pickDirectory` | — | `string \| null`，系统文件夹选择器 |

本插件仅读取用户文件；所有写入均由 `data-ops-file-operations` 计划并执行。

## 提供的 MCP 工具

| 工具 | 参数 | 返回 |
| --- | --- | --- |
| `list_drives` | — | 文本（JSON） |
| `list_directory` | `path?: string, cursor?: string, limit?: number`（缺省主目录/200 项/最大 500 项） | 文本（格式化分页；有后续项目时返回 `nextCursor`） |
| `read_text_file` | `path: string` | 文本（文件内容，上限 2MB） |

## 广播事件

无。

## 消费的配置项

无。

## 网络驱动盘显示

额外注入 store。drives / list_drives 每项增加 isNetwork 布尔值；Windows 使用隐藏执行且有超时的 PowerShell 查询 Win32_LogicalDisk 的 DriveType=4，识别映射为盘符的网络盘。容量探测保持原逻辑。识别不可用时保持条目可见，按本地/未知处理；非 Windows 根目录不标记为网络盘。

IPC getDrivePreferences() 读取 `{ showNetworkDrives: boolean }`；setDrivePreferences(preferences) 校验并保存后广播 filesystem:drivePreferences（载荷为保存的设置）。Store 键 explorer-drive-preferences，默认 true，跨工作区共享并在重启后保留。MCP explorer_drive_preferences({ showNetworkDrives?: boolean }) 读取或修改同一设置（低影响写工具）。只筛选左侧驱动器列表，list_drives 仍返回全部盘，不断开网络盘，不影响收藏及路径导航。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
