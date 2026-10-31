# PORTS — system-basic-debug-console（渲染层插件）

把程序操作、IPC 请求/响应、主进程广播、MCP 调用和渲染层手工日志聚合到可调整大小的悬浮面板。

## 元数据

| 字段 | 值 |
| --- | --- |
| 类型 | 渲染层插件 |
| 域 / 子类 / 名称 | `system` / `basic` / `debug-console` |
| 入口 | `index.tsx` |

## 槽位贡献

| 槽位 | 贡献 ID | 用途 |
| --- | --- | --- |
| `sidebar.activity` | `console.activity` | 打开或关闭调试悬浮面板 |
| `floating.panels` | `debug-console.panel` | 1320×820 初始尺寸的可调整面板，包含分类/级别筛选、搜索、调用链折叠、载荷查看、复制、导出和清空 |
| `statusbar.right` | `console.status` | 显示日志/错误计数，点击打开悬浮面板 |

## 服务与数据来源

- 消费 `ui` 服务及 workbench 布局和日志仓库。
- 通过 `runtime:log` 接收 IPC、MCP、主进程广播诊断；渲染层功能日志经 workbench `log()` 接入。
- workbench bridge 记录渲染端发送/接收阶段，`IpcService` 记录主进程请求/响应数据；同一操作 trace ID 会关联两端记录及同步产生的广播。
- MCP 调用记录包含参数、结果、耗时和关联 ID。渲染层插件可经 `log()` metadata 记录语义动作/处理/结果，或用 `callWithTrace()` 将多个 IPC 调用归到同一操作链。
- 调试面板在插件内部通过独立的中文名称目录翻译日志来源、IPC 服务/方法、MCP 工具、事件通道、阶段和常见载荷字段；搜索同时匹配中文显示名与原始标识，原始标识保留在悬停提示及 JSON 导出中。未知标识使用中文兜底名称，不改变日志采集和业务服务。
- 每条载荷最多 48 KB，长字符串/长数组会截断；base64 data URL 显示 MIME 类型与估算字节数；凭据类字段名会脱敏。
- 设置与调试台 UI 捕获的异常在显示或写入日志前经 SDK `errorText()` 统一提取；错误文本有长度限制，本机路径和凭据模式会脱敏。
- 内存环形缓冲最多保留 3000 条。清空只清除当前界面日志仓库，主进程缓冲在应用重启前仍保留。
- 面板自己的级别/类别/来源/搜索/展开状态由插件内 Zustand vanilla store 持有；筛选不会修改 workbench 日志仓库。
