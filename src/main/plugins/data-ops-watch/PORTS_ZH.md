# PORTS — data-ops-watch

监视 Explorer 窗格当前浏览和展开固定的目录，并合并广播文件系统变更。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `data` |
| 子类 | `ops` |
| 名称 | `watch` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `settings`

## 提供的 IPC 服务

服务：`watch`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `setPaneDirectories` | `paneId: string, directories: string[]`（绝对路径） | 当前监听目录；所有窗格合计最多 16 个 |
| `clearPane` | `paneId: string` | 当前监听目录 |
| `getDirectories` | — | 对账后的监听目录 |

## 广播事件

- `fs:changed` — `{ paths: string[], dirs: string[], invalidate: boolean }`。按 `watch.debounceMs` 设置去抖（100–5000ms，默认 500）；每目录最多列出 200 条变更路径，超出后 `invalidate` 为 true 且 `paths` 为空。
- `fs:watch:error` — 底层监视器报错时发送 `{ message: string }`。

## 依赖与行为

- 通过动态导入使用 `chokidar@6.0.0`；非递归监听，处理原子保存合并与写入稳定检测。
- 仅监听渲染层提交的窗格当前目录和展开/固定目录，总量上限 16。
- 对账只记录本插件自行添加的目录。chokidar 会额外监听父目录与子目录，对这些目录执行 `unwatch` 会拆除整棵子树并导致事件完全丢失，因此绝不触碰。
- 设置项：`watch.debounceMs`，变更后立即影响新事件批次；无 MCP 工具。
