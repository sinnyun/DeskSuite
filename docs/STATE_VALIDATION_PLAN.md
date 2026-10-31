# Zustand 状态统一与 Zod 边界校验方案

日期：2026-11-01。状态：S0–S3 完成并通过阶段验收；S4 已完成设置/偏好/Explorer 返回值等高风险边界及针对性验收；主进程 183/183 个字面量 IPC 方法均已登记方法参数 schema。全项目 JSON/外部数据入口审计与统一错误语义复核仍未完成，不能据此标记整体 Z1–Z7 全覆盖。

本文记录结合当前源码形成的选型结论、迁移清单和验收要求。Zustand 与 Zod 均已进入依赖；分阶段实施状态见第 10 节。

## 执行总览（续做前先读）

本节是当前执行状态的入口。详细设计见后续章节，批次验证证据见 [VERIFY.md](VERIFY.md)；同一批相互依赖的改动收齐并集中验收后，统一更新本节与第 10 节，避免计划、源码和验证结论混杂。

### 需求来源与范围

| 来源 | 对本任务的含义 | 当前处理原则 |
| --- | --- | --- |
| 用户请求“根据文档开发优化”，后续要求继续完成 | 按本计划持续实施，不把阅读/总结当作交付 | 继续推进直到完成项有实现和所需验收，或明确记录客观缺口 |
| 本文原始方案 | 非画布共享状态统一方向为 Zustand；用现有 Zod 补齐设置、IPC、返回值、偏好及外部数据边界 | 以本文第 1–9 节的范围、排除项和验收标准为任务基线 |
| 仓库 `AGENTS.md` 与用户提供的项目约定 | 规定插件边界、MCP、脚本、构建和阶段验收方式 | 属于开发约束，不扩大本文产品范围；冲突时遵从用户明确要求和仓库约定 |
| 原始架构建议 | 讨论进程、SQLite/FTS 等方向 | 按第 9 节逐项判断；未纳入范围的建议不顺手改成新任务 |

**范围锁定**：迁移非画布共享状态；补齐 Z1–Z7 所列运行时数据边界。画布状态/引擎/存储格式不迁移；不引入 Jotai、Valibot、Zod Mini 或第二套状态/校验系统；不把业务实现搬进 workbench。发现需要扩大范围的事项，先记入后续项，不与当前修复混做。

### 项目硬约束

- 业务实现留在所属 Cordis/渲染层插件；跨插件只走各自服务契约，遵守 `AGENTS.md` 和中英文 `PORTS` 文档。
- bridge 返回值与来自磁盘、数据库、sidecar、第三方程序的数据，按边界风险运行时解码；TypeScript 类型断言不算校验。参数校验也不等于业务不变量、权限或路径检查。
- 阶段功能验收使用 DeskSuite 自身 MCP；开发实例显式 `--access full`，使用隔离 profile，并把可写根限定在 `artifacts/verify/samples`。CDP/evaluate 仅只读 DOM/状态/几何，截图使用 MCP `capture_window`。
- 验证脚本只能放在 `scripts/verify/` 并登记到 `docs/VERIFY.md`；开发产物只用 `npx electron-vite build`，不触发 Lore Rust 编译；结束实例后运行 `stop.mjs`。
- 每个完整开发批次收齐实现与契约后统一核对 guard/typecheck/build（按改动需要）及 MCP/截图证据；不要为单个小修复重复构建，不能以静态审计或单元测试替代批次实机验收。

### 当前进度矩阵

状态说明：**完成** = 范围内实现和所需验收都有证据；**部分完成** = 有实现/验收，但仍有计划范围缺口；**未完成** = 尚无足够实现或验收证据。

