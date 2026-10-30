# PORTS — project-ops-workcrate

管理 VectorCraft 工程，并展示原生画板的本地缓存预览和物料数据的渲染层外挂。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `project` / `ops` / `workcrate` |
| 入口 | `index.tsx` |
| 主进程服务 | `workcrateProjects`、`workcrateBoards` |

## 槽位贡献

- `sidebar.activity`：打开 WorkCrate 浮动面板。
- `floating.panels`：工程仓库、原生画板矩阵、缓存画板预览和只读物料栏。

## 当前流程

1. 新建工程时选择目标文件夹。WorkCrate 通过 VectorCraft 官方 CLI 在其中创建 `.vectorcraft` 原生文档，并在旁边保存自己的工程元数据。
2. VectorCraft 的每个画板就是 WorkCrate 的一个页面。页面矩阵展示本地缓存预览和从原生文档读取的物料字段。
3. 画面内容的编辑和导出由 VectorCraft 完成。用户可在 WorkCrate 物料栏编辑物料字段并保存，插件通过官方 CLI 写入原生文档；VectorCraft 编辑画面并保存后，点击“同步”刷新页面目录、预览缓存和物料数据。
4. 新建文档或新画板时，WorkCrate 适配器会在原生画布建立物料栏；物料栏字段由插件编辑并通过 CLI 更新到 VectorCraft 文档。

## 消费 IPC

- Projects：`list(includeArchived?)`、`get(projectId)`、`create(name)`、`delete(projectId)`、`relocateProject({projectId,directory})`、`getDocumentPath(projectId)`。
- Boards：`boardCatalog(projectId)`、`preview(projectId,boardId)`、`createProjectDocument({projectId,directory})`、`createPage(projectId)`、`refresh(projectId)`、`openInVectorCraft(projectId)`、`openProjectFolder(projectId)`。
- 事件：监听 `workcrate:boards-changed`、`workcrateProjects:changed` 并更新当前界面数据；收到 MCP 请求广播的 `workcrate:panel-open` 时打开浮动面板。

## 边界

- 文档、画布显示、编辑和导出由 VectorCraft 负责。WorkCrate 界面不提供绘图工具、画布手势、对象检查器；页面批量导出通过原生适配器执行。
- 原生画板预览是本地缓存。VectorCraft 未保存的改动不会显示；在 VectorCraft 保存后使用“同步”更新。
- WorkCrate 物料栏是插件支持的编辑范围；字段变更由 Boards 适配器通过官方 CLI 写入原生文档。画面内容编辑仍在 VectorCraft 中完成。
- 渲染层仅通过 SDK 调用 `window.bridge`，不 import Electron 或其他插件。
- 不导入旧程序的项目、文档或版本数据。

## 刷新与页面导航

页签为“项目管理 / 页面管理 / 页面编辑”。画板变化事件只更新数据与预览，保持当前视图和选中画板；相同 ID 的缩略图也会重新读取。页面编辑工具栏支持新增画板，左侧缩略图支持拖动排序；放下时把完整画板 ID 列表交给 `workcrateBoards.reorderPages` 保存原生顺序。`workcrate:sync-error` 显示错误但不跳转。`workcrate:panel-open` 支持可选 projectId/boardId，供 MCP 导航。

## 基础信息界面

`BasicInformation.tsx` 通过宿主 UI 服务提供基础信息编辑器和输入/下拉框组合。“程序默认信息”包含“程序连接”和“基础信息”分页；基础信息每行一个选项，支持增加和删除自定义字段。五个主物料输入框旁均有选填下拉框；扩展参数名称可选自定义字段名称，对应内容下拉框展示该字段的选项。选择后填入草稿，保存物料栏时才写入原生文档，仍可自由输入。

通过 Projects IPC `getProgramPresets/saveProgramPresets/effectivePresets` 读写基础信息，监听 `workcrateProjects:changed` 更新选项。仅在活动画板/物料实际变化时重置物料草稿，预览更新不会清掉输入。成功、进度和错误提示统一位于面板底部；内容独立滚动。

收到 `workcrate:sync-recovered` 时清除对应工程的过期自动同步错误，不改变当前页面。

## 页面管理选择与导出

`PageManager.tsx` 管理页面卡片的单选/多选、Ctrl/Meta 切换、Shift 连选、全选与取消。刷新按画板 ID 保留选择，切换工程清空选择；选择卡片与“编辑页面”入口分开。消费 `workcrate:pages-selection` 实现 MCP 页面选择，不改变原生编辑器中的对象选择。

工具栏提供选中页面图片、全部图片、全部 PDF；图片支持 PNG/JPG、1×/2×/4×。用户通过 Filesystem IPC 选择输出文件夹，再调用 Boards IPC `exportBoards`，文件路径和原生导出警告显示在底部通知栏。未选中页面时禁用选中导出；UI 操作期间禁用控件。调用 VectorCraft 自带的画板导出器，卡片预览不用于导出文件。


## 快速创建视图

内部组件 `QuickCreate.tsx` 由项目创建后的页面管理“快速创建”入口打开。支持 Excel/WPS 粘贴、CSV 解析、表格逐格编辑、增删行、有效行数预览和复用初始画板。仅通过 bridge 调用 `workcrateBoards.previewQuickCreate` 与 `quickCreate`。成功返回更新后的页面矩阵，失败保留草稿。`workcrate:panel-open` 可带 `quickCreate: true` 和解析后的 `table`，供 MCP 打开和验收。保持面板尺寸及内部滚动，文案中文。
