# system-basic-session

- 域 / 子类 / 名称：`system` / `basic` / `session`
- 入口：`index.ts`
- 注入服务：`ipc`、`store`
- 持久化：版本 1 的 `session.json` 与 `workspaces.json`，通过原子 store 注册。写入采用 500ms 防抖；有序关闭或需要立即落盘时可调用 `flush`。

## IPC 服务

### `session`

- `get()` 返回当前会话快照。
- `set(patch, paneId?)` 合并并校验会话字段及滚动锚点/栏宽子字段，然后安排持久化。传入窗格 ID 时更新活动工作区的指定栏并镜像到 `session.json`；未传时为兼容旧调用更新第一栏。
- `reset()` 将活动栏恢复默认值，并同步镜像到 `session.json`。
- `flush()` 立即写入待保存的会话与工作区快照。

会话字段包括当前路径、视图模式、排序字段/方向、搜索及类型/标签/收藏/评分筛选、选中/焦点路径、滚动锚点路径与偏移、左右底栏尺寸和展开目录。

### `workspaces`

- `list()` 返回 `{ activeId, activePaneId, items }`；`get(id)` 与 `active()` 读取单个工作区。
- `create(name, layout?)`、`rename(id, name)`、`setLayout(id, layout)`、`setPane(id, paneId, state)`、`activate(id, paneId?)`、`remove(id)` 管理工作区。
- `setPane` 更新活动栏时会同步镜像到 `session.json`。切换工作区或栏位会同时更新活动工作区与活动栏 ID。
- 可见布局仅允许 1、2 或 4 栏。每栏保存完整会话快照；缩小可见栏数时保留隐藏栏位的数据，恢复更大布局时继续恢复其会话。
- `flush()` 立即写入待保存快照。

所有字段由主进程 Zod 校验后才进入内存或 store。删除当前工作区时自动选中剩余列表首项；删除最后一个工作区时清空活动工作区并重置当前会话。渲染层负责收集界面状态并通过这些 IPC 服务恢复状态。


视图组合：卡片/列表/画廊与每窗格的 `groupingEnabled` 独立并一同持久化。旧 `viewMode: grouped` 恢复为卡片＋分组开启。统一 152px FileCard 属于资源管理器，并由其向分组布局提供三种区块渲染。嵌入列表采用有限高度虚拟滚动及组内全选，画廊每窗格仅一个预览区：左侧 20%（最小 192px）为单列卡片导航，右侧 80% 为当前文件查看区；分组、折叠及递归范围只作用于左栏。MCP `quick_bookmarks_explorer` 的 view 动作接受可选 viewMode、groupingEnabled、groupBy（kind/modifiedMinute/rating/folder）、includeChildren，返回组合状态。grouped 仅为兼容旧客户端的别名。跨插件分组设置仅走渲染服务。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