| 项目 | 状态 | 已确认 | 剩余工作 |
| --- | --- | --- | --- |
| S0 清点与基线 | 完成 | 非画布 store、消费者、存储键和副作用已清点；基线明确标为迁移后基线 | 不把现有基线描述成迁移前数据 |
| S1–S3 Zustand 迁移 | 完成 | 标注、Explorer/窗格、暂存篮、分组选项、调试视图、日志、布局、主题和插件目录迁移；有阶段 MCP 验收 | 保留画布排除项与已知服务停用限制 |
| S4 / Z1 设置读取与 Z2 预校验 | 完成（已列范围） | 命名空间读取校验、损坏值恢复、只读 `settings.validate`、保存前复验及 MCP 验收 | 不宣称所有业务表单都已逐字段人工审计 |
| Z3 IPC/命令输入 | 完成（参数登记） | `ipc-schema-audit.mjs` 统计字面量主进程 IPC 方法 183/183（100%）；直接 IPC 与共享命令复用 tuple schema | 该数字不覆盖动态注册、返回值、业务不变量或权限语义 |
| Z4 返回值/事件 | 部分完成 | Explorer 图片/文本/音视频预览及版本面板 bridge 响应有本地 schema decoder；更新器返回值和 `updater:state` 事件经 Zod 后入状态；剪贴板历史返回有解码器；WorkCrate renderer 项目/画板返回值及 panel-open、boards-changed、sync-error、sync-recovered、projects-changed 均有插件本地解码，并经 full MCP 面板验收和截图确认；统一资源 provider 的 register/resolve/list/forget/read/readText 返回值通过 `callValidated`，资源 panel 的真实文本预览经 MCP 验收；标注 provider DB tree/counts/forPaths、renderer create/import/forPaths decoder 和 annotations:changed 事件校验已落实；watcher 广播及目录 IPC 输出、Explorer `fs:changed` 联合事件均有 schema decoder，MCP 新增样例后观察到界面增量更新和生产广播形状；文件操作 public plan/approval summary/saved result/undo/jobId/roots 返回及相关广播在发出前经 Zod 校验，fileOps plan/get 结构通过 MCP 回读；搜索 UI 分页结果在进入状态前检查 Zod、limit 和 offset；暂存篮 hydrate/mutation 返回通过 renderer 本地 schema，MCP 广播后界面状态已确认；快速收藏组返回与 changed 事件、窗口状态初始返回与事件、网络盘显示偏好返回/广播均有插件本地 Zod decoder，并经 MCP/CDP 验收；`system-basic-settings` 的 `storage.list` snapshot decoder 通过 MCP 打开存储页及 CDP 只读摘要检查；`AdminSettings` 的 runtime.info/mcp.getAccess snapshot decoder 经 MCP 读取并打开运行环境/MCP 管理页通过 | 文件操作 approval/job/fs-change 广播尚未做成功操作的 live 端到端验收；搜索关键词输入后的 renderer IPC 路径因禁止键鼠自动化而未实机触发；继续盘点其他插件 bridge 响应与广播 |
| Z5 UI 偏好 | 完成（已列范围） | layout/theme/plugin/font-audit 恢复 schema；配置坏值与重启行为有检查；Explorer 网络驱动器显示偏好经 MCP 隐藏/恢复、事件更新和 DOM 状态实测，脚本 finally 恢复默认值 | 新增偏好必须沿用相同恢复规则 |
| Z6 导入及外部数据 | 部分完成 | store JSON 主文件与备份按文档设 UTF-8 字节预算（默认 32 MiB、最高 512 MiB）；剪贴板历史 64 MiB、Eagle 来源索引 256 MiB；config.json 读写限制 4 MiB；WorkCrate project.json 读写限制 16 MiB。超限主 store 经 `.bak` 回退、超限 project.json 被 MCP 拒绝且列表仍可读并保持文件哈希、超限 config 安全回退均已通过隔离 MCP 验证；审计 JSONL tail 反向分块读取，累计读取上限 4 MiB/20,000 行，有纯 Node 与 S4 MCP 断言。版本信息 SQLite JSON 列有逐列与聚合预算（snapshot 8 MiB、graph 16 MiB、pending merge 2 MiB、单实体 list 50,000 行/64 MiB）；sidecar envelope/tool result 有结构校验，错误文本限 2 KiB、JSON-RPC 行限 64 MiB。新增 14 项 `src/main` 定向 JSON、SQLite、二进制流入口清单；index-scan stale 清理使用 500 行 keyset 分页且整体事务回滚，隔离 MCP 样例已覆盖跨页删除和根目录隔离；fileOps version rebind 改为每页最多 500 条路径，纯内存 SQLite helper 验收通过冲突后的继续处理与 8 条错误样本上限，但 MCP 人工审批后的成功移动链路尚未实测；白板 summary index 有 10,000 条/200 字符 title 限制与恢复/更新专项断言；thumbnail cache header/provider MCP image block 有实机检查；文件预览现用同一 `FileHandle` 做 fstat 与最多预算+1字节读取，2/12/64 MiB 超限路径经隔离 MCP 验证；剪贴板历史图片用同句柄限制 8 MiB+1，fake handle 覆盖读取期间增长；缩略图缓存启动扫描和命中读取同句柄最多 2 MiB+1；版本 JPEG 预览用 lstat/inode/fstat 身份一致校验和最多 512 KiB+1，超限/符号链接仍返回 null；runtime-log 完整条目映射为结构化可克隆值，保留 48 KiB 与深度/字段限制，fresh MCP 运行确认无新增序列化失败 | 定向清单明确不含 binary 全面审计，也排除已审 Store/config/audit、WorkCrate 和 version-info；fileOps version rebind 的应用级成功移动与历史路径回读仍待人工批准后验收；剪贴板 profile 没有既有图片历史，非空 image live 读取未覆盖；版本文件 SHA256 流和资源全文件 GET 保持流式但没有总传输字节/耗时上限，需按服务协议另行决定；VectorCraft 实际协议兼容仍无隔离原生文档 fixture |
| Z7 错误一致性 | 部分完成 | MCP/IPC 中央异常文本由共享 helper 提取、格式化 Zod 路径并限制 2,000 字符；renderer SDK `errorText()` 支持 ZodError 字段路径及受限中文文本，已用于更新器、资源、笔记、搜索、设置、调试控制台、Explorer、文件操作、标注、WorkCrate、版本、剪贴板、启动台与命令面板；插件 MCP catch 使用 `mcpErrorFrom()`；主进程 runtime-log 入口将完整日志条目映射为结构化可克隆值，保留脱敏及深度/字段/字符串/48 KiB 预算；Audit 写入及旧记录读取清理 error/results，Jobs 快照/广播清理 label/detail/error/summary；session/settings/font-audit 的三处直接 Error console 参数、版本 unavailable-source diagnostic、WorkCrate boards 同步/迁移错误广播、WorkCrate Projects 三个 MCP catch，以及 Eagle provider 外部响应错误均在主进程规范化/限长；设置页专用 formatter 最终输出也统一经 SDK `errorText()`；debug-console MCP/IPC/广播探针与 `jobs.mjs` 脱敏/预算断言均通过。 | WorkCrate boards 自动同步失败和迁移 warning 分支缺可靠 MCP 注入；Eagle 恶意外部 envelope 由生产客户端注入响应的纯 Node 验证，live 只覆盖离线错误；其他插件错误路径/中文文案仍待复核；不擅自改变公开错误协议 |
| S5 非画布共享状态复核 | 完成 | 已复核额外 `useSyncExternalStore`，剩余项属于画布范围或薄适配 | 不做机械全仓替换 |

**最近完整验证证据（2026-11-01）**：当前批次统一跑 `npm run guard`、`npm run typecheck`、`npx electron-vite build`、`git diff --check` 和 14 项持久化审计；首次类型检查发现并移除了版本插件未使用的 `readFile` import，修后 typecheck 通过。构建保留既有 `INEFFECTIVE_DYNAMIC_IMPORT` Leafer 提示。存储设置 MCP 快照解码（20 组/26 项）和版本 JPEG 预览 helper 通过同一 fresh full profile 验收：只读 `command_run` 返回 621 字节 JPEG，errors/statusbar/runtime error 均 0，两张截图已查看。之前批次的搜索 UI、暂存篮、快速收藏、窗口状态 decoder 均已有 MCP 验收；网络盘偏好经 MCP 隐藏/恢复和事件更新通过。搜索关键词输入后的真实 renderer IPC 路径未模拟键鼠。文件预览同句柄限量读取经 MCP 覆盖正常读回和 2/12/64 MiB 超限拒绝；缩略图缓存生成后重复命中读取均返回 JPEG 308 B；缩略图、版本 JPEG 读取竞态由生产 helper fake handle 覆盖。剪贴板图片 helper 覆盖增长，但隔离 profile 没有非空图片历史。runtime-log sanitizer 的 structuredClone 纯 Node 断言覆盖循环/函数/symbol/BigInt/异常 getter 与预算，fresh MCP 运行含 138 条 history、statusbar errors=0、`errors.mjs=0`、electron.log 新增克隆失败=0。WorkCrate project 错误 formatter 经 fresh full profile 超限读取触发 catch，列表仍可读且 hash 未变；状态栏红色 1 是预期的 MCP `isError` 工具调用日志，renderer `errors.mjs=0`。Eagle provider 离线 MCP 错误脱敏通过；外部恶意响应仅以生产 client 注入式纯 Node 验证。WorkCrate boards 自动同步异常分支无可靠 MCP 注入入口。14 项定向清单及逐批截图证据见 `VERIFY.md`，所有隔离应用均已停止；清单不构成全项目完整性声明。

