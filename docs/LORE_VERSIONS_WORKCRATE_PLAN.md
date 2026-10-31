# Lore 版本管理与 WorkCrate 复刻规划

> 状态：Lore 首轮实现已完成；WorkCrate 方向已按用户提供的三张参考界面和最新说明修订，当前实现正在收敛到最小化的 VectorCraft 外挂。DeskSuite 是重新开发的程序，不导入其他程序或旧版本的历史版本、Lore 仓库、版本数据库或 WorkCrate 数据。

## WorkCrate 方向修订（以此节为准）

此前本文把 WorkCrate 扩展成自有画布编辑器、对象检查器、资源投放、链接修复、重排与导出工作流，这是错误理解，相关范围不再作为目标。三张用户附件是界面参考；其中图片里的标签和说明仅作为设计内容，不覆盖用户在消息中明确的产品边界。

WorkCrate 是 VectorCraft 的外挂管理层：

1. 新建项目时选择一个项目文件夹，并在里面创建 VectorCraft 原生 `.vectorcraft` 文件；项目资料跟随该文件夹。
2. VectorCraft 原生画板就是 WorkCrate 的页面。WorkCrate 展示 CLI 同步得到的画板缩略图缓存；物料栏由 WorkCrate 插件创建、编辑并写入 VectorCraft 原生画布。
3. 项目列表、页面矩阵、画板详情按附件中的 Tier 1 / Tier 2 / Tier 3 组织。
4. WorkCrate 建立原生物料栏，并由插件表单编辑物料字段；保存时通过 CLI 写入 VectorCraft 原生画布。普通画面内容编辑、画布渲染和导出属于 VectorCraft。
5. 用户在 VectorCraft 打开并编辑普通画面内容、保存后，在 WorkCrate 同步，更新项目页面目录、缩略图缓存；同步时保留并读取 WorkCrate 写入原生文档的物料栏信息。

最小实现边界：Projects 保存工程名、原生文档绑定和最近项目索引；Boards 适配官方 VectorCraft CLI，负责创建原生文档/画板、物料栏创建与字段写入、画板/物料读取、缓存预览和外部打开；Renderer 负责项目卡片、页面卡片、预览和物料栏表单。移除 DeskSuite 自制的绘图工具、画布手势、对象检查器、资源放置与链接修复、DeskSuite 页面导出功能。

上一版 `docs/design/workcrate-concept.png` 是已过时的概念图，不代表当前 WorkCrate 目标；当前以用户附件为准。

## 1. 目标与范围

在 DeskSuite 中实现单文件 Lore 历史版本及配套版本信息存储；WorkCrate 按本文开头的方向修订实现最小 VectorCraft 外挂。

本文将“WorkCrate 插件”按完整功能族理解：核心是 `fileatlas-plugin-workcrate-projects`，并由 `workcrate-contracts`、`workcrate-boards`、`workcrate-ui`、`workcrate-export` 协作。若只复刻 Projects 而忽略 Boards/UI，得到的是工程资料箱，不是 FileAtlas 中完整的 WorkCrate 使用体验。

## 2. 参考项目的实现模型

### 2.1 Lore 版本引擎与版本信息分开

FileAtlas 的两个插件分工明确：

- **Versions**（`crates/fileatlas-plugin-versions/`）负责文件字节与 Lore 仓库：按文件创建私有 worktree 和共享对象库，提交版本、列出历史、恢复内容，以及管理分支/合并。版本内容和对象去重由 Lore 保存。
- **Version Info**（`crates/fileatlas-plugin-version-info/`）提供类型化元数据服务：标题、时间、大小、MIME、预览路径、当前版本标记、分支图与待解决合并状态。数据实际落在共享数据库的 `versions` / `version_graph` 表中，不重复保存内容。
- 该分层是新程序内部的职责拆分，不意味着要导入 FileAtlas 的数据库、Lore 仓库或历史版本。
- Versions 以 Version Info 的记录作为完整历史目录。Lore 当前分支历史只是恢复/补全依据；切换到较旧版本不能让较新的已保存版本从列表中消失。
- 保存版本前先确认文件是普通文件、稳定可读且无未处理合并；再把源文件原子复制到私有工作区，只 stage Lore 管理的 `content` 路径，提交并 flush，最后写版本元数据和预览副本。
- 恢复前检查外部源文件与 Lore 工作区状态，拒绝覆盖未保存修改；恢复通过原子替换落盘，完成后更新当前版本标记。
- 同一文件操作串行化；锁在等待者和操作退出后回收。界面被动读取在后台执行并限制并发，避免渲染期间哈希或打开 Lore。
- 分支/合并状态单独保存为图快照。冲突解决期间不把半成品写回源文件。

