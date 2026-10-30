# PORTS — system-basic-window-controls

无边框窗口控制插件，供自定义标题栏使用。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `system` |
| 子类 | `basic` |
| 名称 | `window-controls` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `window`

## 提供的 IPC 服务

服务名：`windowControl`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `minimize` | — | `true` |
| `toggleMaximize` | — | `boolean`（切换后的最大化状态） |
| `close` | — | `true` |
| `reload` | — | `true` |
| `state` | — | `{ maximized, fullscreen, focused }` |

## 提供的 MCP 工具

无。

## 广播事件

| 通道 | 负载 | 时机 |
| --- | --- | --- |
| `window:state` | `{ maximized, fullscreen, focused }` | 最大化/还原/全屏/聚焦/失焦 |

## 消费的配置项

无。
