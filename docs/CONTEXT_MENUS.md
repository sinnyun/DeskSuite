# DeskSuite 右键菜单系统设计

> 状态：设计定稿，随批次开发同步修订。
> 范围：渲染层全局右键菜单引擎 + 全部界面位置接入。

## 1. 背景与现状问题

| # | 问题 | 位置 |
|---|------|------|
| P1 | 全应用只有文件工作区一处右键菜单，其余 20+ 个界面（画布、笔记、标签页、看板、启动台、搜索、剪贴板、调试台、各悬浮面板标题栏……）右键无任何响应 | 全局 |
| P2 | 现有菜单的操作对象是"当前多选集合"，右键未选中的条目不会自动选中它，与 Windows/桌面软件习惯相悖 | `data-ops-file-actions` |
| P3 | 菜单项硬编码，无数据模型、无子菜单、无图标/快捷键/禁用/勾选/危险项，无法复用 | `data-ops-file-actions` |
| P4 | **`window.prompt` 在 Electron 中不受支持**（见 `note-ops-markdown/NotesPanel.tsx:516` 注释），现有菜单的复制/移动/重命名/新建目录实际全部失败 | `data-ops-file-actions` 等多处 |
| P5 | 触发区域用 `[data-file-workspace]` 硬编码划区，无统一的区域声明与多插件组合机制 | `data-ops-file-actions` |

底层能力已经齐备：文件操作计划流（`fileOps` + `file.*` 命令 + 人工批准）、标签/评分/收藏（`annotations`）、暂存篮（`basket`）、书签（`quickBookmarks`）、画布命令（`canvas` 服务 command API）、版本（`versions`）、剪贴板（`clipboard`）等。本次工作核心是**统一菜单引擎 + 各位置编排**，无需新增底层 IPC（仅新增 1 个验收用 MCP 工具）。

## 2. 目标与设计原则

1. **一个引擎，处处接入**：新建核心插件 `system-provider-context-menu` 提供渲染服务 `contextMenu`，任何插件声明自己的"右键区域"即可获得完整菜单能力。
2. **声明式区域 + 组合式处理器**：界面元素打 `data-context-zone="<zoneId>"`；插件通过 `contextMenu.register(zoneId, handler, { order })` 注册菜单构建器。同一区域允许多个插件叠加贡献（如资源管理器工作区 = explorer 的导航/标注项 + file-actions 的文件操作项）。
3. **右键即选中**：右键命中条目且不在多选内时，先将其设为唯一选中，再构建菜单；已在多选内则保留多选。
4. **复用现有执行通道**：菜单动作一律走既有服务/命令/审批流（`commands.run`、各服务 IPC、画布 command API），菜单层不做业务。
5. **修掉 P4**：在 ui-kit 增加 `prompt()` 对话框原语（Promise 风格），替换 Electron 下已损坏的 `window.prompt` 调用点。
6. **处处有响应**：无区域命中的位置由引擎提供兜底菜单（可编辑文本 → 剪切/复制/粘贴/全选；其余 → 命令面板/设置/主题等系统项）。

## 3. 总体架构

```
┌─ system-provider-context-menu（核心插件，不可停用）────────────┐
│  service contextMenu:                                        │
│    register(zoneId, handler, { order? }) => dispose          │
│    open(zoneId, x, y, ctx?) => boolean   // 程序化打开（调试）│
│  overlay（overlay.root 贡献）：                               │
│    document 捕获 contextmenu → closest('[data-context-zone]') │
│    → 依 order 拼接各 handler 的菜单项 → 渲染菜单              │
│  内置区域：__text（可编辑元素）、__desktop（兜底）            │
│  监听 dev:context-menu 广播（验收/MCP 驱动打开）              │
└──────────────────────────────────────────────────────────────┘
```

### 3.1 菜单项数据模型（宿主 `workbench/types.ts`）

```ts
export interface ContextMenuItem {
  id: string
  label: string
  icon?: ReactNode
  shortcut?: string            // 仅展示提示
  danger?: boolean             // 红色危险项
  disabled?: boolean | string  // string = 禁用原因（tooltip）
  checked?: boolean            // 勾选态
  submenu?: ContextMenuItem[] | (() => ContextMenuItem[])  // 懒构建
  onSelect?: () => void        // 点击执行；有 submenu 时忽略
}
export type ContextMenuEntry = ContextMenuItem | { separator: true; id?: string }
export interface ContextMenuHandlerArgs {
  event: MouseEvent
  zoneId: string
  target: Element
}
export type ContextMenuZoneHandler = (args: ContextMenuHandlerArgs) => ContextMenuEntry[] | null
export interface ContextMenuService {
  register(zoneId: string, handler: ContextMenuZoneHandler, options?: { order?: number }): () => void
  open(zoneId: string, x: number, y: number, context?: Partial<ContextMenuHandlerArgs>): boolean
}
```

