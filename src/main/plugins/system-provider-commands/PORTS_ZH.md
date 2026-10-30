# system-provider-commands

- 域 / 子类 / 名称：`system` / `provider` / `commands`。
- 入口：`index.ts`。
- 注入：核心 `commands` 服务、`ipc` 服务。
- 本插件只向核心 `CommandsService` 注册工作台内置动作，不再维护自己的命令注册表或审批状态。
- 内置命令涵盖面板与页签导航、侧栏和布局控制、渲染日志清理/重载、主题、设置、启动台、剪贴板和字体审查模式（`system.toggle-font-audit`、`system.set-font-audit`）。
- 界面与 MCP 调用同一命令定义。界面调用返回动作描述；MCP 调用广播 `commands:action`，由渲染层应用动作。
- 命令的写操作标记和计划由共享命令服务统一处理。
- 事件：渲染层命令面板处理 `commands:action`；核心服务通过 `commands:approval` 广播界面审批请求。
- 本插件不直接注册 MCP 工具。核心 MCP 适配器基于共享命令目录提供 `command_list` 与 `command_run`。
