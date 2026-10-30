# 契约 — system-basic-app-tools

基础插件：通过 MCP 向外部 AI 暴露程序级操作与截图能力。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 | `system` |
| 子类 | `basic` |
| 名称 | `app-tools` |
| 入口 | `index.ts` |

## 依赖（inject）

- `mcp`

## 提供的 IPC 服务

无（能力仅经 MCP 暴露）。

## 提供的 MCP 工具

| 工具 | 参数 | 返回 | 说明 |
| --- | --- | --- | --- |
| `get_app_info` | — | 文本（JSON） | 应用版本、平台、electron/node/chrome 版本及 hardwareAcceleration/gpuFeatures（Electron 只读渲染诊断） |
| `list_windows` | — | 文本（JSON） | 所有窗口的 id / 标题 / 地址 / 可见性 |
| `control_window` | `action: focus\|close\|reload\|resize`，`windowId?: number`，`width?: number`，`height?: number` | 文本 | 缺省主窗口；resize 必须提供整数内容尺寸，宽 960–7680、高 620–4320 DIP，用于经 MCP 验证窗口缩放 |
| `capture_window` | `windowId?: number` | 图片（PNG） | 窗口内部渲染画面，缺省主窗口 |
| `capture_screen` | — | 图片（PNG） | desktopCapturer 全屏截图 |

## 广播事件

无。

## 消费的配置项

无。