### 3.2 区域清单（zoneId）

| zoneId | 归属插件 | 触发位置 |
|---|---|---|
| `explorer.tree` | data-ops-explorer | 左栏目录树（快速访问/驱动器/收藏分组/收藏项） |
| `explorer.breadcrumb` | data-ops-explorer | 工具栏面包屑 |
| `explorer.workspace` | explorer + file-actions | 文件工作区（条目 / 空白处） |
| `explorer.inspector` | data-ops-explorer | 右栏属性检查器 |
| `explorer.status` | data-ops-explorer | 状态栏左段 |
| `annotations.tags` | data-ops-annotations | 标签页标签树 |
| `insights.analytics` | data-ops-explorer-insights | 统计悬浮面板 |
| `insights.basket` | 同上 | 暂存篮卡片 / 空白 |
| `versions.panel` | data-ops-explorer-versions | 版本卡 / 分支行 |
| `notes.list` / `notes.tabs` / `notes.editor` | note-ops-markdown | 笔记列表 / 最近页签 / 编辑区 |
| `clipboard.panel` | data-ops-clipboard | 剪贴板历史 / 分组 |
| `launcher.panel` / `launcher.category` | system-basic-launcher | 程序卡 / 分类行 |
| `search.results` | data-ops-search-ui | 搜索结果行 |
| `resources.panel` | data-ops-resource-library | 资源库卡片 |
| `workcrate.projects` / `workcrate.pages` / `workcrate.thumbs` | project-ops-workcrate | 工程 / 页面卡 / 缩略图 |
| `debug.rows` / `debug.status` | system-basic-debug-console | 日志行 / 状态栏右段 |
| `canvas.board` | canvas-ops-whiteboard | 画布（节点 / 空白） |
| `settings.panel` | system-basic-settings | 存储占用行 |
| `ui.panel` | system-provider-ui-kit | 悬浮面板标题栏 |
| `shell.top` / `shell.activity` / `shell.tabs` | system-basic-shell | 顶栏 / 活动栏 / 侧栏页签栏 |

### 3.3 实体定位约定

区域容器打 `data-context-zone`；区内实体元素按需打数据属性（如 `[data-entry-path]`、`[data-tag-id]`、`[data-version-id]`）。handler 内用 `event.target.closest('[data-…]')` 解析目标，不依赖 React 事件。

## 4. 各位置右键菜单明细

图例：⚠=danger 红色项；☑=勾选项；▶=子菜单；`…`=弹出输入对话框（ui.prompt）。

### 4.1 全局兜底（引擎内置，任何位置）

**可编辑元素**（input / textarea / contenteditable）：
剪切、复制、粘贴、全选（execCommand + navigator.clipboard，禁用态按选区/剪贴板自动判断）。

**其余未声明区域**：
命令面板 `Ctrl+K`、打开设置 `Ctrl+,`、切换主题 `Ctrl+Shift+L`、切换禅模式 `F11`、重置布局 `Ctrl+Alt+R`。— 全部经 `commands.run` 执行。

### 4.2 顶栏（`shell.top`，system-basic-shell）

| 菜单项 | 执行 |
|---|---|
| 命令面板 `Ctrl+K` | commands.run system.open-launcher? 否 → `system.open-command-palette`（若缺则 commands.list 查 id，实现期确认） |
| 打开设置 `Ctrl+,` | `system.open-settings` |
| 切换主题 `Ctrl+Shift+L` | `system.toggle-theme` |
| 切换左/右侧栏/底部坞 | 对应 ui.* 命令 |
| 重置布局 `Ctrl+Alt+R` | 对应布局命令 |
| 禅模式 `F11` | 对应命令 |

### 4.3 活动栏（`shell.activity`，system-basic-shell）

切换此面板（原点击行为）、收起/展开左栏、打开命令面板。

### 4.4 侧栏/底部页签栏（`shell.tabs`，system-basic-shell）

切换到此页签、收起侧栏（左/右）或切换底部坞、重置布局。

### 4.5 悬浮面板标题栏（`ui.panel`，system-provider-ui-kit）

关闭面板 `Esc`、复制面板标题。标题栏同时提供统一的关闭按钮定位钩子（`data-panel-close`）。

### 4.6 资源管理器 · 目录树（`explorer.tree`，explorer + file-actions）