关键参考：[Versions PORTS](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-versions/PORTS.md)、[Version Info PORTS](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-version-info/PORTS.md)、[Versions 核心实现](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-versions/src/lib.rs)、[Version Info 服务](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-version-info/src/lib.rs)。

### 2.2 WorkCrate 是项目资料层加原生应用适配

- **Contracts** 定义项目、文件引用、预览等稳定数据结构和事件；它本身不负责 IO。
- **Projects** 保存工程名称、所选项目文件夹、原生文档关联和最近工程索引。
- **Boards** 通过官方 CLI/MCP 创建原生文档与画板、初始化物料栏、读取页面/物料数据并生成本地预览缓存。
- **UI** 按项目、页面、画板详情展示缓存与 WorkCrate 管理的物料栏表单；普通画面编辑、画布显示和导出交给 VectorCraft。

Projects 采用独立的项目 UUID。文件引用保存原始路径，不复制源文件；预览则是 WorkCrate 自己拥有的副本并记录相对路径和 SHA-256。目标程序中新建工程直接采用便携布局：项目数据放在原生文档旁的 `.workcrate/<project-id>/`，用户数据下只保留最近项目索引/定位信息。没有旧版工程目录格式需要导入；以后用户主动移动工程目录时，再校验并更新最近项目定位信息。

关键参考：[WorkCrate Projects PORTS](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-workcrate-projects/PORTS.md)、[Boards PORTS](/F:/AI/geren/pho_cordis/crates/fileatlas-plugin-workcrate-boards/PORTS.md)、[Contracts PORTS](/F:/AI/geren/pho_cordis/crates/fileatlas-workcrate-contracts/PORTS_ZH.md)。

## 2.3 DeskSuite 首轮实现状态

截至 2026-10-28，首轮实现落入独立主进程/渲染层插件，且已通过 guard、类型检查、生产构建及隔离配置下的 MCP/UI 验收。具体实现如下：

- Lore sidecar 已固定 Lore VM 与 Quinn 协议补丁版本；版本信息使用 DeskSuite 自己的 `desksuite.db`，没有导入 FileAtlas 或旧 DeskSuite 数据。
- Lore 已实现单文件版本列表、只读状态、快照、原子恢复、受控 IPC 预览、分支图及分支/合并动作；文件移动/重命名会在成功后重绑定 entity。重启后可从 Lore `revision_merged` 与冲突状态路径、分支历史重建待处理合并元数据。
- WorkCrate 首轮实现曾加入自有画布编辑器、对象检查器、素材管理与导出等超出需求的功能。最新修订已删除渲染层编辑器、画布手势验收脚本、页面导出控件和文件引用工作区，替换为用户附件对应的项目/页面/画板三级界面。
- 当前 Renderer 调用项目目录、画板缓存、预览、创建、同步和外部打开接口。主进程 Boards provider 仍留有首轮实现的编辑、对象操作和导出能力，未完成的后续清理与实机验证已在本文单独标出。
- Boards 实现画布缩放、所选对象拖动、八手柄调整、携带本地路径的文件拖放、headless→GUI 显式交接；Projects 生命周期 hook 在删除/迁移/重新关联前关闭会话，插件卸载时保存并关闭，旧绑定会由画布探测关闭。显式打开画布会对比文档 stamp 并刷新过期目录/预览；后台 headless watcher 每两分钟检查过期文档与预览，GUI 端口活跃时跳过，失败指数退避并通过 IPC 状态/事件向 UI 提供错误与重试时间。
- Boards 增加完整页面重排、按所选顺序批量 PNG/JPG 导出、原生链接缺失/修改诊断；图片默认格式持久化为 PNG。WorkCrate 面板提供页面矩阵和批量导出 UI。
- Projects 现在提供工程排序、默认排序偏好、封面缺省时使用首张本地画板预览，以及新建工程时同时创建元数据与原生文档的流程。当前主要后续项是具体 VectorCraft 绘图工具的专用交互面板。

