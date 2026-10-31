# DeskSuite 工作台插件架构

工作台由「主进程 Cordis 能力插件」与「渲染层槽位 UI 插件」两层组成。主进程负责系统能力与
IPC/MCP 契约；渲染层宿主只保留容器与状态，**所有可见界面（外壳、侧栏、工作区视图、悬浮面板、
UI 原语）都由渲染层插件贡献**。

## 令牌表（跨层契约）

| 令牌 | 位置 | 说明 |
| --- | --- | --- |
| `bridge:invoke` | preload | 渲染层唯一调用入口 `window.bridge.invoke(service, method, ...args)` |
| `bridge:event` | preload | 主进程广播入口 `window.bridge.onEvent(listener)` |
| `runtime:log` | 主进程广播 | 运行时日志条目，渲染层日志总线订阅 |
| `window:state` | 主进程广播 | 窗口状态 `{ maximized, fullscreen, focused }` |
| `filesystem` | 主进程 IPC 服务 | 分页目录读取、文本/图片/媒体预览、系统打开/定位和目录选择；不写入用户文件 |
| `fileOps` | 主进程 IPC 服务 | 唯一文件写执行器：计划、人工批准、执行、撤销与写入 |
| `annotations` | 主进程 IPC 服务 | SQLite 收藏、评分、备注和标签树 |
| `search` / `indexScan` | 主进程 IPC 服务 | 已索引文件搜索和后台目录扫描 |
| `thumbnails` | 主进程 IPC 服务 | 操作系统缩略图和固定容量磁盘缓存 |
| `session` / `workspaces` | 主进程 IPC 服务 | 会话快照与 1/2/4 栏工作区 |
| `settings` / `commands` | Cordis 服务 + IPC | 主进程 schema 设置注册、校验、持久化与命令注册表 |
| `watch` | 主进程 IPC 服务 | 仅监视当前/展开目录并广播 `fs:changed` |
| `windowControl` | 主进程 IPC 服务 | `minimize/toggleMaximize/close/reload/state` |
| `clipboard` | 主进程 IPC 服务 | 文本/图片读写、分类历史、收藏与 MCP 图片返回 |
| `launcher` | 主进程 IPC 服务 | 开始菜单/已安装应用查询、图标和启动 |
| `runtime` | 主进程 IPC 服务 | `history/clear/info` |
| `selection` | 渲染层服务 | 文件浏览器发布的选择快照，供统计/暂存篮消费 |
| `basket` | 渲染层服务 | 暂存篮数据与订阅，供文件浏览器消费 |
| `ui` | 渲染层服务 | `system-provider-ui-kit` 提供的主题化 UI 原语 |
| `pluginCatalog` | 渲染层服务 | 渲染层插件目录 + 启用/停用（`list/getSnapshot/subscribe/isEnabled/setEnabled`） |

## 目录