| 实体 | 菜单项 |
|---|---|
| 快速访问项 | 打开、在文件管理器中定位、复制路径 |
| 驱动器 | 打开、复制路径、▶ 网络盘：显示/隐藏（勾选态） |
| 收藏项 | 打开、▶ 编辑书签…（名称/路径）、移除此书签、复制路径、在文件管理器中定位 |
| 收藏分组 | ▶ 将选中文本夹加入此组（无选中则禁用）、重命名…、删除分组⚠、展开/折叠 |
| 树空白 | 刷新驱动器、▶ 网络盘显示开关、新建收藏分组… |

### 4.7 资源管理器 · 面包屑（`explorer.breadcrumb`，explorer）

跳转到此目录（原点击）、复制路径、在文件管理器中定位、返回上一级。

### 4.8 资源管理器 · 文件工作区（`explorer.workspace`）— 核心

**右键条目**（先做选中修正）：

| 顺序 | 来源 | 菜单项 |
|---|---|---|
| 10 | explorer | 打开 / 进入文件夹、在系统中打开、在文件管理器中定位、复制路径、复制文件名 |
| 12 | explorer | 收藏（☑）、▶ 评分 1–5、▶ 标签（现有标签☑切换 + 新建标签…）、加入暂存篮（basket 可用时） |
| 20 | file-actions | ▶ 文件操作：复制文件…、移动文件…、重命名…、移到回收站…⚠（多选时按多选集合执行）、按住拖到其他应用 |

**右键空白处**：

| 顺序 | 来源 | 菜单项 |
|---|---|---|
| 10 | explorer | 刷新、全选、清除筛选（有筛选时）、▶ 视图：列表/卡片/画廊（☑）、▶ 排序：名称/修改时间/大小/类型（☑） |
| 20 | file-actions | 粘贴（应用内剪贴板，空则禁用注明）、新建文件夹… |

应用内复制/剪切状态保存在 file-actions 插件内存；粘贴 → 以当前目录为目标走既有 `file.copy` / `file.move` 审批流。所有文件操作经 `commands.run('file.*')` → 人工批准弹窗 → 执行（与现状一致，仅入口变多）。

### 4.9 资源管理器 · 检查器 / 状态栏（`explorer.inspector` / `explorer.status`）

检查器（对选中项）：打开、定位、复制路径/名称、收藏、▶ 评分、▶ 标签、加入暂存篮、导出目录清单。
状态栏左段：清除选择（有选中）、清除筛选（有筛选）、刷新、复制当前路径。

### 4.10 标签页（`annotations.tags`，data-ops-annotations）

| 实体 | 菜单项 |
|---|---|
| 标签行 | 应用到所选 / 从所选移除（有选中时）、▶ 添加子标签…、重命名…、▶ 合并到…（同层候选）、删除⚠、查看标签聚合 |
| 空白 | 新建根标签… |

### 4.11 统计面板 / 暂存篮（`insights.analytics` / `insights.basket`）

统计：打开目录、复制目录路径。
暂存篮卡片：定位文件、打开、复制路径、移出暂存；空白/头部：复制全部路径、清空暂存篮⚠。

### 4.12 版本历史（`versions.panel`，data-ops-explorer-versions）

版本卡：恢复此版本（confirm）、复制版本说明；分支行：切换分支、合并到当前、归档分支；空白：刷新版本状态、同步版本信息、新建分支…。

### 4.13 笔记（`notes.list` / `notes.tabs` / `notes.editor`，note-ops-markdown）

| 位置 | 菜单项 |
|---|---|
| 笔记列表项 | 打开、▶ 导出：Markdown / HTML、保存版本快照…、归档 / 恢复、在文件管理器中定位、复制路径 |
| 列表空白 | ▶ 新建笔记：空白 / 会议 / 项目 / 每日 |
| 最近页签 | 切换到此笔记、关闭页签 |
| 编辑区 | 复制所选文本（有选区）、全选、查找替换、切换源码/所见即所得（☑）、阅读模式、插入资源；命中链接时前置：打开链接、复制链接地址 |

### 4.14 剪贴板工作台（`clipboard.panel`，data-ops-clipboard）

历史项：写回剪贴板、复制文本、编辑草稿、收藏（☑）、删除此条⚠；分组行：重命名…、删除分组⚠；空白：新建分组…、清空历史⚠。

### 4.15 启动台（`launcher.panel` / `launcher.category`，system-basic-launcher）

程序卡：启动、打开文件位置、复制路径、▶ 分配到分类（现有分类）；分类行：重命名…、删除⚠；空白：重新扫描。

### 4.16 全局搜索（`search.results`，data-ops-search-ui）

结果行：定位、打开、复制路径、加入暂存篮（basket 可用时）、收藏（☑）。

### 4.17 资源库（`resources.panel`，data-ops-resource-library）

资源卡：预览、在系统中显示、复制路径、复制资源链接、取消登记⚠。

