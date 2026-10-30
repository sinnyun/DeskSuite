# system-provider-ui-kit

## 元数据

- 域：`system`
- 子类：`provider`
- 名称：`ui-kit`
- 入口：`index.tsx`
- 层级：渲染层（槽位 UI 插件）

## 依赖

- 只从 `workbench/sdk` 导入 `RendererPlugin` 类型与 `definePlugin`。
- 不消费其他插件。

## 提供的服务

| 服务 | 类型 | 说明 |
| --- | --- | --- |
| `ui` | `UiKit` | 所有渲染插件共享的主题化 React 原语 |

`UiKit` 成员：`DesktopButton`、`DesktopIconButton`、`DesktopInput`、`DesktopTextarea`、`DesktopSelect`、`DesktopCard`、`DesktopCardButton`、`DesktopTagPill`、`DesktopTab`、`ActivityButton`、`ThemeSidebarPanel`、`ThemeWorkspacePanel`、`ThemeCollapsibleSection`、`ThemeFloatingPanel`。

- `DesktopTab`：页签按钮，支持 `label`、`icon`、`badge`、`active`、`tone`（`pill` / `solid`）。
- `DesktopSelect`：主题化下拉选择，选项为 `{ value, label }`，可选 `icon` 与 `ariaLabel`。
- `DesktopCardButton`：主题化可选卡片按钮；插件只提供内容、交互与网格布局，不重复书写卡片颜色、边框、圆角或选中样式。
- `ThemeFloatingPanel`：通过 `workbench/sdk` 布局状态恢复位置、尺寸和最大化状态；持久化键默认使用面板标题。

## 槽位

无。本插件只提供服务，不贡献槽位内容。

## 事件

无。