首次启动时 DeskSuite 创建自己的空版本信息库与 Lore 存储。数据库 owner migration 只用于后续升级 DeskSuite 自己产生的 schema，不包含旧程序历史数据导入。

## 3. DeskSuite 现状与边界

DeskSuite 已具备实现所需的宿主设施：Cordis 插件自动发现、`db` 目录级迁移、原子 JSON Store、路径身份与写入策略、后台 jobs/audit、commands、MCP 注册、文件操作计划/审批/撤销，以及渲染层插件服务和槽位。文件浏览器已有标签、评分、收藏、缩略图、媒体/文本预览、目录扫描和可见目录 watcher。

因此新增能力应作为插件接入，不改 `app.ts`、preload 或宿主 workbench。主进程插件之间经 Cordis 服务注入协作；渲染插件之间经 renderer service 协作；插件不得相互文件级 import。

**关键技术差异：DeskSuite 是 TypeScript/Electron，Lore API 是 Rust crate。** DeskSuite 已采用单独构建的 Rust sidecar，以 stdio JSON-RPC 封装 Lore API，由主进程插件管理生命周期。构建产物纳入 Windows 应用打包，并由插件解析开发与生产路径；界面不拼 shell 命令，也不以普通 Git CLI 替代 Lore。

## 4. 目标插件与职责

### 4.1 单文件版本历史（已实现）

| 层 | 实际插件 | 职责 |
|---|---|---|
| 主进程元数据 | `data-provider-version-info` | 注入 `db`，注册版本表 schema 并提供类型化 `versionInfo` 服务：list/save/setCurrent/graph/putGraph。不得暴露任意 SQL。 |
| Lore 操作 | `data-ops-versions` | 管 sidecar、每文件队列、Lore worktree/store/preview 路径、快照/恢复/状态/分支操作；提供 `versions` IPC/MCP 服务。 |
| 历史界面 | `data-ops-explorer-versions` | 消费 Explorer 的 `selection` 服务，在属性检查器或固定尺寸浮层展示当前状态、历史版本、保存与恢复操作。 |

版本实体 ID 与路径关联分开存储：规范化路径映射到稳定 `entity_id`。文件操作成功移动/重命名后重绑映射；删除原文件不自动删除历史。当前路径身份以规范化绝对路径为入口，符号链接按受限路径检查处理；复制文件作为新路径实体，不复制历史。

Lore 内容放在 `<userData>/data/versions/worktrees/<entity-id>/`、`stores/<entity-id>/shared-store/`；预览放在独立的 `previews/<entity-id>/`。版本信息表由 `data-provider-version-info` 通过现有 CatalogDatabase 的 owner-scoped migration 创建，避免另开 SQLite。不要把大文件字节存入 SQLite/JSON，也不要让 Lore 接管用户文件夹作为仓库根。

当前公共接口包括：

- `versions.state(path)`、`list(path)`：只读状态和时间倒序列表。
- `create(path, title)`：显式保存当前字节为新版本。
- `restore(path, versionId)`：经过源文件状态检查、用户明确确认和 DeskSuite 写入根策略后恢复。界面调用缺少覆盖目录的可写根时，由主进程弹窗授权并持久化该目录；MCP 调用仍须预先满足写入根，不弹窗。
- 分支图与 `create/switch/archive/merge/resolve/abort` 动作已由 `versions_branch_graph` / `versions_branch_action` 暴露；恢复冲突期间不会把半成品写回源文件。

状态检测只对用户选择的文件或已打开的历史面板执行；使用内容哈希比较保存版本，并在前后检查文件 size/mtime，检测过程中变化则返回可重试错误。后台执行并使用有界并发，不在 React render 中调用 Lore。

### 4.2 配套版本信息存储（已实现）

版本元数据至少包括：