**本批补充验证**：同一 fresh full profile 顺序验收 AdminSettings 的 runtime/access snapshot、StorageSettings、版本预览与 MCP smoke；32 项 runtime service、97 项 MCP tool，access=`full`，存储 20 组/26 项，JPEG 预览 621 B，renderer/runtime/statusbar errors 均为 0。四张专项截图见 `VERIFY.md`，实例已停止。

### Z6 二进制读取复核补充

对主进程 `readFile`、`createReadStream`、`open`、base64 与 `arrayBuffer` 路径做了定向复查，没有发现需要纳入本轮的第 15 个无界整文件内存读取入口。版本文件 SHA256 与资源 provider 全文件 GET 使用流式处理，但尚无总字节数/耗时上限；这不是无界整文件缓冲，仍需根据协议用途和最大资源规格单独决定传输预算。该结论仅限本轮搜索范围，不代表完整二进制路径审计。

### 后续续做顺序与完成门槛

1. 继续扩展 Z6 定向 JSON/数据库/导入入口清单并复核二进制入口；WorkCrate project.json 16 MiB 隔离拒绝路径已验收，是否需要超限后恢复/重新读取应按产品协议确认。
2. VectorCraft 正常工程/画板协议兼容待可复现原生文档 fixture 后验收；目前 sidecar decoder 单测和 WorkCrate renderer MCP 面板验收不代表 live 协议兼容。
3. 继续 Z4/Z7 盘点：在不绕过 MCP 审批的前提下，补文件操作成功后 approval/job 广播的运行时验收；复核搜索输入真实返回、剪贴板非空图片读取及 WorkCrate 自动同步失败的可测性；继续检查剩余插件 catch 和错误码/字段路径一致性。
4. 一个完整批次中的插件双语 `PORTS`、验证脚本和文档全部更新后，统一运行 guard/typecheck/build 与相关 MCP 场景、截图、错误检查；若只改文档/脚本则不重复生产构建。最后同步本文和 `VERIFY.md`。
5. 仅当 Z1–Z7 各边界清单均有实现/证据，且未验收项都有明确结论时，才把总状态改为完成；183/183 参数 schema 不能单独作为整体完成依据。

## 1. 已确定的方向与范围

1. 非画布的渲染层共享状态逐步统一使用 Zustand，完成后清除重复的手写订阅、通知和状态快照基础设施。
2. 继续使用现有 Zod 4，补齐设置读取、IPC 输入与输出、广播事件、外部数据和 UI 偏好恢复的校验边界。
3. 当前不增加 Jotai、Valibot、独立表单框架或第二套校验体系。Zod Mini 仅在后续体积测量证明有收益时单独评估。
4. 画布暂不纳入：不迁移画布场景服务、不调整渲染引擎和编辑命令、不改画布存储格式。其他服务迁移时保留画布已有消费者使用的服务契约。
5. Cordis、主进程服务、唯一 preload bridge、插件自动发现、IPC/MCP 权限和数据持久化所有权继续遵守 [AGENTS.md](../AGENTS.md)。

“全面引入”指统一适用范围内的共享状态实现。组件临时输入、DOM/编辑器实例、请求队列、资源租约和插件生命周期仍按各自职责管理。Zustand 不承担跨进程同步、文件事务或第三方代码隔离。

## 2. 代码现状与选型依据

以下是方案整理时的源码基线；迁移收益属于待验证目标。当前进度见第 10 节实施记录。

| 当前事实 | 代码依据 | 对方案的影响 |
| --- | --- | --- |
| 已有多个手写外部存储，重复维护监听集合、快照和通知 | [ExplorerStore](../src/renderer/src/plugins/data-ops-explorer/store.ts)、[AnnotationStore](../src/renderer/src/plugins/data-ops-annotations/service.ts)、[BasketStore](../src/renderer/src/plugins/data-ops-explorer-insights/basket.ts)、[ConsoleViewStore](../src/renderer/src/plugins/system-basic-debug-console/view.ts) | Zustand 可以统一这些基础操作，业务动作仍由插件实现 |
| `useEntryMeta(path)` 订阅整个元数据快照，再取得单个路径的值 | [metadata.ts](../src/renderer/src/plugins/data-ops-explorer/metadata.ts) | 迁移时改为按路径选择订阅，保留未变化记录的引用 |
| Explorer 多个组件通过 `useExplorer()` 订阅完整状态 | [store.ts](../src/renderer/src/plugins/data-ops-explorer/store.ts) | 按目录、选区、视图、加载状态分别选择订阅 |
| Explorer 每次 `set()` 都重新构建包含条目和选区的快照 | [store.ts](../src/renderer/src/plugins/data-ops-explorer/store.ts) | 迁移时减少无关派生计算，不能仅替换底层容器 |
| 工作区管理多个独立窗格 store | [panes.ts](../src/renderer/src/plugins/data-ops-explorer/panes.ts)、[PaneContext.tsx](../src/renderer/src/plugins/data-ops-explorer/PaneContext.tsx) | 保留每窗格独立实例及作用域 |
| 布局、主题经 Context 提供整份状态 | [layout.tsx](../src/renderer/src/workbench/layout.tsx)、[theme.tsx](../src/renderer/src/workbench/theme.tsx) | 统一到 Zustand 后通过 SDK 兼容原有使用方式；Context 可继续提供实例作用域 |
| Store 已在读写时进行 Zod 校验 | [store.ts](../src/main/services/store.ts) | 复用现有能力，不能把文件存储描述为完全没有 schema |
| 设置写入按命名空间 schema 解析；读取只校验外层通用文档 | [system-provider-settings](../src/main/plugins/system-provider-settings/index.ts) | 优先补齐各命名空间读取校验和迁移 |
| 设置 schema 已导出 JSON Schema，界面据此生成表单 | [设置 provider](../src/main/plugins/system-provider-settings/index.ts)、[设置界面](../src/renderer/src/plugins/system-basic-settings/settings.tsx) | 保持同一规则来源，避免再手写一套 Valibot 规则 |
| `call<T>()` 对 bridge 返回值使用类型断言 | [bridge-api.ts](../src/renderer/src/workbench/bridge-api.ts) | 泛型不提供运行时校验，需按边界风险补齐 decoder |
| 自动聚合的 IPC 命令使用通用 `unknown[]` 参数 schema | [commands.ts](../src/main/services/commands.ts) | 参数容器校验不能替代每个业务入口的实际校验 |

收益来自订阅粒度、引用稳定性、派生计算和生命周期管理。Zustand 不会自动消除父组件传参造成的更新，也不会替业务解决异步结果乱序。

