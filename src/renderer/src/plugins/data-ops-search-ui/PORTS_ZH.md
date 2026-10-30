# data-ops-search-ui

- 域 / 子类 / 名称：`data` / `ops` / `search-ui`
- 入口：`index.tsx`
- 依赖：UI kit 与布局服务；主进程 `search.query` 和 `filesystem.reveal` IPC。
- 贡献：在 `top.actions` 提供全局索引搜索入口，在 `floating.panels` 提供固定尺寸搜索面板；当前目录筛选保留在地址栏输入框中。
- 搜索主进程已索引的文件名与路径；每页 50 条。主搜索服务可组合标注筛选。
- 未索引目录仍能通过 Explorer 实时浏览。
- 存储、配置、事件和 MCP 工具由对应主进程插件管理。
- 界面文案使用中文。