- `version_entities(entity_id, path_key, canonical_path, created_at)`
- `versions(entity_id, version_id, revision_number, parents_json, title, created_at, size_bytes, content_type, preview_relpath, is_current)`
- `version_graph(entity_id, snapshot_json, updated_at)`

新表由 `data-provider-version-info` 通过稳定 owner 和版本号管理，并在事务中执行 schema 升级；`entity_id + version_id` 唯一；每个 entity 同一时刻至多一个 current。Lore commit 成功但元数据写入失败时，服务必须能从 Lore HEAD 恢复/补记，不将已提交版本误报为不存在。Sidecar 存储与 `desksuite.db` 不应各自拥有一份权威元数据。

不实现旧 `version-info.sqlite3` 导入，不读取或复用 FileAtlas 的 Lore worktree、shared store、版本 ID 或数据库。新程序首次启动时创建自己的空版本表；版本表后续 schema 升级只处理新程序自己生成的数据。避免引入双库、双写和兼容旧应用的迁移代码。

### 4.3 WorkCrate 工程系统（最小外挂重构中）

| 层 | 实际插件 | 职责 |
|---|---|---|
| 主进程项目能力 | `project-ops-workcrate-projects` | 工程名、项目文件夹定位、原生文档绑定和最近项目索引。 |
| 主进程原生画板 | `project-provider-workcrate-boards` | 官方 VectorCraft CLI 适配、文档/画板创建、物料栏初始化、画板/物料读取、预览缓存、同步和外部打开。 |
| 渲染界面 | `project-ops-workcrate` | 项目卡片、页面矩阵、原生画板缓存预览和物料栏只读展示。 |

DeskSuite 已允许 `project` 域，无需为此新增 guard 域。Contracts 在 TypeScript 项目中改为插件内部类型和 Cordis service 类型声明；不要新增一个被多个插件相对 import 的共享目录。Projects 发布稳定的项目服务，Boards 注入 Projects；Renderer 通过 SDK 的 `getService/useSyncExternalStore` 读跨插件服务。

当前存储布局：

- 应用数据目录保存版本化的最近项目索引和便携项目定位，不存工程源文件。
- 应用 userData 下保存最近工程索引和默认工程目录；显式定位/重开便携工程使用原生文档旁的 `.workcrate/<uuid>/project.json` 保存名称快照、引用、字段预设、绑定 ID 和预览相对路径；`previews/`、`native-previews/`、`boards-cache.json` 均由插件管理。
- 引用是外部路径；删除工程只移除注册或把插件拥有的数据移入应用回收区。不得删除/移动源文件。
- 打开/迁移工程目录时先完整校验 UUID、格式版本、相对路径和冲突，再更新索引。原子写入、备份、恢复路径要统一封装在 Projects 插件内部。
- 文件管理器“添加到 WorkCrate”从当前选择调用项目 IPC；选择变化和项目变更通过 renderer service 订阅刷新，不直接互相 import。

**VectorCraft 边界**：DeskSuite 不内嵌其 renderer 或复制画布格式。WorkCrate 只调用 CLI 创建原生文件、初始化物料栏、读取已保存画板数据并生成预览缓存。编辑、画布显示、保存和导出均由 VectorCraft 自带功能完成。

## 5. 实施阶段与后续计划

1. **Lore 与版本信息底座（完成）**：独立 Rust sidecar、按文件隔离的 Lore 存储、DeskSuite 自有数据库版本表、元数据补记、路径重绑、快照/状态/恢复及分支操作。
2. **文件浏览器集成（完成）**：选中文件查看版本状态和时间线；恢复与创建通过主进程服务、作业状态和现有 MCP 权限策略执行。
3. **WorkCrate 最小外挂（进行中）**：选择文件夹后创建原生 `.vectorcraft` 文档；以 VectorCraft 画板作为页面；WorkCrate 创建和维护物料栏并通过 CLI 写入原生文档；在 VectorCraft 打开编辑普通画面，保存后显式同步刷新页面和预览缓存。移除自制画布编辑与导出入口。
4. **后续验证**：按隔离目录验收原生文档创建、VectorCraft 打开、外部保存后页面/物料同步，以及项目、页面矩阵和详情三种界面状态。

