# system-basic-shell

## 元数据

- 域：`system`
- 子类：`basic`
- 名称：`shell`
- 入口：`index.tsx`
- 层级：渲染层（槽位 UI 插件）

## 依赖

- 仅从 `workbench/sdk` 导入 `definePlugin`、`SlotRenderer`、`useLayout`、`useTheme`、`useUiKit`、`useContributions`、`log`。
- 消费 `system-provider-ui-kit` 提供的 `ui` 服务。
- 通过宿主布局状态按 id 打开悬浮面板（`analytics`、`basket`、`clipboard`、`plugins`）。
- 窗口拖动使用 `.app-drag` / `.app-no-drag`；窗口按钮由 `system-basic-window-controls` 贡献。

## 贡献

| 槽位 | id | 说明 |
| --- | --- | --- |
| `app.root` | `shell.root` | 完整工作台骨架：顶栏、活动栏、左右侧栏、中央工作区、底部抽屉、状态栏、分栏与悬浮面板宿主 |

外壳负责渲染的槽位容器：`top.actions`、`top.window_controls`、`sidebar.activity`、`sidebar.activity.bottom`（底部固定组）、`sidebar.left.tabs/content`、`workspace.toolbar/views`、`sidebar.right.tabs/content`、`bottom.tabs/toolbar/content`、`statusbar.left/right`、`floating.panels`。顶栏只保留菜单、拖拽区与全局入口，业务导航由工作区工具栏承担。

## 分栏折叠

左右侧栏与底部抽屉的分栏手柄在悬停时显示折叠按钮，折叠状态写入宿主 `useLayout`；页签贡献 `label`（接收 `{ active }`）时用于渲染动态页签文案与徽标。

## 快捷键

`Ctrl+B` 左侧栏、`Ctrl+Shift+B` / `Ctrl+I` 右侧栏、`Ctrl+J` 底部抽屉、`Ctrl+Alt+R` 重置布局、`F11` 禅模式、`Alt+W` 悬浮面板、`Alt+1/2/3` 统计/暂存篮/剪贴板面板。

## 事件

无。全部界面状态由宿主 `useLayout` 存储维护。
