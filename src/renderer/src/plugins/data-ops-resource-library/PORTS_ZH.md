# PORTS — data-ops-resource-library

- 元数据：data / ops / resource-library；入口 `index.tsx`。
- 槽位：sidebar.activity 的 resources.activity、floating.panels 的 resources.panel。中文资源面板初始 920×620，内部滚动。
- 经 SDK 消费可选 resources 和必需 ui 服务；资源服务缺失时显示降级提示。
- 提供本地路径/多文件选择登记、链接列表、元数据、取消登记、可用状态刷新。图片经真实 Leafer Canvas + 图片租约显示，原生 video/audio 使用相同资源链接；文本只提供最多 1 MiB 的原始文本检查，不在本面板实现 PDF/Office 阅读器或新画板。
- 消费 resources:changed 刷新列表；消费 resources:action 完成 open/preview/inspect/play/pause/seek/fetch/leafer，并经 IPC resources.complete 回执。fetch 只能读取统一资源协议，响应最多 1 MiB。
- 关闭/切换面板停止媒体；先销毁图片画布再释放租约。MCP resource_view 是自动化入口，CDP 只做只读断言。
- 无浏览器持久化、直接文件系统访问、对外渲染服务或用户配置项。
