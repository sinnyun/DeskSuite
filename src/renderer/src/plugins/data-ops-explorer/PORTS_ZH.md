# PORTS — data-ops-explorer（渲染层插件）

实现文件浏览器界面：目录树侧栏、工具栏、列表 / 卡片 / 画廊 / 分组视图、属性检查器、状态栏摘要，以及独立的 1 / 2 / 4 栏工作区。

## 元数据

| 字段 | 值 |
| --- | --- |
| 类型 | 渲染层插件 |
| 域 | `data` |
| 子类 | `ops` |
| 名称 | `explorer` |
| 入口 | `index.tsx` |
| 主进程能力 | `data-ops-filesystem` |

## 槽位贡献

| 槽位 | 贡献 id | 内容 |
| --- | --- | --- |
| `sidebar.activity` | `explorer.activity` | 活动栏文件按钮（展开 / 折叠左侧栏） |
| `sidebar.left.tabs` | `files` | 标签「资源管理」 |
| `sidebar.left.content` | `files` | `FileTree`：快速访问、驱动器、自定义快速收藏分组 |
| `workspace.toolbar` | `explorer.toolbar` | 第一行：统一路径导航（后退/前进/上一级/刷新/打开目录、面包屑、当前目录筛选、暂存）；第二行：工作区/窗格、筛选、排序和当前视图操作。全局索引搜索入口位于 `top.actions`。可选插件 `data-ops-explorer-grouped` 将分组切换和分组设置嵌入第二行。 |
| `workspace.views` | `explorer.views` | `FileWorkspace`：按 `viewMode` 渲染列表 / 卡片 / 画廊 / 分组 |
| `sidebar.right.tabs` | `inspector` | 标签「属性信息」 |
| `sidebar.right.content` | `inspector` | `Inspector`：多选摘要、元数据编辑、文本/图片/音视频预览、操作按钮 |
| `statusbar.left` | `explorer.status` | 路径、文件夹/文件数量、选中数量、焦点项、筛选数量、总大小、虚拟滚动提示 |

## 服务

提供（渲染层服务注册表）：

- `selection` — `{ getSnapshot(), subscribe() }`；快照 `{ path, entries, selected }`，表示活动栏的目录与选中项。
- `panes` — 快照/订阅，以及 `getActiveStore()`、`setActivePane(id)`、`setLayout(1|2|4)`、`activateWorkspace(id)`、`createWorkspace(name)`、`initialize()`、`showTagAggregate({ tagId, name })`、`clearTagFocus()`；提供工作区布局、窗格状态、活动栏与工作区目录。`showTagAggregate` 会把活动窗格切换为标签聚合虚拟列表（含子孙标签的全部文件，跨目录）；任何目录导航都会退出该模式。

消费：

- `ui`（必需）—— `system-provider-ui-kit` 提供的 UI 原语。
- `basket`（可选）—— 由 `data-ops-explorer-insights` 提供；存在时才显示「暂存」按钮。

## 交互

- 多选：`Ctrl`/`Meta` 点击切换、`Shift` 点击范围选择、单击替换；`FileTree` 高亮当前目录。
- 元数据：收藏、1–5 星评分、自由标签；按路径持久化，自动清理空记录。
- 筛选/排序：类型、标签、最低评分、仅收藏、搜索；排序字段 `name` / `modifiedAt` / `size` / `kind` / `rating`，升降序切换。
- 画廊：50%–200% 缩放（图片缩放、文本宽度/字号）、视频/音频播放、底部胶片条（最多 80 项）。
- 分组视图由可选插件 `data-ops-explorer-grouped` 提供；工具栏支持类型、修改时间（分钟）、评分和所在文件夹分组，保持组内当前顺序并可递归汇总子文件夹。
- 检查器：多选摘要、收藏/评分/标签编辑、带行号文本预览（上限 400 行）、音视频播放、导出清单 JSON。

## 使用的主进程 IPC

| 服务 | 方法 | 用途 |
| --- | --- | --- |
| `filesystem` | `drives` / `quickAccess` | 快捷入口与磁盘容量 |
| `filesystem` | `listDir` | 目录列表（懒加载文件夹树同用） |
| `filesystem` | `listMore` | 追加下一页 200 项，保留选择和滚动状态 |
| `filesystem` | `statPaths` | 对 `fs:changed` 报告的变更路径取元数据，用于增量更新行 |
| `filesystem` | `readText` | 检查器文本预览 |
| `filesystem` | `readImage` | 检查器原图预览 |
| `thumbnails` | `get(path, 320)` | 延迟加载的 240px JPEG 画廊/胶片条缩略图，由主进程有界缓存及渲染层缓存提供；渲染层最多 60 项 / 3.5 MB |
| `filesystem` | `readMedia` | 音频/视频预览（上限 64MB，返回 data URL） |
| `fileOps` | `saveText` / `approve` / `execute` | 通过计划与批准流程导出目录清单 JSON |
| `fileOps` | `startDrag` | 为 list/grid/gallery 文件项与当前选中项发起原生系统拖拽 |
| `filesystem` | `open` / `reveal` / `pickDirectory` | 系统打开、在文件夹中定位、选择目录 |
| `clipboard` | `writeText` | 复制完整路径 / 文本内容 |
| `session` | `get` / `set(patch, paneId?)` | 恢复并镜像活动栏会话快照 |
| `workspaces` | `list` / `create` / `setLayout` / `setPane` / `activate` | 恢复、新建、切换、调整布局并保存工作区与窗格状态 |
| `watch` | `setPaneDirectories` / `clearPane` | 监听各窗格当前与展开目录；标签聚合模式下监听聚合条目所在的各父目录，全局最多 16 个 |