## 3. 库的取舍

| 库 | 决策 | 理由 |
| --- | --- | --- |
| Zustand | 作为非画布共享状态的统一方向 | 支持独立 store、React selector 和多个作用域，适合当前插件服务与多窗格结构 |
| Jotai | 当前不引入 | 排除画布后，暂未发现需要第二套原子依赖体系的明确需求 |
| Zod 4 | 保留并补齐使用 | 已用于 MCP、命令、设置、外部数据及持久化，具备现成基础 |
| Zod Mini | 暂缓迁移 | 可从现有 Zod 包使用；是否迁移由实际打包贡献、API 成本与性能数据决定 |
| Valibot | 当前不引入 | 会增加规则转换、错误适配和一致性维护成本，当前缺少收益证据 |

当前 `package.json` 声明 `zod: ^4.6.7` 和 `zustand: ^5.0.16`，锁文件记录实际安装版本；可复现安装仍依赖锁文件与安装方式。Zustand 5.0.16 已通过本仓库类型检查与渲染构建。

不以“某状态库必然重绘”“某校验库必然让启动显著加速”等泛化结论作为迁移依据。主进程依赖与渲染进程依赖分别打包，主进程使用 Zod 不代表每个渲染插件都直接依赖 Zod。

## 4. Zustand 目标结构

### 4.1 所有权与宿主边界

- 插件内部通过 `zustand/vanilla` 创建 store，业务状态和动作保留在所属插件文件夹内。
- 跨插件通过渲染层服务及 `getService()` 使用能力，不导入其他插件的 store、schema 或组件文件。
- 宿主仅持有布局、主题、日志、插件目录等现有容器状态；不把标注、Explorer、笔记等业务实现搬进 `workbench/`。
- SDK 可提供统一的选择订阅入口、只读状态类型及可选服务降级适配；不重新实现监听系统、比较器或批处理框架。
- 现有服务中的 `getSnapshot()`、`subscribe()` 可以作为 Zustand 的薄适配保留；它们不再维护独立数据副本或第二套监听集合。
- 消费方以明确动作修改状态，避免跨插件暴露可任意写入的 `setState`。

### 4.2 store 拆分与作用域

| 状态 | 所有者及作用域 | 设计要求 |
| --- | --- | --- |
| Explorer 目录、分页、筛选、选区、导航 | Explorer 插件，每窗格一份 | 互不污染；活动窗格切换仅改变路由与选择服务指向 |
| 工作区布局与窗格目录 | Explorer 的工作区管理 | 管理窗格身份和实例，不复制每窗格全部业务状态 |
| 收藏、评分、标签与备注缓存 | 标注插件，当前渲染会话共享 | 按路径读取；权威数据仍在主进程 SQLite |
| 暂存篮、分组选项、调试筛选 | 各自所属插件 | 独立 store，动作保持原有行为 |
| 布局、主题、日志、插件目录 | 宿主容器 | 保留 SDK 边界、插件 core 限制及现有服务名 |
| 设置、命令面板、笔记、启动台等组件状态 | 所属插件 | 逐项判断；跨组件共享/会话状态才迁移，局部临时状态继续使用 React |

主题与布局纳入统一目标主要是为维护一致性，不能预先承诺明显性能提升。槽位 Context 和窗格 Context 作为依赖作用域的用途可以保留。

### 4.3 订阅与派生值

- 组件选择实际需要的字段，避免默认订阅整个 store。
- 未变化对象保持引用；读取同一状态时返回稳定结果，避免 selector 每次制造新对象。
- 多字段组合选择根据需要使用官方浅比较工具，不默认引入深比较。
- 列表、选区和标签聚合仅在输入变化时重算，不在每次无关更新时扫描全体条目。
- 兼容层快照保持原有数据含义；派生缓存不成为另一份可独立写入的状态。
- 日志继续保留条数上限、脱敏、截断及去重规则；批量接收和通知合并应测量后设计。

### 4.4 生命周期与异步操作

Zustand 的订阅释放不等于插件所有副作用已释放。实施时逐项保留或补齐：bridge 事件取消订阅、定时器清理、请求取消、异步结果的会话/请求版本检查，以及窗格关闭后的结果丢弃。

业务 store 的初始化和停止应幂等；有明确所有者负责创建、重置和释放。现有渲染层服务停用后仍保留注册的已知限制继续存在，不能把迁移到 Zustand 写成已经修复服务回收。停用后的动作、缓存和再次启用行为需要明确验收。

标注的乐观更新需要继续处理写入失败、重新读取和连续操作乱序。请求去重集合、AbortController、Promise 队列、资源租约等可以留在运行时管理对象中，不强行转为可序列化 UI 状态。

### 4.5 持久化

- 主进程继续拥有收藏、标签、笔记、项目等业务数据的持久化；Zustand 中保存界面状态与读取缓存。
- 布局、主题等 UI 偏好可使用 `persist`，但需要 `partialize`、版本迁移及 Zod 恢复校验。
- 不持久化函数、服务实例、编辑器实例、Promise、取消控制器或资源租约。
- 保留现有存储键和旧数据迁移路径；重新整理键名时必须提供迁移说明与重启验证。
- hydration 结束前避免把默认值自动写回并覆盖旧数据；持久化频率与恢复顺序需要单独设计。
- 主进程业务数据通过现有 bridge 更新，不能建立与 SQLite/JSON 相互竞争的浏览器业务数据库。

## 5. 手写实现迁移清单

表内项目在方案整理时均为待实施。文件位置用于确定工作范围，不表示整份文件都应删除；当前进度见第 10 节实施记录。

| 项目 | 主要位置 | 可替换的重复实现 | 必须保留或重构的行为 |
| --- | --- | --- | --- |
| 标注 | `plugins/data-ops-annotations/service.ts`、`plugins/data-ops-explorer/metadata.ts` | listeners、emit、整表快照通知、单项全表订阅 | 按路径加载、标签树、乐观更新、错误恢复与 IPC |
| 暂存篮 | `plugins/data-ops-explorer-insights/basket.ts` | 状态容器和监听集合 | 添加、移除、去重及服务契约 |
| 分组选项 | `plugins/data-ops-explorer-grouped/group-state.ts` | 手写 get/set/subscribe | 选项语义和分组视图服务 |
| 调试视图 | `plugins/system-basic-debug-console/view.ts` | 手写状态通知 | 筛选、搜索、展开和重置 |
| Explorer | `plugins/data-ops-explorer/store.ts` | 状态容器、通知、全量订阅 | 导航、分页、选区、请求竞态、增量刷新和取消 |
| 工作区 | `plugins/data-ops-explorer/panes.ts` | 手写快照与监听 | 1/2/4 栏、活动窗格、会话保存与实例释放 |
| 日志 | `workbench/logs.ts` | 手写可观察容器 | 去重、限量、脱敏、trace 和业务日志入口 |
| 插件目录 | `workbench/registry.ts` | catalog 快照及通知集合 | 自动发现、贡献校验、setup/dispose、核心插件限制 |
| 布局与主题 | `workbench/layout.tsx`、`workbench/theme.tsx` | 整份状态驱动的 Context 更新 | SDK、偏好兼容、系统主题监听和 `.dark` 行为 |
| 其余非画布插件 | 设置、命令、笔记、项目、剪贴板、启动台、更新、字体审查等 | 清点后识别的重复共享状态机制 | 局部 UI 状态及各插件副作用；不机械迁移全部 useState/useRef |