```
src/main/plugins/
  data-ops-filesystem/            真实文件系统读取、系统打开/定位、MCP 文件工具
  data-ops-file-operations/       计划/批准/执行/撤销唯一文件写入器
  data-provider-catalog/          SQLite 单连接、迁移与文件/标注基础表
  data-ops-annotations/            路径收藏/评分/备注与标签树、MCP
  data-ops-watch/                  受限目录监视与变化广播
  data-ops-index-scan/             取消安全的目录索引扫描
  data-ops-search/                 SQLite 索引与标注搜索
  data-provider-thumbnails/        系统缩略图、LRU 缓存
  system-provider-settings/        Zod schema 注册与安全持久化
  system-provider-commands/        命令注册、快捷键与 MCP 映射
  system-basic-dev-lab/            隔离虚拟目录索引和性能基准
  system-basic-session/            会话与多工作区持久化
  system-basic-launcher/           开始菜单快捷方式/已安装应用扫描、缓存与启动
  system-basic-updater/            GitHub Releases 更新源、检查、下载与用户确认安装
  canvas-ops-whiteboard-storage/   Excalidraw 场景原子 JSON 持久化
  system-basic-session/           会话与工作区文档（经 store 持久化）
  system-basic-window-controls/   无边框窗口控制（最小化/最大化/关闭 + 状态广播）
  system-basic-clipboard/         系统剪贴板读写、持久化文本/图片历史与 MCP 图片返回
  system-basic-launcher/          开始菜单快捷方式/已安装应用扫描、缓存与启动
  system-basic-updater/           GitHub Releases 更新源、检查、下载与用户确认安装
  system-basic-runtime-log/       主进程日志缓冲、MCP 调用事件、运行时信息
src/renderer/src/workbench/       渲染层宿主（只做容器与状态，不包含可视界面）
  app.tsx                         WorkbenchApp：Provider 串联 + app.root 槽渲染
  registry.ts                     自动发现 ../plugins/*/index.tsx、注册插件服务
  sdk.ts                          插件唯一可用的宿主入口（重导出 types/状态/服务/桥）
  slot-context.tsx                槽位类型分发与 SlotProvider/SlotRenderer
  services.ts                     跨插件服务注册表（重名即抛错）
  layout.tsx                      分栏尺寸/折叠/活动标签/悬浮面板状态
  theme.tsx                       深浅主题
  logs.ts                         日志总线
  bridge-api.ts                   IPC 统一调用、渲染端发送/接收记录与可复用 trace ID
  runtime.ts                      bridge 事件与主进程日志接入
  ui-kit.ts                       UI 服务契约（useUiKit）
src/renderer/src/plugins/
  system-provider-ui-kit/         提供 ui 服务：按钮/输入/卡片/胶囊/侧栏/工作区/悬浮面板
  system-basic-shell/             app.root 外壳：顶栏/活动栏/左右侧栏/工作区/底栏/状态栏/分栏/悬浮层
  system-basic-window-controls/   顶栏窗口按钮 + 拖拽区双击最大化
  system-basic-debug-console/     调试信息悬浮面板（操作/IPC/MCP/广播聚合、分类筛选、关联链路折叠与载荷查看）
  system-basic-control-center/    插件注册表（含启停）/ 运行环境 / MCP 工具清单
  data-ops-explorer/              文件浏览器（树/面包屑/工具栏/三视图/多选/收藏评分标签/属性检查器）
  data-ops-explorer-insights/     资产统计 + 暂存篮（提供 basket，消费 selection）
  data-ops-file-actions/          文件操作菜单、人工批准、进度与撤销浮层
  data-ops-annotations/            标签树页与标注编辑器
  data-ops-search-ui/              已扫描文件的全局搜索浮面板
  system-basic-settings/           MCP/外观/插件设置浮面板
  system-basic-command-palette/    Ctrl+K 命令面板与批准流程
  note-ops-markdown/               CodeMirror 编辑、安全预览、双链与笔记归档
  canvas-ops-whiteboard/            Excalidraw 白板
  data-ops-clipboard/             剪贴板工作台（文本/图片预览、写入、分类历史与收藏）
  system-basic-launcher/          应用启动台（搜索、原生图标与启动）
  system-basic-updater/           软件更新入口与浮动面板
```

## 宿主与插件边界

非画布共享状态由所有者使用 `zustand/vanilla` 创建，React 消费方用字段 selector 或浅比较订阅。插件服务仍只暴露业务动作与兼容数据快照，不暴露可任意写入的 `setState`。已迁移标注缓存（含按路径订阅）、暂存篮、分组选项、调试面板筛选、Explorer 每窗格状态与工作区窗格目录，以及宿主日志、主题、布局和插件目录。Workbench 的 `useLayout` 提供字段 selector，现有面板消费方已切换至浅比较 selector；公开的 selection 与 pluginCatalog `getSnapshot/subscribe` 仅作为 Zustand 适配层保留。Explorer 异步结果令牌、分页取消和窗格 dispose/保存刷新已补齐。Zustand 不改变主进程对持久化数据的所有权。

- 宿主 `workbench/` **不 import 任何插件文件**；`registry.ts` 只允许用
  `import.meta.glob('../plugins/*/index.tsx')` 自动发现。
- 插件**只能从 `workbench/sdk` 入口**引用宿主能力；不得直接引用 `workbench/` 内部文件。
- 插件之间禁止文件级 import；协作一律走渲染层服务注册表（`services` 字段 / `getService`）。
- 每个渲染层插件使用 `definePlugin({ id, name, version, description, author, core, contributions, services, setup })`，
  `id` 必须与文件夹名一致，文件夹必须含 `index.tsx` 与 `PORTS.md` / `PORTS_ZH.md`。
- `core: true` 的插件（外壳、UI 原语、控制中心等）在运行时不可停用；其余插件可在控制中心启停，
  停用后其槽位贡献立即消失，`setup()` 注册的 disposer 会被执行。
- 已知限制：插件停用不会回收 `services` 中已注册的渲染层服务，重新启用时不会重复注册。

