# PORTS — data-ops-basket

跨会话文件暂存篮的持久化。数据存主进程 `store` 服务的 `basket` 键，渲染层不再使用 `localStorage`。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `data` |
| 子类 | `ops` |
| 名称 | `basket` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `store`

## 提供的 IPC 服务

服务名：`basket`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list` | — | `BasketItem[]` |
| `add` | `items: Omit<BasketItem, 'addedAt'>[]` | 更新后的 `BasketItem[]` |
| `remove` | `path: string` | 更新后的 `BasketItem[]` |
| `clear` | — | `[]` |

`BasketItem` = `{ path, name, isDirectory, kind, size, modifiedAt, addedAt }`。

## 数据契约

- 存储键：`basket`，落盘于 `<userData>/data/basket.json`，信封格式由 `store` 服务负责（含版本号与 `.bak`）。
- 上限 200 条，超出时丢弃尾部；重复 `path` 不重复加入。
- `addedAt` 由主进程写入，渲染层传入的值被忽略。

## 广播事件

无。

## 消费的配置项

无。

## 已知边界

渲染层 `BasketService` 保持同步签名（`list/add/remove/clear`），主进程写入是异步的：界面先乐观更新，再以主进程返回的数组为准。主进程不可用时暂存篮退化为"仅本次会话"，并在运行日志中记录一次错误。