表中路径除 `workbench/` 外均相对于 `src/renderer/src/`。完整清点应覆盖“拥有状态的实现”和“消费状态的组件”，而不只搜索类名。DOM 事件监听、业务事件总线和主进程 Cordis 服务不属于待删除的手写 React store。

### S0 实际清点结果

| 状态所有者 | 主要消费者 | 当前存储与副作用 |
| --- | --- | --- |
| `data-ops-explorer` 每窗格 Explorer store | Explorer 工具栏、面包屑、树、网格/列表/画廊、检查器、状态栏；`data-ops-file-actions`、`data-ops-explorer-insights` 经 selection 服务读取 | 每窗格 vanilla store；主进程 filesystem/session/workspaces IPC；metadata 与 annotations 事件订阅；每窗格延迟会话写入 |
| `data-ops-annotations` 标注缓存 | Explorer metadata hook、标签页、Explorer 筛选与分组 | vanilla store；权威数据在主进程 SQLite；旧 `desksuite.explorer.meta` 只在迁移成功后移除 |
| `data-ops-explorer-insights` 暂存篮 | Insights/Basket 面板及 Explorer 操作 | vanilla store 缓存；主进程持久化，`basket:changed` 广播同步 |
| `data-ops-explorer-grouped` 分组选项 | Explorer 分组视图及 Explorer 插件桥 | vanilla store；视图偏好仍由工作区 session 持久化 |
| `system-basic-debug-console` 筛选/折叠状态 | 调试控制台工具栏和日志面板 | vanilla store；日志内容属于 workbench 日志 store |
| Workbench 日志 | DebugConsole、TopBar、命令面板和 bridge/runtime 记录器 | vanilla store；最多 3000 条，payload 脱敏/截断、ID 去重；运行时日志另由主进程持有 |
| Workbench 布局/主题/插件目录 | Shell 与各插件面板，设置管理页；消费者通过 `useLayout`、`useTheme`、`pluginCatalog` 服务 | vanilla store；layout/theme/plugin preference 的 localStorage 键见下表；media query 和插件 setup/dispose 为副作用 |
| 其他 UI 局部状态 | 设置、命令面板、剪贴板、笔记、启动台、更新器、字体审查等各自组件 | 大多为组件局部 `useState`；没有发现可跨插件替换的重复全局 store。画布服务/编辑器状态按范围排除 |

已检索的渲染层持久化键：

| 键 | 所有者 | 恢复/迁移策略 |
| --- | --- | --- |
| `desksuite.workbench.layout` | Workbench layout | Zod 恢复；v2 envelope 与未包裹的旧布局兼容；非法值只诊断并使用默认值，直到用户下一次布局操作才写入新格式 |
| `desksuite.theme.mode` | Workbench theme | 仅接受 `light` / `dark` / `system`；非法值警告并用 light，本次挂载不覆盖原始值 |
| `desksuite.workbench.plugins` | renderer plugin registry | Zod 字符串数组恢复；仅保留当前存在的非 core 插件 ID；启停变更时保存规范值 |
| `desksuite.workbench.font-audit.enabled` | 字体审查插件 | 旧 boolean 字符串偏好，插件 setup/dispose 管理 CSS 与 bridge 事件监听 |
| `desksuite.workbench.layout` 内的 `floatingPanels` 字段 | Workbench layout / UI Kit 面板 | 与布局同一 v2 envelope；pane 几何 schema 校验后按窗口范围夹取 |
| `desksuite.explorer.meta`、`desksuite.clipboard.history` | Explorer / Clipboard 的旧版本迁移 | 仅在主进程 IPC 导入成功后删除；主进程分别拥有现行标注和剪贴板数据 |

初始依赖版本为 Zustand 5.0.16、Zod 4.6.7（由锁文件解析）。基线脚本在剩余宿主/Zod 改动前收集 MCP 往返中位数与 P95、renderer heap 和截图；由于 S1/S2 已先行落地，这组数字是后续阶段比较基线，不能冒充迁移前数据。组件提交次数与事件监听总数没有现成只读 MCP 指标，当前明确记录为未测量，不通过临时 DOM/状态注入补造数字。

## 6. Zod 补齐方案

### 6.1 schema 所有权与复用

- 业务 schema 由能力所属插件维护，插件内部可拆分 `schema.ts` 等辅助文件。
- 同一业务输入在 IPC/MCP/命令入口语义一致时复用 schema；权限、来源、批准和执行阶段的规则分别保留。
- 使用 `z.infer` 等推导插件内部类型，减少 schema 与手写 interface 漂移。
- 跨插件继续使用服务契约；不能为了复用 schema 越界 import 另一个插件的文件。需要公共契约时先确定宿主类型或服务描述的合法落点。
- `strict`、额外字段保留/剥离、默认值和规范化行为按数据用途明确选择，不全项目机械套用同一策略。
- schema 校验之后，业务逻辑使用解析后的数据。路径存在性、权限、文件指纹、并发状态等业务检查仍由能力所有者执行。

### 6.2 需要补齐的边界

