# PORTS — system-basic-window-controls（渲染层插件）

在顶栏右上角渲染无边框窗口的最小化 / 最大化 / 关闭按钮。

## 元数据

| 字段 | 值 |
| --- | --- |
| 类型 | 渲染层插件 |
| 域 | `system` |
| 子类 | `basic` |
| 名称 | `window-controls` |
| 入口 | `index.tsx` |
| 主进程能力 | `system-basic-window-controls` |

## 槽位贡献

| 槽位 | 贡献 id | 内容 |
| --- | --- | --- |
| `top.window_controls` | `window.controls` | 最小化 / 最大化-还原 / 关闭按钮 |

## 服务

提供：无。

消费：无需 `ui` 服务（按钮为插件内部实现）。

## 使用的主进程 IPC

| 服务 | 方法 | 用途 |
| --- | --- | --- |
| `windowControl` | `minimize` / `toggleMaximize` / `close` | 窗口操作 |
| `windowControl` | `state` | 初始 `{ maximized, fullscreen, focused }` 状态 |

## 消费的事件

- `window:state` —— 主进程插件广播的窗口状态，用于切换最大化/还原图标。

## 行为说明

- 双击任意 `.app-drag` 区域切换最大化（忽略 `.app-no-drag` 内部元素）。
- 顶栏需保持可拖拽；本插件不改动按钮组之外的 `-webkit-app-region`。