### 4.18 WorkCrate（`workcrate.projects` / `workcrate.pages` / `workcrate.thumbs`）

工程卡：打开页面管理、打开工程文件夹、复制路径、删除工程⚠（confirm）；页面卡：编辑页面、加入导出选择（☑）、导出选中图片；页面管理空白：新增画板、快速创建、同步。

### 4.19 调试台（`debug.rows` / `debug.status`，system-basic-debug-console）

日志行：复制内容、展开/收起、仅看此类别；状态栏右段：打开调试台、清空日志⚠；面板空白：复制全部、导出、清空⚠。

### 4.20 设置（`settings.panel`，system-basic-settings）

存储占用行：打开所在位置。

### 4.21 白板画布（`canvas.board`，canvas-ops-whiteboard）

**命中节点**（优先右击节点；否则用当前选中集）：

编辑文本（text/note）、裁剪（image）、复制、创建副本、粘贴、删除⚠、锁定/解锁（☑）、▶ 层级：置顶/置底、▶ 组合：组合/取消组合、▶ 分区：收进新分区/移出分区、▶ 变换：旋转 90°/水平翻转/垂直翻转、▶ 排列：网格/横向/纵向、等距分布（横/纵）——全部经 `canvas` 服务 command API；命中 Eagle 资源时前置：在 Eagle 中定位、刷新 Eagle 信息。

**空白画布**：粘贴、▶ 添加：矩形/圆形/直线/箭头/文本/便签/分区、导入文件…、粘贴图片、全选、缩放适应、保存视图书签…、▶ 背景：点阵/网格/无（☑）、吸附（☑）、标尺（☑）、▶ 导出：PNG / JPEG、搜索节点、删除画板⚠。

## 5. 交互规范（引擎统一实现）

- **定位**：菜单出现于光标处，超界自动翻转/夹紧；高度超出视口时内部滚动；子菜单贴右侧展开、超界翻左。
- **键盘**：↑↓ 移动、→ 展开子菜单、← 收起、Enter 触发、Esc 逐级关闭、Home/End 跳转。
- **关闭**：点击外部 / 滚动 / 窗口失焦 / 尺寸变化 / 打开新菜单。
- **样式**：跟随 `--ds-*` 令牌与深色模式；danger 红色、disabled 降透明并给原因 tooltip、checked 打勾、shortcut 右对齐灰色。
- **右键选中修正**：仅资源管理器工作区（explorer handler 内实现）；`selection` 服务扩展可选 `selectPaths(paths, additive?)`。

## 6. 依赖改动清单

| 改动 | 说明 |
|---|---|
| `workbench/types.ts` | 新增 ContextMenu 数据模型；`SelectionService` 增可选 `selectPaths`；`UiKit` 增 `prompt()` |
| ui-kit | `prompt()` 对话框原语 + 悬浮面板标题栏 zone；替换其自身相关调用 |
| 新插件 `system-provider-context-menu` | 引擎 + 兜底菜单 + 调试通道；PORTS×2 |
| 主进程 `system-basic-dev-lab` | MCP 工具 `dev_open_context_menu`（广播 `dev:context-menu`，仅验收用） |
| 16 个既有插件 | 打 zone/data 属性 + 注册 handler + PORTS 增补（见 §3.2 清单） |
| `data-ops-file-actions` | 删除自带菜单监听/渲染，迁移为 zone handler；`window.prompt` → `ui.prompt` |
| 各处 `window.prompt` 调用点 | 迁移到 `ui.prompt`（clipboard 分组、annotations 标签、launcher 分类、versions 分支、explorer 工作区名） |

## 7. 验收方案

1. `npm run guard` + `npm run typecheck` + `npx electron-vite build`（不触发 Rust 编译）。
2. `node scripts/verify/launch.mjs --access full`（隔离 profile）。
3. MCP `dev_open_context_menu` 逐区域打开菜单（可用 `selector` 指定卡片级目标元素模拟在条目上右键）→ `capture_window` 截图；`evaluate.mjs` 只读断言（菜单存在、关键项文案、禁用态）。
4. `node scripts/verify/errors.mjs` 确认无渲染异常。
5. 新脚本登记进 `docs/VERIFY.md`；PORTS 文档随接口变更同步。

## 8. 已知取舍

- 菜单为自绘 HTML（与全应用无 radix/floating-ui 的现状一致），不做系统原生菜单。
- 底部坞（bottom.*）当前无插件使用，兜底菜单覆盖；出现插件后再按模式接入。
- `window.confirm` 在 Electron 可用，既有 confirm 调用点保持不动（仅新增入口走 ui.prompt）。
- 标签"合并到"从数字输入改为候选子菜单，顺带修复原 `window.prompt` 编号交互。