| 编号 | 边界 | 工作内容 | 验收重点 |
| --- | --- | --- | --- |
| Z1 | 设置读取 | `get/list` 按已注册命名空间 schema 验证持久化值，明确版本迁移和缺省字段行为 | 旧值可恢复；非法值有诊断；不会悄悄覆盖用户原始设置 |
| Z2 | 设置预校验 | 由设置插件提供只校验、不保存的能力，返回字段错误和规范化结果 | 预校验不写盘、不广播已保存事件；保存仍重新校验 |
| Z3 | IPC/命令输入 | 清点仅靠 TS 参数类型或 `unknown[]` 容器检查的入口，补上业务 schema | 直接 IPC、聚合命令和 MCP 入口语义一致，权限流程保持有效 |
| Z4 | 返回值与事件 | 优先处理文件/外部进程/持久化数据形成的结果，在进入业务状态前验证 | 畸形数据不污染 store；错误包含来源；恢复后仍可继续使用 |
| Z5 | UI 偏好 | 校验布局、主题、插件启停和视图偏好的恢复数据 | 非法字段、旧版本和新版本数据有明确兼容策略 |
| Z6 | 导入及外部数据 | 检查 JSON、frontmatter、外部程序响应等入口已有覆盖与缺口 | 保留大小/数量/超时限制；结构校验与业务检查结合 |
| Z7 | 错误一致性 | 统一错误码、字段路径及中文提示的展示约定 | 表单能定位字段；日志可关联 trace；不泄露敏感载荷 |

现有 `StoreService` 的读写校验、版本保护、原子写入与备份流程继续使用。若发现缺失/损坏状态和默认值恢复策略的问题，应独立记录并验收，不将更换校验调用方式视为已解决数据恢复。

### 6.3 设置与表单

保持“主进程 Zod schema → JSON Schema 描述 → 渲染层表单”的现有结构。JSON Schema 支持的基本约束用于界面提示，自定义业务规则由设置插件的校验接口执行，不在界面另写一套 Valibot 规则。

数值表单需要区分空输入与数字 0，不让 `Number('')` 隐式把清空输入当成合法业务值；还应处理整数、范围和非有限值。字段值提交前先按明确规则规范化，再进入权威 schema 校验。

只读预校验接口的确切名字、输入输出、调用频率、过期响应处理及 MCP 暴露方式在实施时确定，同步更新插件中英文 PORTS。本文没有声明该接口已经存在。

Zod 到 JSON Schema 的转换存在表达能力边界，不能假设自定义 refinement、transform 或文件系统语义能无损传给界面。敏感路径、文件写入批准、MCP 权限始终在主进程执行。

### 6.4 错误与性能

- 字段问题保留结构化路径，推荐用字符串/数字组成的路径数组供嵌套表单定位，展示层再生成中文说明。
- 适配既有 IPC 抛错、MCP `isError` 和插件结果结构，不为了统一错误而一次性改变全部公开协议。
- 缺省值、旧版本迁移、非法数据和高版本不兼容分别处理，避免统一兜底为空对象。
- 业务状态内部已经验证过的数据不在每次更新时重新全量解析。外部输入、持久化恢复及写入前检查各有独立职责。
- 不把函数、schema 实例或服务对象经 bridge 传输；跨进程传 JSON 描述、数据和结构化错误。

## 7. 实施阶段与交付物

总体目标是覆盖全部适用范围，阶段拆分用于控制行为变化和便于定位回归，不把首批试点通过视为全面迁移完成。

| 阶段 | 工作 | 交付与退出条件 |
| --- | --- | --- |
| S0 清点与基线 | 确定 Zustand 版本；清点 store、消费者、存储键和副作用；记录基线 | 完整迁移清单、契约兼容表、测量方案和待补 MCP 入口 |
| S1 共同约定与小型 store | 落地 SDK 薄适配；迁移标注、暂存篮、分组选项、调试筛选 | 原服务可用；按路径订阅成立；失败恢复与停用/启用通过 MCP 验收 |
| S2 Explorer 与工作区 | 迁移窗格、活动选区、分页、导航、增量刷新和会话 | 1/2/4 栏隔离；竞态和窗格释放正确；重启恢复通过 |
| S3 宿主状态 | 迁移日志、插件目录、布局、主题 | 无新增业务界面进入宿主；旧偏好兼容；core 插件、明暗主题和日志限制不退化 |
| S4 Zod 边界 | 按风险推进 Z1–Z7；当前完成设置读取/预校验、Explorer 关键 bridge 返回值、UI 偏好恢复和针对性 MCP 验收 | 已覆盖的边界通过 MCP 验收；全项目 IPC 方法 schema 与其余 JSON/外部响应仍需逐插件补齐 |
| S5 收尾 | 复核非画布共享状态及已检索外部数据入口；保留必要的薄兼容订阅 | 共享 store 清点和阶段验收完成；全项目 schema 审计列入后续，不宣称其已结束 |

各阶段按需要同步补齐涉及的 Zod 校验，不必等 S4 才验证持久化恢复。每阶段保持源码和契约一致，记录仍需保留的兼容适配及移除条件；不维护旧 store 与新 store 双向同步的长期过渡方案。

## 8. 验收与测量

实施阶段遵循 [VERIFY.md](VERIFY.md)。本次文档整理不代表以下验收已经执行，也不产生新功能已通过的结论。

### 8.1 统一验证边界

1. `npm run guard`、`npm run typecheck`，按改动需要运行 `npx electron-vite build`。
2. 应用由 `scripts/verify/launch.mjs` 启动，显式 `--access full`，使用隔离 profile，可写根限定为 `artifacts/verify/samples`。
3. 功能操作与状态变更只通过 DeskSuite 自身 MCP；`evaluate.mjs` 只读 DOM/状态/几何；截图经 `capture_window`。
4. 所有新增验证脚本位于 `scripts/verify/`，复用 `common.mjs`，在 `docs/VERIFY.md` 登记；产物位于 `artifacts/verify/`。
5. 现有脚本是可复用候选，运行前核对其行为是否符合当前 MCP 约束。部分历史脚本仍包含经 CDP 修改权限或 DOM 操作的逻辑，应先改为 MCP 路径，不能直接照搬作为本轮验收。
6. 能力缺少 MCP 入口时先在所属插件补齐，再验收。结束使用 `scripts/verify/stop.mjs`；开发期间不运行触发 Rust 编译的命令。

### 8.2 验收矩阵

| 场景 | 必须确认的结果 | 候选脚本/入口 |
| --- | --- | --- |
| 单文件评分、收藏和标签 | 正确落盘；无关条目不因全表订阅而更新；失败不会留下错误成功态 | `meta_rate`、`meta_favorite`、标签工具、`quick_bookmarks_explorer`；`annotations.mjs`、`explorer-concept.mjs` |
| 多窗格与工作区 | 活动窗格切换、独立筛选、选区、导航、关闭重建与重启恢复正确 | 现有工作区聚合命令；`explorer-view-composition.mjs` |
| 分页与外部变化 | 目录切换后旧请求不覆盖新状态；watcher 变更与分页无遗漏 | `explorer-watch.mjs`、`paging-watch.mjs` |
| 暂存篮与分组选项 | 去重、清理、切换、可选服务缺失时降级正确 | 现有聚合命令；缺少能力则补 MCP |
| 布局、主题、插件目录 | 旧偏好恢复、损坏数据诊断、`.dark`、core 限制、停用/再启用正确 | `command_run`、设置入口；`settings-commands.mjs`、`unified-commands.mjs` |
| 日志与调试视图 | 日志上限、脱敏、筛选、清理、trace 正确，高频更新无重复监听 | `get_runtime_logs`、`clear_runtime_logs`；`debug-console.mjs` |
| 设置与输入校验 | 缺失/非法/旧版本/高版本数据，字段错误和规范化结果符合约定 | `store.mjs`、设置与命令校验；预校验入口实施后新增专项 |
| 非画布服务兼容 | 既有消费者读取选区等公共服务时保持相同契约 | 服务契约及 MCP 回读；不扩展为画布性能或内部实现改造 |