## 渲染层插件启停

- 启用状态持久化在 `localStorage` 的 `desksuite.workbench.plugins`（保存**已停用**的插件 id 集合）。
- 目录快照与订阅由宿主 `pluginCatalog` 提供；控制中心消费它渲染插件卡片与启停按钮。
- 停用只影响渲染层：主进程插件与服务不受影响。

## 槽位

`app.root`、`top.actions`、`top.window_controls`、`sidebar.activity`、
`sidebar.activity.bottom`、`sidebar.left.tabs`、`sidebar.left.content`、`workspace.toolbar`、`workspace.views`、
`sidebar.right.tabs`、`sidebar.right.content`、`bottom.tabs`、`bottom.toolbar`、`bottom.content`、
`statusbar.left`、`statusbar.right`、`floating.panels`、`overlay.root`。
`overlay.root` 是宿主最后渲染的全局浮层槽位，用于右键菜单、确认弹窗等不属于固定面板的界面。

约定：

- 标签页与内容共享同一个贡献 `id`；`id` 在**同一槽位内**唯一，内容槽按当前激活 id 只渲染一个贡献。
- 贡献可使用 `label`（React 组件，接收 `{ active }`）替代静态 `title`/`icon`/`badge`，用于动态徽标。
- `sidebar.activity.bottom` 是活动栏底部固定组，适合设置/控制中心等次要入口。
- 顶栏只承载全局入口，不放业务导航；路径面包屑属于工作区工具栏（`workspace.toolbar`），由所属插件渲染。
- `floating.panels` 的每个贡献即一个悬浮面板页签，`openFloatingPanel(id)` 打开；外壳只负责
  `floating.panels` 的挂载点，面板实现属于各自插件。
- 贡献 `order` 升序排列；可只声明 `title`/`icon`（纯标签），也可挂载 `component`。
- 悬浮面板保持固定像素尺寸并在内部滚动，切换页签不得引起面板位移或尺寸跳变。
- 外壳分栏手柄提供折叠按钮（悬停出现），各侧栏折叠状态由宿主布局维护。

## 渲染层存储键

| 键 | 归属 | 内容 |
| --- | --- | --- |
| `desksuite.workbench.layout` | 宿主 | 分栏尺寸、折叠、活动标签、悬浮面板 |
| `desksuite.workbench.plugins` | 宿主 | 已停用的渲染层插件 id 集合 |
| `desksuite.theme.mode` | 宿主 | `light` / `dark` / `system` |
| `desksuite.explorer.path` | 文件浏览器 | 最近目录 |
| `desksuite.explorer.view` | 文件浏览器 | `list` / `grid` / `gallery` |
| `desksuite.explorer.meta` | 文件浏览器 | 收藏/评分/标签元数据（按绝对路径） |
| `desksuite.clipboard.history` | 剪贴板工作台 | 仅用于一次迁移；迁移后由主进程 store 持久化 |

## 实机验证

验证与调试脚本统一放在 `scripts/verify/`（launch / stop / evaluate / mcp / capture / drag / errors），
产物写入 `artifacts/verify/`，用法见 [VERIFY.md](VERIFY.md)。

## 实现状态

- [x] 渲染基础依赖（Tailwind v4 / lucide-react）与基础样式
- [x] workbench 宿主、SDK、槽位注册与插件服务注册
- [x] UI 原语插件（`system-provider-ui-kit`）与外壳插件（`system-basic-shell`）
- [x] 主进程能力插件（filesystem / window-controls / clipboard / runtime-log）
- [x] 渲染层功能插件（浏览器 / 统计暂存 / 剪贴板 / 调试控制台 / 控制中心 / 窗口按钮）
- [x] 渲染层插件运行时启停（核心插件保护、贡献过滤、生命周期、状态持久化）
- [x] 文件浏览器多选/收藏评分标签/筛选排序/画廊缩放/媒体预览/清单导出
- [x] 宿主契约扩展（活动栏底部组、动态页签标签、分栏折叠）
- [x] 守护脚本（含渲染层插件规则）与文档
- [x] 实机启动验证（MCP 截图 + JSON-RPC 工具调用 + CDP 交互/几何校验，脚本见 `scripts/verify/`）

## 能力路线

F1–F5 的实现、验证状态与后续可选 F6 见 [ROADMAP.md](ROADMAP.md)；外部参考项目的文档快照见
[reference/fileatlas/](reference/fileatlas/README.md)。
