# PORTS — system-provider-storage

聚合各插件在 `<userData>` 下的私有数据位置，并统计实际占用空间。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `system` |
| 子类 | `provider` |
| 名称 | `storage` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `store`
- `mcp`

## 提供的服务：`storage`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `register` | `pluginId: string`、`registration: { title, entries }` | — |

`entries[]` 中每一项必须且只能提供以下一种位置：

- `storeKey` — 已注册到 `store` 服务的文档键，路径由 `store.resolvePath` 解析。
- `relativePath` — 相对 `<userData>` 的文件或目录；`kind: 'file' | 'directory'`，默认 `file`。
- `label` 必填，`description` 可选。

重复插件标识、非法标识或试图逃出 `<userData>` 的路径会直接抛错。

## IPC 服务：`storage`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list` | — | `StorageSnapshot` |
| `open` | `path: string` | `true` |

- `StorageSnapshot` = `{ userData, groups, size, files, measuredAt }`；每个分组为 `{ plugin, title, entries, size, files }`；每个条目为 `{ label, description?, path, kind, exists, size, files }`。
- 大小在请求时递归统计；不存在的路径返回 `exists: false`，且不允许打开。
- 未被任何插件登记的 store 文档会归入 `unclassified` 分组（`其他数据`），保证新增的 store 数据仍能自动出现。
- `open` 只接受与登记条目完全一致的路径。目录用文件管理器打开；文件则在文件管理器中选中该文件。

## MCP 工具

- `plugin_storage` — 只读，返回与 IPC 相同的快照 JSON。

## 广播事件

无。

## 消费的配置项

无。

## 已知边界

只允许登记 `<userData>` 内的位置；应用级 `config.json` 由本插件自行登记。渲染层 `localStorage` 由 Chromium 管理，不纳入统计。