本轮验收运行 `npm run guard`、`npm run typecheck`、`npm run build`，并在位于 `artifacts/verify/profiles/lore-workcrate` 的隔离配置中通过 DeskSuite MCP 与实际界面检查。验证脚本与截图记录在 `docs/VERIFY.md`。旧程序历史版本与工程数据导入不属于产品需求和实施范围。

## 6. 主要风险与后续决策点

- **Lore-Rust 到 Electron 的桥接和分发**已通过 Rust sidecar 与 Windows 构建流程实现；后续重点是不同打包位置、sidecar 崩溃和并发请求的专项长期验收。
- **路径身份**会决定移动/重命名后历史是否连续。推荐稳定 entity ID 加路径映射，并将 FileOps 作为必须的联动改造点。
- **恢复是实际覆写用户文件**；必须处理未保存修改、并发改写、writeRoots、审批取消、原子替换失败和索引刷新。
- **分支/合并复杂度高于时间线快照**；先落地可靠的线性版本与恢复，随后再完整实现图状态、冲突与恢复。
- **WorkCrate 的便携工程数据会跨目录迁移**；必须限制可接受相对路径、拒绝覆盖目标、校验副本后再发布索引，且不能把引用原件混入项目复制/删除操作。
- **VectorCraft 是外部程序，不是 DeskSuite 的 UI 组件**；只有明确需要原生画布协作时才排入 Boards 阶段，所有写操作由官方接口完成。

## 7. UI 参考与实现映射

界面按用户消息中的三张 Tier 1 / Tier 2 / Tier 3 参考截图实现，图片不作为运行时背景或产品素材。

| 插件界面 | 概念图 | 实现对应 |
|---|---|---|
| Lore 版本历史 | [lore-versions-concept.png](design/lore-versions-concept.png) | 文件状态、保存版本、按时间排列的快照、分支图，以及可安全继续或解除的中断恢复提示。 |
| WorkCrate 工程与画板 | 用户消息中的三张 Tier 1 / Tier 2 / Tier 3 截图 | Tier 1 工程卡片；Tier 2 原生画板矩阵；Tier 3 VectorCraft 预览与 WorkCrate 物料栏表单。普通画面绘制和导出由 VectorCraft 负责。 |

## 8. 验收结果与未覆盖范围

- 构建检查：`npm run guard`、`npm run typecheck`、`npm run build` 全部通过；Lore bridge 的 release 构建成功。
- Lore MCP：隔离样本已创建多个版本；状态查询能区分未版本、已保存及修改状态；实测恢复回到版本 1 内容后，再创建一个当前版本。历史列表和 Explorer 版本面板显示 3 个版本及当前标记、main 分支。
- WorkCrate MCP：隔离工程可创建、添加文件引用、读取引用并显示 `available: true`、编辑引用显示信息、移除引用和删除工程。删除返回值曾导致无效 MCP 响应，现已修正为合法 `null` 并再次实测；删除工程后引用源样本仍存在且内容未变。
- Lore 概念图 `docs/design/lore-versions-concept.png` 和 Lore 实机截图 `artifacts/verify/lore-versions-ui-current.png` 仍适用。旧 WorkCrate 概念图与旧 WorkCrate 截图对应已废弃的自制编辑界面，不代表当前方案。
- 既有功能截图：`artifacts/verify/lore-versions-current.png` 显示 Lore 时间线；`artifacts/verify/workcrate-current.png` 显示工程及引用。
- 最新 UI 重构已通过 `npm run guard` 和 `npm run typecheck`；WorkCrate 新界面的 build、MCP、截图和 VectorCraft 外部保存同步验收尚待完成。
- 按最小外挂重构后的 WorkCrate 创建、打开、同步实机/MCP 验证尚待完成。provider 仍保留未被当前 UI 调用的旧 CLI 编辑/导出实现和 MCP 注册，需后续清理。
- 未覆盖仍包括 VectorCraft GUI/headless 并发、sidecar 异常退出恢复、Boards 后台 watcher 故障重试的长时间与故障注入回归，以及当前最小外挂链路的端到端实机验收。旧应用历史数据导入与迁移不在范围内。
