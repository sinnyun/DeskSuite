# system-provider-commands

- 域 / 子类 / 名称：`system` / `provider` / `commands`。
- 入口：`index.ts`。
- 注入：核心 `commands` 服务、`ipc` 服务。
- 本插件只向核心 `CommandsService` 注册工作台内置动作，不再维护自己的命令注册表或审批状态。
- 内置命令涵盖面板与页签导航（包括 `debug-console` 调试信息悬浮面板与 `system.open-debug-console`）、侧栏和布局控制、渲染日志清理/重载、主题、设置、启动台、剪贴板、字体审查模式（`system.toggle-font-audit`、`system.set-font-audit`）、渲染插件启停（`system.set-plugin-enabled`）和调试控制台筛选（`system.set-debug-console-view`）。
- 界面与 MCP 调用同一命令定义。界面调用返回动作描述；MCP 调用广播 `commands:action`，由渲染层应用动作。
- `system.set-debug-console-view` 是例外：它广播插件私有频道 `debug-console:view`，载荷是通过校验的补丁 `{ search?, source?, levels?, categories?, expanded?, reset? }`（字段全部可选、严格对象），不走 `commands:action` 动作动词——调试面板筛选归 `system-basic-debug-console` 自己所有，不能为此扩大共享动作白名单。
- 命令的写操作标记和计划由共享命令服务统一处理。
- 事件：渲染层命令面板处理 `commands:action`；本插件为调试控制台插件广播 `debug-console:view`；核心服务通过 `commands:approval` 广播界面审批请求。
- `system.set-plugin-enabled` 由渲染插件目录执行，并继续应用核心插件限制及 setup/dispose 生命周期。
- 本插件不直接注册 MCP 工具。核心 MCP 适配器基于共享命令目录提供 `command_list` 与 `command_run`。