### 8.3 测量方式与通过标准

- 同一构建模式、数据量、窗格数和设备环境下比较迁移前后结果。
- 记录组件提交次数、可见条目更新范围、交互耗时、内存及事件监听数量；多轮样本再报告中位数和尾部耗时。
- 如缺少组件提交次数的可读入口，在所属插件补充开发测量能力并由 MCP 驱动，不用 DOM click/dispatch 或临时注入状态变更脚本代替功能操作。
- 功能正确性、数据兼容性和插件边界是必过条件。速度与内存阈值在 S0 基线后确定，不预设迁移必然获得固定倍数提升。
- 重复打开/关闭或启停后的监听和资源计数应回到约定基线；仅观察一次 heap 数值不能证明没有泄漏。

## 9. 原始架构建议的处理结果

以下仅用于保留讨论结论，不属于本次 Zustand/Zod 实施范围。

| 建议 | 当前判断 | 后续处理 |
| --- | --- | --- |
| 重任务移出 Electron 主进程 | 方向合理；现有 Lore 已有 sidecar，不能把项目描述为所有工作都在主进程执行 | 独立研究重任务边界与进程内同步热点 |
| 替换 `node:sqlite` 解决阻塞 | 换库本身不保证异步；`better-sqlite3` 也提供同步 API | 优先研究 SQL、分批处理和执行位置，不在本轮更换数据库 |
| WAL 解决并发与 UI 卡顿 | WAL 不会把同一 JS 线程上的同步调用变成异步 | 独立评估数据库执行服务，迁移时需重设同步事务回调契约 |
| SQLite 全部可丢弃重建 | 当前数据库也拥有用户标注等权威信息，不只是搜索缓存 | 区分可重建索引与权威数据，另行设计备份恢复 |
| React/画布状态统一 | 已按用户要求排除 | 不据此修改画布或引入 Jotai |
| Milkdown/监听器未销毁 | 代码已有 `crepe.destroy()` 和 `watcher.close()`，不能按缺少清理直接判定泄漏 | 异步创建失败、重挂载和关闭保存边界另行验证 |
| 换校验库提高性能 | 当前尚无需要新增第二套校验库的测量依据 | 使用已有 Zod，先补齐边界与规则一致性 |

源码中的全局文件搜索目前使用名称/路径 `LIKE`，笔记全文搜索另有逐文件读取路径；不能仅因 README 或历史文档出现 FTS5 就认定当前已实现 FTS5 查询。此差异在索引专题中处理，不借本次状态迁移扩展功能。

## 10. 文档与完成状态

### 实施记录（2026-10-31）