消费 `fs:changed` bridge 事件。当前目录内的变更采用增量更新：只重新 stat 变更路径，更新已有行、追加新增条目、移除已删除条目，并保留选择与滚动位置；标签聚合视图对已在聚合列表内的路径执行同样的增量更新，目录内未打标签的文件变更会被忽略。仅当 `invalidate` 为 true（单批超过 200 条变更）时整表重载。

## 渲染层存储

- 窗格路径、视图、筛选、排序、选择、焦点、滚动锚点、窗格宽度、展开目录与标签聚合焦点（`{ tagId, name }`）由 `workspaces` 持久化；活动栏状态同时镜像到 `session`，恢复标签焦点时直接重新打开聚合视图而非目录。
- `desksuite.explorer.thumbnails` 仅缓存有界 JPEG data URL（最多 60 项 / 3.5 MB）供画廊渲染；源文件和元数据仍由主进程服务持有。
- 旧键 `desksuite.explorer.meta` 通过 annotations IPC 导入；仅导入成功后删除。当前注释数据由 `data-ops-annotations` 管理。

## 日志

日志通道前缀 `Explorer`（生命周期、目录切换、错误、加入暂存篮）。

## 自定义快速收藏

原“当前目录”子目录树替换为 QuickBookmarks 分组，保留快速访问和驱动器。支持新建、重命名、确认删除分组，折叠分组、通过每组 ＋ 批量收藏中间活动窗格选中的文件夹，编辑收藏名称及绝对路径、移除收藏、点击地址跳转。未选文件夹时禁用 ＋；混合选择仅加入文件夹。同组去重，错误内联显示，长路径省略并提供完整悬浮提示。删除操作仅影响收藏引用。

消费 quickBookmarks 的 act / complete IPC，以及 quickBookmarks:changed / quickBookmarks:explorer 事件。setup 安装 MCP 请求监听并在卸载时清理；MCP 和界面复用添加所选文件夹及打开收藏函数。主进程 data-ops-quick-bookmarks 用 Store 持久化，不新增 localStorage 键。

## 网络驱动盘开关

驱动器标题右侧增加网络图标切换按钮（aria-pressed 和中文提示），默认显示全部驱动器，关闭后只隐藏 isNetwork 网络盘条目。网络盘使用网络图标。读取 filesystem.getDrivePreferences、写入 filesystem.setDrivePreferences，监听 filesystem:drivePreferences 统一同步 MCP 与界面设置；重启保留。加载/保存时禁用按钮，错误内联显示。不新增 localStorage 键，不影响收藏或路径导航。


File drag / 文件拖动：list/grid/gallery 的文件项、画廊大图预览与详情面板图片预览在 `dragstart` 中调用 `fileOps.startDrag`（命中当前选择时拖出整组选中文件，否则只拖出自身，仅文件），由主进程 `webContents.startDrag` 发起原生拖拽，可直接放到资源管理器等外部应用；应用内拖放目标按原生 `Files` 接收。缩略图与预览 `<img>` 统一设置 `draggable={false}`，避免浏览器自带的图片拖拽抢占文件拖拽。目录不可拖动。


概念图样式：蓝色强调、紧凑控件、扁平属性分区、152px 定宽分组卡片，展示文件大小、评分与收藏。分组布局消费 `renderGroup(entries)` 与 `getRating(path)`，卡片实现属于资源管理器；资源管理器将 MCP `quick_bookmarks_explorer` 的 view 操作转交活动窗格。

工具栏补齐：统一 28px 高度，合并工作区文案及新建/活动窗格控件，标签筛选常驻，排序/视图/分组/范围靠右。资源管理器通过 `top.actions` 提供窗格布局控制；窄窗口将右侧显示控件整组换行。


视图组合：卡片/列表/画廊与每窗格的 `groupingEnabled` 独立并一同持久化。旧 `viewMode: grouped` 恢复为卡片＋分组开启。统一 152px FileCard 属于资源管理器，并由其向分组布局提供三种区块渲染。嵌入列表采用有限高度虚拟滚动及组内全选，画廊每窗格仅一个预览区：左侧 20%（最小 192px）为单列卡片导航，右侧 80% 为当前文件查看区；分组、折叠及递归范围只作用于左栏。MCP `quick_bookmarks_explorer` 的 view 动作接受可选 viewMode、groupingEnabled、groupBy（kind/modifiedMinute/rating/folder）、includeChildren，返回组合状态。grouped 仅为兼容旧客户端的别名。跨插件分组设置仅走渲染服务。

画廊不再写入旧的 desksuite.explorer.thumbnails 渲染层缓存；共享 FileCard 通过现有主进程缩略图服务请求缩略图。
