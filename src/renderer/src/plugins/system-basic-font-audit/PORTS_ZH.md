# system-basic-font-audit

- 域 / 子类 / 名称：`system` / `basic` / `font-audit`
- 入口：`index.tsx`
- 槽位贡献：`font-audit.open` 位于 `sidebar.activity.bottom`；`font-audit.panel` 位于 `floating.panels`。
- setup 注入全局渲染层样式并切换 `desksuite-font-audit` 根节点类；插件停用时移除样式和类。
- 审查开关是纯 UI 偏好，保存于 `desksuite.workbench.font-audit.enabled`。
- 开启时覆盖主要、次要、辅助、弱辅助、成功、警示和错误文字语义颜色；面板图例说明固定审查色板。
- 消费 `commands:action` 广播中的 `font-audit.toggle` 与 `font-audit.set:true|false` 动作。
- 不提供 IPC handler 或渲染层服务。共享命令插件注册 `system.toggle-font-audit` 与 `system.set-font-audit`，由 MCP `command_list` / `command_run` 暴露。
- 界面文案为中文。面板占用固定 420×500 px，内容区内部滚动。
- 排版角色字号在运行时从 `documentElement` 上的 `--ds-type-*` CSS 变量读取（由「设置 → 外观」配置）；角色表与不匹配判定跟随这些实时值，不再使用硬编码像素。
