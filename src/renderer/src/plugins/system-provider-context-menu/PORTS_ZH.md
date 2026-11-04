# 系统提供者：右键菜单引擎

- 域：`system`
- 子类：`provider`
- 名称：`context-menu`
- 入口：`index.tsx`

## 依赖

- 宿主槽位 `overlay.root`（菜单浮层）。
- 宿主 vanilla store `layoutStore` / `themeStore`（兜底菜单的界面动作）。
- 主进程广播 `dev:context-menu`（来自 `system-basic-dev-lab`，验收用）。

## 提供的渲染服务 `contextMenu`

- `register(zoneId, handler, { order? }) => dispose`：为区域注册菜单构建器。同区域多个 handler 按 `order` 升序执行（默认 100），非空结果按贡献者顺序拼接（之间插入分隔线）；单个 handler 抛错只记录日志，不影响其他贡献者。
- `open(zoneId, x, y, context?) => boolean`：程序化打开某区域菜单（供验收脚本与后续应用内调用）；无 handler 产出菜单项时返回 false。

## 贡献

- `context-menu.overlay` 在 `overlay.root` 渲染全局菜单（z-120）：视口夹紧定位、递归子菜单、分隔线、图标、快捷键、勾选与危险项、禁用项原因提示、键盘导航（方向键 / Enter / Space / Esc / Home / End），点击外部、滚动、窗口缩放或失焦时关闭。

## 区域发现契约

- 元素打 `data-context-zone="<zoneId>"` 后，其内右键会路由到该区域的 handler（取最近祖先）。
- 内置区域：`__text`（可编辑元素的文本菜单，可被其他插件扩展）与 `__desktop`（系统兜底：命令面板、设置、启动台、剪贴板、主题、专注模式、重置布局）。
- 区域 handler 未产出菜单项时回落到 `__text` / `__desktop`。

## MCP / 调试通道

- 消费广播 `dev:context-menu` `{ zoneId, x?, y?, selector? }`，无需真实右键即可打开区域菜单（仅验收用）。`selector` 可指定目标元素以模拟在卡片上右键；缺省使用区域元素。

## 数据与配置

- 无持久化数据；菜单状态为临时态。
