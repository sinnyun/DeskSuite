# system-basic-command-palette

- 域 / 子类 / 名称：`system` / `basic` / `command-palette`
- 入口：`index.tsx`
- 槽位贡献：`commands.palette` 位于 `floating.panels`，固定 640×480 px，内容区内部滚动。
- 使用 `cmdk@1.1.1` 提供无障碍搜索、键盘选择和命令过滤。
- 通过 `commands.list` 读取命令，通过 `commands.run` 执行；mutating 计划走 `commands.approve` / `commands.execute`。
- Ctrl+K 打开面板；已注册命令的快捷键派发同一个命令 ID。
- 订阅 MCP 请求的 `commands:approval` 与内置界面/主题动作的 `commands:action`。
- 展示权限徽标，并在执行 mutating 命令前显示人工批准弹窗。
- 界面文案使用中文。