- 已安装并锁定 Zustand `5.0.16`（`package.json` 使用兼容范围，`package-lock.json` 固定实际安装版本）。
- 首批迁移已落地：标注缓存使用插件私有 vanilla store，并提供按路径选择通知；暂存篮、分组选项、调试筛选不再各自维护监听集合。
- Explorer 每个窗格的状态容器与工作区窗格目录已迁移到 vanilla store；`useExplorer(selector)` / `useExplorerShallow(selector)` 已提供，Explorer 组件已改用 shallow selector。已补请求失效令牌、store dispose、订阅/定时器释放，并在布局缩减时保留隐藏窗格会话；MCP 实测竞态导航、4→1→4 隔离和同 profile 重启恢复通过。
- 暂存篮新增主进程 `basket_manage` MCP 工具和 `basket:changed` 广播，使外部 MCP 更新可刷新渲染层缓存；分组服务的 `getOptions()` 保持纯 JSON 可序列化。
- `quick_bookmarks_explorer` 增加 MCP `layout` / `pane` 动作，供本阶段按要求通过 MCP 验证工作区状态。
- 已新增 `scripts/verify/state-validation-s1.mjs`，全部状态变更经 DeskSuite MCP，DOM 只读，截图经 `capture_window`。隔离实例实测通过标注、标签、暂存篮缓存刷新、分组选项、Explorer 导航、1/2/4 栏与独立窗格导航；`npm run guard`、`npm run typecheck` 与 `npx electron-vite build` 通过。
- 宿主日志缓冲改用 vanilla store，继续保留容量上限、去重和既有脱敏/截断逻辑；对外 `logStore.push/clear` 兼容调用方式不变。主题模式与系统深色状态改用 vanilla store，保留 `useTheme()` 接口、系统主题监听和 `.dark` 类行为。
- 已新增 `scripts/verify/state-validation-s3.mjs` 并登记到 `docs/VERIFY.md`；隔离 full 实例 MCP 切换主题两次并确认外观返回初态，打开调试控制台只读检查日志呈现，调用 `capture_window` 并查看截图。
- S0 完成非画布共享状态、消费者、存储键和副作用清点；基线脚本记录了 20 次 MCP 往返中位数/P95、renderer heap 与截图。因首批 S1/S2 已先落地，这不是迁移前基线。
- S3 已完成日志、主题、布局和插件目录 vanilla store 迁移，原 `useLayout()` 兼容入口保留，组件改用 selector；插件启停命令维持 catalog 所有权与 core 限制。`state-validation-s3.mjs` 验证主题、侧栏布局、字体审查插件停用/恢复、日志界面并通过 MCP 截图确认。
- S4 已补设置持久化读取 schema 校验（坏值诊断并回退默认、不覆盖原始值）、只读 `settings.validate`、表单保存前校验、Explorer bridge 关键文件系统结果解码，以及 layout/theme/plugin/font-audit 偏好恢复验证。应用 `config.json` 读取继续逐字段兼容旧值，并在归一化后经 schema 验证；运行时配置写入也按 `window`/`mcp` schema 校验，MCP 端口和写入根数量/路径长度受限。新增 preserve-config 验证入口并实测损坏窗口字段/写入根逐字段恢复、full 权限保留和应用正常启动。MCP HTTP 请求体现在限制为 16 MiB，超限返回 413，并在 JSON 解析前拒绝。笔记 YAML frontmatter 读取现在校验已消费字段，前置元数据限 256 KiB、别名展开限 100；超限时正文保持原样可编辑，属性自动重写会明确拒绝。另为缩略图缓存头增加严格 schema 和 2 MiB 文件/4 KiB 头部限制，为剪贴板旧历史导入增加单条/总 UTF-8 字节/条数预算，为启动台 PowerShell 输出增加逐项 schema 与最多 5,000 行边界，并为 Lore/WorkCrate sidecar 响应封套增加 Zod 校验。真实 Lore 验收发现 Rust `Option<String>` 的 `error` 会作为 null 序列化，已让 envelope schema 接受 null；`notes-editor.mjs` 已通过 Lore 快照与版本查询。WorkCrate 画板缓存现对读取、写入和预览清理统一执行完整 schema 与 64 MiB 限额；版本信息 provider 对 SQLite 中的快照、版本图和版本记录 JSON 增加结构 schema 与数量/字段限制；持久化审计 JSONL 逐行验证记录结构并跳过超过 256 Ki 字符的行。`ctx.ipc.handle` 现在允许按方法登记位置参数 tuple schema，并由 direct IPC 与共享命令校验路径复用；审计确认主进程 183/183 个字面量 IPC 方法均登记了参数 schema，覆盖 WorkCrate 工程/画板、Eagle、白板、问候和画布输入等此前漏计的 spread/变量 handler。`ipc-schema-audit.mjs` 提供静态覆盖率盘点。full 隔离实例实测设置、缩略图、剪贴板超限拒绝、启动台扫描、审计日志回读、MCP 超限请求拒绝，以及 filesystem/basket/annotations/workspace/search 等聚合命令非法参数拒绝通过；WorkCrate 工程和画板非法参数拒绝已加入本轮 MCP 验收。S2 工作区隔离及同 profile 重启恢复复验通过。截图 `artifacts/verify/state-validation-s2-check-restart.png`、`state-validation-s4.png`、`note-editor-restored.png` 已查看，`errors.mjs` 为 0 项。WorkCrate sidecar 尚无真实隔离文档 fixture，未执行端到端调用。相关插件 PORTS 已同步。
- S5 复核后保留的 `useSyncExternalStore` 都属于画布范围、窗格/活动 store 路由，或为共享服务的薄订阅适配；未发现需要机械迁移的额外非画布全局 store。个别 JSON 入口已有局部结构保护，例如剪贴板旧历史只保留字符串、WorkCrate 注释解析限制命名空间/版本、画布数据按范围排除。
- **剩余审计边界**：IPC 参数 schema 登记已完成，静态脚本核算 183/183（100%）；此数字只代表入口参数 schema 登记，不代表所有业务不变量或返回值均已验证。Z4 已增加资源、标注、watcher、launcher、command-palette、Explorer workspace、搜索、暂存篮、收藏、窗口控制、网络盘偏好、StorageSettings 和 AdminSettings 等 output/event decoder；fileOps 成功审批/job 广播仍未现场验收，其他桥接出口仍待盘点。Z6 定向 JSON/SQLite/二进制流清单为 14 项，不是完整全仓枚举；VectorCraft live 协议无真实文档 fixture，WorkCrate 现场覆盖超限拒绝而非恢复协议。index-scan stale cleanup 和 fileOps version rebind 均按 500 行分页；前者有 full MCP 跨页验收，后者仅生产 helper 内存 SQLite 验证，MCP 人工审批后的成功移动/历史回读仍待验收。剪贴板非空图片 live 读取仍缺带既有条目的 profile；缩略图缓存命中、版本 JPEG 预览读取已通过 MCP 实测，竞态/超限由 fake handle 覆盖。版本 SHA256 与资源全文件 GET 使用流但没有总传输预算；其内存行为有界，服务级传输上限尚未产品决策。Z7 runtime-log、Audit、Jobs 与已审插件出口已有脱敏/预算规则；WorkCrate 自动同步失败分支缺可靠注入方式，Eagle 恶意外部响应由生产 client 注入式纯 Node 验证，`canvas-ops-resource-input` 错误传递经中央 formatter/MCP helper，Eagle Inspector 字符串错误已改用 SDK formatter。其他未审错误路径仍待复核。因此，S0–S3 和已列出的 S4 边界已完成，Z1–Z7 总体与“全项目边界校验”目标仍未完成。

- [x] 明确 Zustand 的统一方向、所有权、迁移范围和排除项。
- [x] 明确 Zod 补齐边界与不引入额外库的原因。
- [x] 整理阶段、兼容要求、清理标准和 MCP 验收矩阵。
- [x] 安装 Zustand 并落地共同约定（插件私有 vanilla store、SDK selector、兼容订阅适配）。
- [ ] 完成全项目 Z1–Z7 边界审计及所有 IPC/外部数据入口 schema 覆盖。
- [x] 完成 S0–S3 迁移、契约更新和逐阶段 MCP/截图实机验收；完成 S4 已列范围的验收。
- [x] 以实测结果更新本文件及受影响的架构文档；剩余审计明确记录为未完成。

实施后同步更新插件 `PORTS.md` / `PORTS_ZH.md`、[WORKBENCH.md](WORKBENCH.md)、[VERIFY.md](VERIFY.md) 和 [ROADMAP.md](ROADMAP.md)。现有 AGENTS 约定不会因本文自动改变；需要调整约定时，应在对应实现阶段明确记录。

## 11. 官方参考

- [Zustand createStore](https://zustand.docs.pmnd.rs/reference/apis/create-store)：独立于 React 的 store API。
- [Zustand useStore](https://zustand.docs.pmnd.rs/reference/hooks/use-store)：selector、动态 store 和作用域实例。
- [Zustand useShallow](https://zustand.docs.pmnd.rs/learn/guides/prevent-rerenders-with-use-shallow)：组合选择与引用稳定性。
- [Zustand persist](https://zustand.docs.pmnd.rs/reference/middlewares/persist)：部分持久化、版本迁移和恢复校验。
- [React useSyncExternalStore](https://react.dev/reference/react/useSyncExternalStore)：外部状态快照与订阅契约。
- [Zod JSON Schema](https://zod.dev/json-schema)：schema 描述输出与不可表示类型。
- [Zod Mini](https://zod.dev/packages/mini)：函数式 API、tree-shaking 和适用条件。
- [Valibot 对比说明](https://valibot.dev/guides/comparison/)：模块化设计与按 schema 测量体积收益。

外部文档用于解释 API 和取舍，DeskSuite 的实际接口、限制和所有权以当前源码及插件契约为准。
