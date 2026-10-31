# DeskSuite 能力扩展路线图

> 版本 v1.2 · 2026-10-28 · 状态：F1–F5 已实现并完成本轮统一回归；F6 按需未实施
> 事实源：本仓库 `src/`（已核实到行号）+ `docs/reference/fileatlas/`（外部快照）+ npm registry（第 12 章）
> 目标：把 DeskSuite 从「只读文件浏览器 + 几个面板」推进到「可操作、可索引、可被 AI 安全操作的工作台」

---

## 0. 怎么用这份文档

- 第 2 章是**现状基线**，所有"缺什么"的判断都有代码位置；动手前先复核，代码变了就回写本章。
- 第 4 章是**横切机制**（M 编号），先落地，后面的功能都复用；不要在每个插件里重写一遍。
- 第 5 章是**功能批次**（F 编号），按 F0→F5 顺序推进；每个功能都写了落点、契约、步骤、优点、代价、优化方向。
- 第 11 章是**进度台账**，每完成一项回写状态；这是接力开发的唯一进度事实源。
- 第 12 章是**开源库选型**：每个功能块该装哪个库、哪个不该装、为什么。动手前先看该章，不要重新自研。
- 参考项目原文在 [docs/reference/fileatlas/](reference/fileatlas/README.md)，只作事实参考，不是本项目规范。

实现与交付状态：F1–F5 的功能代码、契约文档和专用验证脚本已落地。2026-10-28 已通过 `npm run guard`、`npm run typecheck`、`npm run package:dir`，并完成文件操作/审批撤销、标注、缩略图、分页与 watcher、索引搜索、性能、设置命令、启动台、剪贴板图片、白板场景、更新状态和渲染异常回归。台账中仍标为 ◐ 的项只保留尚未覆盖的实机交互或真实发布源限制；F6 未实施。

完成定义（每个功能块都适用）：

1. 新增/改动插件带 `PORTS.md` + `PORTS_ZH.md`；
2. `npm run guard` + `npm run typecheck` 通过；
3. `scripts/verify/` 下有对应脚本并在 `docs/VERIFY.md` 登记，产物落在 `artifacts/verify/`；
4. 运行 `npx electron-vite build` 后，用 `node scripts/verify/launch.mjs`、对应端到端脚本与 `stop.mjs` 完成最终实机回归（开发阶段不要执行 `npm run build` 或 `launch.mjs --build`，避免触发 Rust 编译）；
5. 回写本文件第 2 章（如涉及现状）与第 11 章台账。

---

## 1. 结论

1. **文件写能力必须有安全模型。** 写操作统一使用 计划 → 人工批准 → 执行 的结构；MCP 调用方不能以 `confirm: true` 自行授权。
2. **浏览继续走实时文件系统，索引只服务搜索/统计/缩略图。** fileatlas 的完整性清单同样要求"任意路径可直接浏览、不要求先扫描"；DeskSuite 把这条固化成架构约束：索引缺失或未就绪时，浏览器功能完整可用。
3. **元数据先于索引落地。** 收藏/评分/标签使用 SQLite 的规范化路径键，不依赖索引；旧 `localStorage` 数据通过一次性迁移导入。
4. **缩略图交给操作系统。** Electron 自带 `nativeImage.createThumbnailFromPath`（Windows 走系统缩略图提供器），图片/视频/PDF/Office 都能出图，不引入 sharp / ffmpeg / 原生模块。
5. **跨插件不变量下沉到基座。** MCP 权限在 `services/mcp.ts` 内强制，长任务模型在 `services/jobs.ts` 内统一，持久化在 `services/store.ts` 内统一实现一次——而不是让每个插件自己记得检查。
6. **能用平台内置能力就不装库，装库只装一个。** Electron 40 已内置 `node:sqlite`（含 FTS5）、系统缩略图、回收站、快捷方式解析、拖出；这些不要用第三方替代。其余功能按第 12 章选型，F0–F2 合计只多一个依赖。

---

## 2. 现状基线

| 能力 | 现状 | 证据 | 短板 |
| --- | --- | --- | --- |
| 目录浏览 | 实时读取并支持分页续读 | `data-ops-filesystem` 的 `listDir/listMore` | 大目录性能和取消行为待回归测量 |
| 多选与虚拟滚动 | 支持多栏独立选择及窗口化列表 | `data-ops-explorer/store.ts`、`useVirtualizer.ts` | 超大目录内存与滚动指标待基准脚本记录 |
| 收藏/评分/标签 | SQLite catalog 持久化，含旧 metadata 一次性迁移 | `data-provider-catalog`、`data-ops-annotations` | 迁移与跨路径变更场景待实机回归 |
| 画廊与缩略图 | 磁盘缓存缩略图、可见时加载 | `data-provider-thumbnails`、`FileGalleryView.tsx` | 系统缩略图格式覆盖率需在目标 Windows 环境确认 |
| 文件操作 | 计划、人工批准、执行、逐项结果及撤销 | `data-ops-file-operations`、`data-ops-file-actions` | 冲突、stale、权限边界和回收站待实机回归 |
| 暂存篮 | 持久化并可通过文件操作计划执行 | `data-ops-basket`、`data-ops-explorer-insights` | 跨重启和批量写操作流程待回归 |
| 会话与工作区 | 走主进程 store，Explorer 支持 1/2/4 栏 | `system-basic-session`、`data-ops-explorer` | 复杂布局恢复与滚动锚点待实机回归 |
| 搜索与索引 | SQLite 扫描、搜索 IPC/MCP 和全局搜索面板 | `data-ops-index-scan`、`data-ops-search` | 大型目录和取消/重扫场景待基准验证 |
| MCP | 访问级别、写权限闸门、审计及工具聚合 | `services/mcp.ts` 与插件工具注册表 | F1–F5 新增工具权限矩阵待统一实机回归 |
| 设置/命令/启动台 | schema 设置页、命令注册表/面板、应用发现与启动 | `system-provider-settings/commands`、对应界面插件 | 注册表缓存与命令计划约束待回归 |
| 剪贴板/笔记/白板/更新 | 图片历史、Milkdown 所见即所得 Markdown 笔记、Excalidraw 场景、更新状态 UI | 对应 F5 插件 | 双链未做（见 [NOTE_EDITOR.md](NOTE_EDITOR.md)）；打包资源与发布源配置尚待目标机验证 |
| 目录监视 | chokidar 监听当前目录及固定目录并广播变化 | `data-ops-watch` | 事件去抖和目录切换生命周期待实机回归 |

---

## 3. 目标架构

### 3.1 分层

```
渲染层插件（React，只做界面与交互状态）
        │  window.bridge.invoke / onEvent
        ▼
内置服务（config / ipc / mcp / window / store / jobs）   ← 跨插件不变量在这一层强制
        │  ctx.xxx 服务注入 + ctx.ipc.handle
        ▼
主进程插件（业务能力，各自拥有数据与生命周期）
        │
        ▼
磁盘：SQLite（catalog）/ JSON 文档（session 等）/ 缩略图缓存
```

### 3.2 五条数据所有权硬规则

1. **SQLite 只允许一个插件打开**：`data-provider-catalog`。其他插件通过注入的 `db` 服务访问，禁止各自 `new DatabaseSync`。
2. **文件写操作只有一个执行器**：`data-ops-file-operations`。上下文菜单、暂存篮、命令面板、MCP 全部调它，不允许任何插件直接 `fs.rename`。
3. **JSON 文档只有一个写实现**：`services/store.ts`（临时文件 + fsync + 原子改名 + `.bak` + 版本校验）。
4. **长任务只有一个模型**：`services/jobs.ts`（jobId、进度事件、取消信号、结果）。
5. **MCP 权限只在注册表内判定**：插件声明 `mutating`/`impact`，`services/mcp.ts` 统一拒绝；插件不得自行实现"我允许/我不允许"。

### 3.3 新增插件清单

| 批次 | 层 | 插件 | 职责 | 对外提供 |
| --- | --- | --- | --- | --- |
| F1 | 主 | `data-ops-file-operations` | 写操作计划/批准/执行/撤销 | IPC `fileOps`、MCP `file_*` |
| F1 | 渲染 | `data-ops-file-actions` | 右键菜单、确认弹窗、进度面板、拖出 | — |
| F2 | 主 | `data-provider-catalog` | SQLite 连接、迁移、files/folders | Cordis `db` |
| F2 | 主 | `data-ops-annotations` | 标签树、收藏、评分、备注 | IPC `annotations`、MCP `tag_*`/`meta_*` |
| F2 | 渲染 | `data-ops-annotations` | 左侧标签树页、标签编辑器 | 渲染服务 `annotations` |
| F2 | 主 | `system-basic-session` | 会话/工作区文档读写 | IPC `session`、`workspaces` |
| F3 | 主 | `data-provider-thumbnails` | 系统缩略图 + 磁盘缓存 | IPC `thumbnails` |
| F3 | 主 | `data-ops-watch` | 目录变更监视 | 广播 `fs:changed` |
| F4 | 主 | `data-ops-index-scan` | 扫描流水线 | MCP `index_*` |
| F4 | 主 | `data-ops-search` | 文件名/路径/标签搜索 | IPC `search`、MCP `search_files` |
| F4 | 主 | `system-basic-dev-lab` | 合成数据与基准 | IPC `devLab`、MCP `dev_*` |
| F5 | 主 | `system-provider-commands` | 命令注册表 | Cordis `commands`、MCP `command_*` |
| F5 | 渲染 | `system-basic-command-palette` | 命令面板 | — |
| F5 | 渲染 | `system-basic-settings` | 设置页 | — |
| F5 | 主 | `system-basic-launcher` | 启动台 | IPC `launcher` |
| F5 | 渲染 | `note-ops-markdown` | 笔记 | — |

> 多栏不进新插件：它需要"每个栏位一个独立状态实例"，而槽位系统是单贡献单实例。放进 `data-ops-explorer` 内部实现 1/2/4 栏，把 `panes` 作为渲染服务暴露，等第二个消费方出现再拆。

### 3.4 磁盘布局

```
{userData}/
  config.json            # 现有：window / mcp（F0 增加 mcp.access / mcp.writeRoots）
  data/
    desksuite.db         # SQLite（WAL）：files / folders / meta / tags / file_tags
    desksuite.db-wal
    session.json         # 会话（M1）
    workspaces.json      # 工作区（M1）
    basket.json          # 暂存篮（M1）
    audit.jsonl          # 写操作审计（只追加）
  thumbs/                # 缩略图缓存
```

---

## 4. 横切机制

### M1 原子 JSON Store（新增基础服务 `services/store.ts`）

**问题**：会话、工作区、暂存篮、设置都要持久化；每个插件各写一遍 `writeFile` 必然出现"半个文件"和版本不兼容。

**设计**：

```ts
store.register('basket', { schema: z.array(basketItemSchema), default: [] })
const basket = await store.read('basket')      // 校验失败 → 回退 .bak → 再失败用 default
await store.write('basket', next)              // tmp + fsync + rename + .bak
```

- 未注册的 key 直接抛错（渲染层不能借 `store` 写任意文件）。
- 文档版本号写在文件内；高版本拒载并保留原文件。
- 写入串行化：同一 key 的写入排队，避免并发覆盖。
- `registerDocument(key, relativePath, definition)` 可将注册文档写入 `data/` 内受限相对路径（例如 `jobs/<jobId>.json`）；路径段拒绝绝对路径及 `.` / `..`，读写仍由 store 统一完成。

**优点**：正确性只实现一次；插件只关心 schema。
**代价**：多一个基础服务（约 120 行）。
**进一步优化**：写入用 `open(tmp,'w')` + `fh.sync()` 后 `rename`；Windows 上 rename 覆盖已存在文件是原子的（`fs.rename` 底层 MoveFileEx REPLACE_EXISTING），不需要先删目标。

> fileatlas 把同一套 tmp+bak+版本校验写了 5 处（workspaces / session / basket / settings / 缓存）；DeskSuite 只写 1 处。

---

### M2 长任务模型（新增基础服务 `services/jobs.ts`）

**问题**：复制 2 万个文件、扫描 10 万条记录、生成缩略图，都需要进度、取消、结果，而现在的 IPC 只有"调用-返回"。

**设计**：

```ts
const job = ctx.jobs.create({ label: '复制 128 项', total: 128, cancelable: true })
job.progress(37, '正在复制 IMG_0037.jpg')
job.signal.addEventListener('abort', ...)
job.finish({ ok: 120, failed: 8 })
// 自动广播 job:progress / job:done；job.get(id) 可轮询
```

**优点**：文件操作、扫描、导出共用一套；MCP 与 UI 拿到同样的进度语义。
**代价**：需要在渲染层加一个通用进度面板（F1-2 内做）。
**进一步优化**：进度事件做 100ms 节流，避免 2 万条逐条推送打爆 IPC；`job.done` 里带逐项结果摘要而不是全量列表，全量结果另存文件供 `job.result(jobId, offset, limit)` 分页读取。

---

### M3 计划 → 批准 → 执行（写操作安全模型）

**问题**：MCP 客户端可以直接调用工具。`confirm: true` 只是调用方自己声明"我确认了"，fileatlas 的文档也承认这一点；它的 MCP 方案文档明确写了"不能仅凭 AI 发出工具调用就视为用户确认"，但实现里并没有人类确认环节。

**设计**：

```
plan(op)            → { planId, items[], conflicts[], summary }   // 只读，不动磁盘
approve(planId)     → 只允许渲染层调用（用户点确认）；MCP 无法调用
execute(planId)     → 校验批准 + 指纹 + 未过期，然后执行
```

- 计划内每条记录 `{ source, target, size, mtimeMs }`；执行前重新 stat，任何一项变化 → 该项 `stale`，不执行。
- 计划 5 分钟过期；批准与执行都必须带 `planId`。
- **MCP 侧只暴露一个工具**（如 `file_copy`）：内部创建计划 → 广播批准请求 → 阻塞等待用户批准（60s 超时）→ 执行或返回 `rejected/pending`。AI 看到的是"一次调用"，人类仍然是唯一的批准者。
- 没有窗口（headless）时自动拒绝。

**优点**：确认是结构保证，不依赖调用方自觉；UI 与 MCP 走同一条路径。
**代价**：需要计划注册表与批准 UI。
**进一步优化**：批准弹窗显示"将影响 N 项、其中 M 项冲突、预计 1.2 GB"，并把冲突项默认折叠；批准事件写审计日志，事后可追。

---

### M4 路径规范化（`services/paths.ts` 工具模块）

**问题**：Windows 大小写不敏感、UNC、长路径、符号链接、盘符根。索引键、标签键、MCP 写入白名单都依赖同一套规范化。

**设计**：

```
normalize(path)      → 绝对化 + win32.normalize + 去尾部分隔符
identity(path)       → normalize 后转小写（用于 DB 主键与去重）
toLongPath(path)     → 超过 255 字符时加 \\?\ 前缀
assertWritable(path) → 拒绝盘符根、Windows/Program Files/userData，拒绝 realpath 逃逸
```

**优点**：一次实现，DB、标签、MCP 白名单共用。
**代价**：符号链接策略要定（**不跟随**，与 fileatlas 一致）。
**进一步优化**：`assertWritable` 基于 `realpath` 后的结果做根目录前缀比较，防止 `link -> C:\Windows` 绕过。

---

### M5 SQLite（`data-provider-catalog` 提供的 `db` 服务）

**技术选型**：Electron 40 内置 Node 24.11，先实测 `node:sqlite` 的 `DatabaseSync` 是否可用（3 行脚本即可验证）；不可用再退回 `better-sqlite3`（需要 electron-rebuild）。**不引入 ORM。**

**设计**：

- `PRAGMA journal_mode=WAL`、`synchronous=NORMAL`、`foreign_keys=ON`。
- 单连接、同步 API、写操作全部走事务；扫描分批提交（每 500 行一个事务）。
- 迁移：`PRAGMA user_version` + 有序迁移数组，插件可注册自己的迁移段。
- 表（F2 最小集）：

```sql
meta(path_key TEXT PRIMARY KEY, path TEXT, favorite INTEGER, rating INTEGER, note TEXT, updated_at INTEGER);
tags(id INTEGER PRIMARY KEY, name TEXT, parent_id INTEGER, color TEXT, sort INTEGER, created_at INTEGER);
file_tags(path_key TEXT, tag_id INTEGER, PRIMARY KEY(path_key, tag_id));
```

**关键决策**：`meta` / `file_tags` 按 `path_key` 建，**不依赖 files 表**。所以标签、收藏、评分在未索引的目录上也能用，F2 不必等 F4。

**优点**：标签先于索引可用；索引插件停用不影响标注数据。
**代价**：文件重命名后标注不会自动跟随（需要 F1 在重命名时同步更新 `path_key`，并记录迁移）。
**进一步优化**：重命名时在同一个事务里更新 `meta.path_key`、`file_tags.path_key` 和 `files.path`；移动目录时按前缀批量更新，而不是逐条。

---

### M6 审计日志

**设计**：所有 `mutating` 的 IPC/MCP 调用在 `services/mcp.ts` 与 `fileOps.execute` 两处写入 `data/audit.jsonl`：`{ ts, origin: 'ui'|'mcp'|'command', tool, planId, items, results }`。

**优点**：出问题能回答"是谁在什么时候动了哪个文件"。
**代价**：极低。
**进一步优化**：按天分文件 + 30 天清理；`debug.query`（F5）可以直接读它。

---

### M7 命令注册表（F5）

**设计**：一份命令定义同时产出 UI 动作、快捷键、MCP 工具：

```ts
ctx.commands.register({
  id: 'file.trash', title: '移到回收站', group: '文件',
  keybinding: 'Delete', mutating: true, plan: (args) => fileOps.plan(...),
  run: (args) => fileOps.executeFromPlan(args)
})
```

**优点**：不会出现"菜单能做的事 AI 做不了"或反之；`mutating` 标记直接驱动 MCP 权限。
**代价**：需要统一参数 schema。
**进一步优化**：`guard.mjs` 强制"`mutating: true` 的命令必须提供 `plan`"，从结构上杜绝绕过批准流程的写命令。

---

### M8 设置（F5）

**设计**：每个插件导出 zod schema，`z.toJSONSchema()` 后由设置页通用渲染器画表单；值存 `data/settings.json` 的 `plugins.<命名空间>` 下。**渲染器只画，不校验；校验和持久化都在主进程。**

**优点**：新增设置项零 UI 代码，类型安全。
**代价**：需要一个 schema→控件的映射表（boolean→开关、enum→下拉、number→滑杆/输入）。
**进一步优化**：比 fileatlas 的声明式 `SettingsPage` 更省代码——它要写控件树，DeskSuite 只写 schema。

---

## 5. 功能批次

### F0 安全地基（先做，约 3 个改动点，无用户可见功能）

#### F0-1 MCP 权限闸门
**落点**：`src/main/services/mcp.ts`（基础服务，唯一强制点）+ `services/config.ts`。
**改动**：
- `McpToolDef` 增加 `mutating?: boolean`、`impact?: 'low' | 'high'`；`registerTool` 校验 `impact==='high' ⇒ mutating`。
- `config.json` 增加 `mcp: { port, access: 'off'|'read'|'standard'|'full', writeRoots: string[] }`，默认 `read`。
- 调用时按 access 判定：`off` 全部拒绝；`read` 拒绝所有 `mutating`；`standard` 允许 low；`full` 允许 high（仍需 M3 批准）。
- `listTools()` 返回 `{ name, mutating, impact }`，控制中心展示徽标。
**步骤**：改类型 → 改 `handleRequest` 前置判定 → 改 `ipc.handle('mcp')` 返回结构 → 控制中心适配 → `scripts/verify/mcp.mjs` 增加权限矩阵用例。
**优点**：一个地方强制，插件无法绕过；与 fileatlas 的"设置即时生效"一致。
**代价**：`mcp.tools` 的返回结构变化，需要同步渲染层。
**进一步优化**：拒绝时返回结构化 `{ code: 'forbidden', requiredAccess, tool }`，便于 AI 客户端自我纠正而不是盲试。

#### F0-2 `services/store.ts` / `services/jobs.ts` / `services/paths.ts`
按 M1/M2/M4 落地；先用暂存篮（替换 `localStorage`）验证模型，会话文档在 F2-4 接入同一套。
**验收**：杀掉进程再启动，暂存篮仍在；写入过程中模拟断电（写完 tmp 后 `process.exit`）不产生半个 JSON。

#### F0-3 审计写入
`fileOps.execute`（F1）与 MCP 写工具统一写 `audit.jsonl`。

---

### F1 写能力闭环（第一个用户可见的大功能）

#### F1-1 文件写操作服务
**落点**：主进程 `src/main/plugins/data-ops-file-operations/`。
**契约**：

```
fileOps.plan({ op: 'copy'|'move'|'rename'|'mkdir'|'trash', sources: string[], target?: string })
fileOps.approve(planId)          // 仅渲染层
fileOps.execute(planId)          // → { jobId }
fileOps.cancel(planId | jobId)
fileOps.get(planId)
事件：fileOps:approval、job:progress、job:done
MCP：file_copy / file_move / file_rename / file_mkdir / file_trash（内部走计划+批准）
```

**实现要点**：
- 逐项执行、逐项结果（`completed | skipped | conflict | failed | stale`），单项失败不中断整批。
- 冲突策略：`skip | overwrite | rename | cancel`，可"对后续项应用同一选择"。
- 复制用 `fs.cp(src, dst, { errorOnExist: true, force: false, recursive: true })`，重命名冲突由计划阶段检测。
- 移动：先 `rename`；`EXDEV` 跨卷时回退 `cp` + `unlink`。
- 删除：`shell.trashItem`（回收站），不提供永久删除（或放在 `full` 权限后）。
- 新建目录：`mkdir` 逐级创建，已存在则 `skipped`。
- 执行后修复选择：仍存在的路径保留选中，消失的路径移除。
- 写操作完成后 200ms 触发一次目录刷新事件（与 F3 watcher 去抖一致，避免双重刷新）。
- 每个作业的逐项结果由 `store.registerDocument` 保存到 `data/jobs/<jobId>.json`；启动时注册并读取最近 50 个结果。

**优点**：暂存篮、右键菜单、命令面板、MCP 共用一套语义；逐项结果天然适合大目录。
**代价**：计划/批准/指纹校验是最复杂的部分（约 600–800 行）。
**进一步优化**：
- 用 `fs.promises.opendir` 边遍历边执行，而不是先收集全部路径；
- 覆盖率最高的保护是"执行前逐项 stat 指纹"，直接把"计划后文件被改"变成可见的 `stale`，而不是静默覆盖；
- 批量操作的结果写一份 `artifacts/verify/` 之外的 JSON 到 `data/jobs/<jobId>.json`，支持事后重试失败项（`retryFailed(jobId)`）。

撤销栈最多保留 20 项内存记录；覆盖重命名、同卷移动和新建空目录。复制、回收站删除、跨卷移动以及指纹变化不撤销；应用重启后撤销栈清空。

#### F1-2 右键菜单 / 确认 / 进度 / 拖出
**落点**：渲染层 `src/renderer/src/plugins/data-ops-file-actions/`。
**贡献**：`workspace.views` 不行（那是文件区），改用 `floating.panels`（进度面板）+ 全局上下文菜单组件（挂在 `app.root` 的包裹层？槽位里没有全局层，用 `floating.panels` 的挂载点做 portal）。

> 槽位缺口：目前没有"全局浮层/菜单"槽位。最小改法是在 `SlotId` 增加一个 `overlay.root`，由外壳渲染在最后；这属于容器能力扩展，写进 F1 的宿主改动。

**实现**：
- 右键菜单：`onContextMenu` → 菜单项来自 `commands`（F5）或本地常量；首版本地常量，F5 切到命令注册表。
- 确认弹窗：展示计划摘要 + 冲突项 + 目标路径；确认按钮调用 `approve` 再 `execute`。
- 进度面板：订阅 `job:progress`，固定尺寸 + 内部滚动（遵守浮面板几何稳定规则）。
- 拖出：`onDragStart` → `event.preventDefault()` → `call('fileOps','startDrag', paths)`；主进程用 `webContents.startDrag({ file, icon })`，icon 用 `app.getFileIcon(firstPath, { size: 'normal' })`。

**优点**：拖出到资源管理器是"工作台有用"的最直接证据，成本只有几十行。
**代价**：`startDrag` 的 icon 需要 NativeImage，首次可能 100ms 左右；可先用空图标。
**进一步优化**：拖拽时携带 `DownloadURL` 之外的 `text/uri-list`，部分目标程序兼容性更好。

#### F1-3 撤销
**落点**：`data-ops-file-operations` 内部 `undo.ts`。
**范围**：只做可逆的（重命名、新建目录、同卷移动、移动到暂存篮目标）。复制和回收站删除**不进撤销栈**（回收站本身可恢复，UI 提供"打开回收站"）。
**实现**：执行成功后记录逆操作计划（含指纹）；`undo(lastId)` 重新走一遍 plan/execute，但跳过批准（用户主动点撤销）。
**优点**：比 fileatlas 覆盖更多（它的撤销只覆盖标签/评分/重命名）。
**代价**：逆操作同样要指纹校验，目标被占用时不执行。
**进一步优化**：撤销栈持久化到 `data/session.json`，重启后仍可撤销最近 20 步。

#### F1 验收
- `scripts/verify/files.mjs`：创建临时目录 → 复制/移动/重命名/新建/回收站各一次 → 校验磁盘结果与逐项结果一致 → 冲突策略四种各一次 → 计划后改文件触发 `stale` → 清理。
- MCP：`file_copy` 在 `read` 档被拒绝；`standard` 档无批准时超时返回 `pending`；模拟批准后成功。

---

### F2 知识持久化（标注、标签、会话、多栏）

#### F2-1 `data-provider-catalog`（SQLite）
**落点**：主进程 `src/main/plugins/data-provider-catalog/`，提供 Cordis 服务 `db`。
**实现**：M5 的连接、WAL、迁移、事务助手；F2 只建 `meta` / `tags` / `file_tags`，`files` / `folders` 表结构先建好但暂时空着（F4 填入）。
**优点**：标签不依赖索引；后续索引插件直接复用连接。
**代价**：一旦引入原生模块（若 `node:sqlite` 不可用），打包需要额外配置。
**进一步优化**：把 `db` 的公开面收窄为 `query/all/get/run/tx/migrate`，不暴露 `DatabaseSync` 实例，避免插件绕过事务约定。

#### F2-2 元数据迁移
**现状**：`desksuite.explorer.meta` 存在渲染进程。
**做法**：首次启动检测到该 key → 一次性 `call('annotations','importLegacy', map)` → 主进程写入 → 返回条数 → 渲染层写 `desksuite.explorer.meta.v2` 标记后删除旧 key。
**优点**：用户无感迁移；迁移可重入（按 `path_key` upsert）。
**代价**：需要处理"旧 key 存在但导入失败"的重试。
**进一步优化**：导入时把 `favorite/rating/tags` 与 `updated_at` 一起写入，冲突以较新时间为准。

#### F2-3 标注与标签树
**落点**：主进程 `data-ops-annotations`（IPC `annotations`）+ 渲染层 `data-ops-annotations`（左侧标签页 + 编辑器）。
**契约**：

```
annotations.forPaths(paths[])              → { [path]: { favorite, rating, note, tags[] } }
annotations.setFavorite(path, value)
annotations.setRating(path, value)
annotations.assignTag(paths[], tagId)
annotations.unassignTag(paths[], tagId)
annotations.tree() / create / rename / merge / remove
MCP：tag_list / tag_create / tag_assign / meta_rate / meta_favorite
```

**优点**：标签层级、合并、改名是 fileatlas 已验证过的模型，直接照抄语义。
**代价**：合并标签要迁移 `file_tags` 并处理父子环。
**进一步优化**：合并用一条 SQL（`UPDATE OR IGNORE file_tags SET tag_id=? WHERE tag_id=?` + 删旧），避免全表读入内存；拒绝把标签设为自己的后代时用递归 CTE 检查。

#### F2-4 会话与工作区
**落点**：主进程 `system-basic-session`（IPC `session` / `workspaces`），数据走 `store`。
**会话内容**：当前路径、视图模式、排序、筛选、选中路径、滚动锚点、左右栏宽度、展开目录。
**工作区**：命名、布局（1/2/4）、每栏上述状态。
**优点**：fileatlas 的 session 插件只有约 300 行，收益极大。
**代价**：需要防抖写入（500ms），避免每次滚动都写盘。
**进一步优化**：滚动只存"首个可见项的路径 + 偏移比例"，恢复时定位到该项，避免行高变化后错位；这也比存像素更稳。

#### F2-5 多栏
**落点**：`data-ops-explorer` 内部。
**实现**：`createPaneStore(paneId)` 让现有 `explorerStore` 变成可多实例；`ExplorerWorkspace` 按布局渲染 1/2/4 个 `FilePane`；顶部工具栏作用于"活动栏"；`selection` 服务改为 `getSnapshot(paneId?)`，默认活动栏。
**优点**：不动机位槽位系统；每个栏位独立地址/筛选/选择。
**代价**：`explorerStore` 从单例变工厂，所有组件改为从 context 取实例（约 15 个文件的机械改动）。
**进一步优化**：栏间拖放（把文件从 A 栏拖到 B 栏）复用 F1 的 move 计划，而不是另写一套。

---

### F3 加速层（大目录与媒体体验）

#### F3-1 缩略图服务
**落点**：主进程 `data-provider-thumbnails`。
**实现**：

```ts
nativeImage.createThumbnailFromPath(path, { width: 320, height: 320 })
```

- 成功 → `toJPEG(80)` → 缓存于 `<userData>/thumbs/` 下由 SHA-1 键索引的 JPEG 槽位。
- 失败（部分类型）→ 图片用 `nativeImage.createFromPath` + `resize`；再失败 → `app.getFileIcon`。
- 缓存剪枝：按最后访问时间 LRU，总预算 512MB / 2 万条；为遵守插件文件删除守护规则，使用固定 2 万个槽位文件，过期项通过原地截断并复用，不删除路径。
- IPC `thumbnails.get(path, edge) → { dataUrl }`；只返回 240px JPEG（约 10–20KB）。
**优点**：零原生依赖，覆盖视频/PDF/Office 的系统缩略图；画廊不再传 12MB 原图。
**代价**：`createThumbnailFromPath` 仅 Windows/macOS；Linux 需要回退。
**进一步优化**：并发上限 4（系统缩略图提供器是 COM，串行更稳）；失败结果缓存 10 分钟避免反复尝试；渲染层用 `IntersectionObserver` 只在可见时请求。

#### F3-2 分页浏览（解决 2 万截断）
**落点**：`data-ops-filesystem`。
**实现**：`listDir(path, { cursor, limit })`；主进程维护 `Map<path, { mtimeMs, entries, cursor }>` 目录缓存；首批 200 条立即返回，后续 `listMore(path, cursor)` 续读；`fs.opendir` 流式读取 + 并发上限 64 的 `stat`（需要取消/清队列时用 `p-limit@7`）。
**优点**：首屏恒定时间；内存与目录大小解耦。
**代价**：渲染层要支持追加模式（保留滚动位置）。
**进一步优化**：用 `Dirent` 拿不到 size/mtime，必须在主进程 stat；把 stat 结果按 `(path, mtimeMs, size)` 缓存，重复进入目录几乎零 IO。

#### F3-3 目录监视
**落点**：主进程 `data-ops-watch`。
**实现**：只监听"当前目录 + 已固定目录"（上限 16 个），非递归；用 `chokidar@6`（`awaitWriteFinish` + `atomic` 交给它，`interval` 已更名 `pollingInterval`）替代裸 `fs.watch`；400–800ms 去抖仍由我们做；单次最多 200 条路径，超过 → 发送 `invalidate` 让前端整目录刷新；广播 `fs:changed`。
**优点**：外部改动即时可见，且事件量可控。
**代价**：不做全盘递归监视，索引的一致性依赖 F4 扫描。
**进一步优化**：刷新时先比较 `mtime`，目录未变就跳过；`refresh ≠ reload`：保留选择与滚动锚点。

---

### F4 索引与搜索

#### F4-1 扫描流水线
**落点**：主进程 `data-ops-index-scan`。
**实现**：`fs.opendir` 递归、跳过符号链接与可配置忽略目录（`node_modules`、`.git`、`$RECYCLE.BIN`，规则用 `picomatch@4` 匹配）；按目录聚合后每 500 行一个事务 upsert；命中 `path` 冲突时保留 `id` 与标注；遍历完整结束后才删除缺失行；进度走 `jobs`。
**优势**：扫描在后台，浏览不阻塞；可随时取消。
**代价**：大目录扫描 IO 密集。
**进一步优化**：把 stat/哈希放到 `worker_threads`，主进程只做 SQL；两阶段（先入库路径，再补 size/mtime）让搜索先可用。

#### F4-2 搜索
**落点**：主进程 `data-ops-search`。
**实现**：SQL `LIKE` 先跑通（`name`、`path`）；结果限 200 + `total`；排序按匹配位置与最近修改；可选 FTS5 虚表。
**优点**：跨目录搜索，标签/评分可组合过滤。
**代价**：`LIKE '%x%'` 全表扫，10 万行内可接受。
**进一步优化**：FTS5 external content + `prefix` 索引；Everything 作为可选 provider（调用 `es.exe` CLI，不引 SDK），不可用时静默回退 SQL。

#### F4-3 合成数据与基准
**落点**：主进程 `system-basic-dev-lab`。
**实现**：向 `files` 表注入 N 行虚拟路径（指向真实的小图），隔离 profile；提供"清空虚拟数据"；记录首屏可见时间、滚动帧率、内存峰值。
**优点**：把"感觉卡"变成可比较的数字；fileatlas 这一步只做了行数，没有指标。
**代价**：需要 CDP 指标采集（`evaluate.mjs` 扩展）。
**进一步优化**：基准结果写 `artifacts/verify/perf-<date>.json`，每次改动后可对比回归。

---

### F5 平台体验

#### F5-1 设置页
**落点**：渲染层 `system-basic-settings`（浮面板）+ 主进程 schema 注册（M8）。
**首批设置项**：MCP 访问级别与写入根目录、缩略图预算、watcher 去抖、索引根目录、主题。
**边界**：插件启停已经在控制中心实现（渲染层 `desksuite.workbench.plugins`），设置页不重复做启停，只做"每插件设置项"和全局偏好。
**优点**：MCP 权限从 config 文件搬到 UI，普通用户可操作。
**代价**：schema→控件映射表。
**进一步优化**：设置页直接复用 fileatlas 的分组/行/说明结构（见参考文档），但控件由 schema 生成。

#### F5-2 命令面板
**落点**：主进程 `system-provider-commands` + 渲染层 `system-basic-command-palette`（Ctrl+K，挂 `floating.panels`）。
**选型**：列表本身用 `cmdk@1.1.1`（键盘导航、过滤、`aria-*` 自带），容器仍用现有浮面板。
**优点**：一份命令同时喂 UI、快捷键、MCP；`mutating` 标记直接参与权限判定。
**代价**：需要给每个命令定义参数 schema。
**进一步优化**：命令面板显示"AI 可见/仅人工"标记，用户能预期哪些能力会被 MCP 调用。

#### F5-3 启动台
**落点**：主进程 `system-basic-launcher`。
**实现**：开始菜单 `.lnk` + 注册表 Uninstall 键扫描（PowerShell 一次性导出 JSON，缓存 24h）；图标用 `app.getFileIcon`；启动用 `shell.openPath`。
**优点**：桌面工作台的天然入口；比 fileatlas 的 COM/ExtractIconExW 便宜一个数量级。
**代价**：扫描速度依赖 PowerShell 启动（约 1–2s，可后台预热）。
**进一步优化**：图标缓存键 = `exePath + size + mtime`，与缩略图服务共用剪枝逻辑。

#### F5-4 剪贴板升级
**落点**：扩展现有 `system-basic-clipboard` + `data-ops-clipboard`。
**新增**：图片条目（`clipboard.readImage()` → PNG 落盘，SHA-256 去重）、收藏、临时项上限、分类（文本/链接/代码/图片）、MCP `read_clipboard` 支持图片。
**优点**：现有轮询与历史可直接复用。
**代价**：图片存储需要清理策略。
**进一步优化**：图片只存 256px 预览 + 原图路径，避免历史膨胀。

#### F5-5 笔记
**落点**：渲染层 `note-ops-markdown`（域 `note`）+ 编辑器内核 `note-provider-editor` + MCP 驱动面 `note-ops-panel`；文件读写走现有 `filesystem` 与 `fileOps` 计划批准链路。
**格式与资源目标**：`notes/<任意目录>/*.md` + YAML frontmatter（id/category/status/tags）+ 统一资源永久 URI（`desksuite-resource://local/<uuid>/content.<ext>`）+ `[[标题]]` 反链 + `.trash/`。笔记等业务插件只保存图片/附件链接与必要元数据，不复制、上传、转码或保存原始文件，不新建 `assets/` 存储。资源接入与双链仍是待确认实现项，不代表当前代码已完成。
**优点**：文件即真相，可被外部编辑器与 MCP 同时读写。
**选型**：所见即所得内核用 `@milkdown/crepe` + `@milkdown/kit`（同版本锁 7.23.0，MIT），Markdown 是唯一真源：解析 Markdown、序列化回 Markdown，代码块由内核自带的 CodeMirror 渲染（§12.3）。
**边界**：frontmatter、文件列表、标签、反链、保存、归档留在面板侧，不进编辑器内核；图片/附件统一消费现有 `resources` 服务，原件保留在用户原位置。正文保存永久 URI，显示前解析当前版本 URL；不持久化 blob/data URL、base64 或原始文件字节。旧相对引用仅兼容已有原文件，不复制；纯剪贴板图片没有本地源文件时不自动落盘。笔记文本、YAML 与恢复草稿仍按既有链路保存。
**后续清单**：本域的可靠性修复、统一资源链接接入、中文化、检索/组织、双链和序列化策略以 [docs/NOTE_EDITOR.md](NOTE_EDITOR.md) v1.3 为事实源，永久编号 `N1…N40`。2026-10-30 已按用户明确请求实施首轮开发批次；各项已验收、部分实现及未实现状态以该清单为准。

#### F5-6 白板
**落点**：渲染层 `canvas-ops-whiteboard`，用 `@excalidraw/excalidraw`（MIT），场景 JSON 走 `store`，缩略图走 F3-1。
**优点**：不抄 fileatlas 的 Rust 画布引擎（7 文件 451KB，大部分是上游代码）；MIT 许可证可分发。
**代价**：自带完整编辑器 UI（工具栏/菜单是它的，改不成应用外壳风格）；体积约 1MB+。
**边界**：**不能用 tldraw**——其许可证禁止生产环境使用并带 license key 技术强制，理由见 §12.2。
**进一步优化**：场景与素材分文件存，避免单个 JSON 过大；白板缩略图用 Excalidraw 导出接口生成。

#### F5-7 更新
**落点**：主进程 `system-basic-updater`，用 `electron-updater` + GitHub Releases。
**优点**：成熟方案，不需要手写 exe 替换。
**代价**：需要配置发布流水线。

---

## 6. F6 Lore 版本历史（可选，不建议现在做）

### 它是什么

Lore（Epic Games）是面向大文件的版本控制系统。fileatlas 用 `lore-vm` 为每个文件建私有仓库，提供"保存版本 / 切换历史版本 / 分支 / 合并"，历史元数据存 SQLite。完整记录见 [lore-version-history.md](reference/fileatlas/lore-version-history.md)。

### 它踩过的坑（可直接抄，不用重踩）

| # | 坑 | 正确做法 |
| --- | --- | --- |
| 1 | Lore 时间戳是毫秒，被当成秒解析，历史页显示错误日期 | 解析同时接受秒/毫秒/纳秒 |
| 2 | 只按祖先链列版本，回退后更新的版本"消失" | 列完整目录（catalog），不要只列 ancestry |
| 3 | 回退到旧版本后再次保存，报 `Branch has been advanced by another instance` | 先 `unstage` → `sync(本地 tip)` → 复制源文件 → `stage` → `commit` |
| 4 | 离线时 `sync` 传空 revision 报 `No remote configured` | 显式传 `branch.list` 返回的非零本地 tip |
| 5 | 版本身份 = 规范化绝对路径；重命名/移动 = 新历史 | UI 必须明示，或在移动时迁移历史 |
| 6 | 合并冲突只能整文件 ours/theirs，不支持行级 | 不要宣传"行级合并" |
| 7 | 并发读取过多导致资源耗尽 | 限制并发 8，最后一个持有者退出时回收文件锁 |
| 8 | commit 成功但元数据写失败，文件被误标"无版本" | 元数据失败时回读 Lore HEAD 恢复状态 |
| 9 | 版本写一半进程被杀 | 未验证；需要事务式暂存与启动自检 |

### 在 DeskSuite 的落点（如果要做）

- 插件 `data-ops-file-versions`：包装 Lore CLI（`lore` 子进程），不引原生库。
- 元数据放 `data-provider-catalog` 的表（`file_versions`）。
- UI：右侧检查器增加"历史"页（版本列表 + 切换按钮）。
- 成本：CLI 探测、子进程会话、并发锁、冲突状态机，约 1500–2500 行 + 大量 Windows 实测。
- **建议**：F6 排在 F5 之后；如果只是"文件快照/回滚"，用 `data/versions/<hash>/` + 硬链接的成本低一个数量级，先满足 80% 场景。

---

## 7. 评估后不做

| 能力 | 不做的原因 |
| --- | --- |
| QuickLook 命名管道调用 | Electron 内联预览更好，外部依赖不可控 |
| XMP/IPTC 元数据回写 | fileatlas 自己已按用户决定关闭；写图片元数据风险高 |
| ONNX 本地图像分类 | 推理栈不可移植；需要时用云端模型，别塞进主进程 |
| Material 主题生成器 | 与 Tailwind/CSS 变量体系冲突 |
| Fluent i18n | 界面全中文，暂不需要 |
| WorkCrate / VectorCraft 集成 | 强绑定外部 CLI 与专有格式 |
| Eagle 素材库链接 | 仅特定用户群 |
| Lore 版本历史（默认） | 依赖外部二进制，见第 6 章；按需作为 F6 |

---

## 8. 守护与验证

### guard.mjs 新增规则

| 规则 | 理由 |
| --- | --- |
| 渲染层插件禁止 `localStorage`（白名单仅 `desksuite.workbench.*` 与纯 UI 偏好如 `desksuite.explorer.path`/`.view`） | 领域数据必须进主进程，避免再次出现"UI 有、MCP 没有" |
| `mutating` IPC 服务必须在 `MUTATING_SERVICES` 清单内，且只能由 `fileOps` 暴露写方法 | 结构上保证只有一个写执行器 |
| 只有 `services/` 与 `data-provider-catalog` 可以 `import 'node:sqlite'` | 单连接约定 |
| 插件禁止直接 `fs.rename/cp/rm/unlink`（允许 `data-ops-file-operations`） | 所有写操作走计划/批准 |
| 浮面板贡献必须声明固定尺寸 | 沿用现有几何稳定约定 |

### verify 脚本新增

| 脚本 | 用途 |
| --- | --- |
| `scripts/verify/files.mjs` | 计划/批准/执行/冲突/stale/撤销全流程 |
| `scripts/verify/thumbnails.mjs` | 缩略图生成、缓存命中、剪枝 |
| `scripts/verify/annotations.mjs` | 标签树 CRUD、合并、迁移 |
| `scripts/verify/perf.mjs` | 1k/10k/100k 合成数据下的首屏与滚动 |
| `scripts/verify/mcp-guard.mjs` | 三档权限 × 读写工具的矩阵断言 |

所有脚本登记进 `docs/VERIFY.md` 的脚本表。

---

## 9. 令牌表（新增部分）

| 令牌 | 类型 | 位置 | 说明 |
| --- | --- | --- | --- |
| `store` | Cordis 服务 | `services/store.ts` | `register/read/write`，原子 JSON |
| `jobs` | Cordis 服务 | `services/jobs.ts` | `create/get/cancel` + `job:progress`/`job:done` |
| `fileOps` | IPC 服务 | `data-ops-file-operations` | `plan/approve/execute/cancel/get` |
| `annotations` | IPC 服务 | `data-ops-annotations` | 标注与标签树 |
| `thumbnails` | IPC 服务 | `data-provider-thumbnails` | `get(path, edge)` |
| `search` | IPC 服务 | `data-ops-search` | `query` |
| `session` / `workspaces` | IPC 服务 | `system-basic-session` | 会话与工作区 |
| `commands` | Cordis + IPC | `system-provider-commands` | 命令注册/执行 |
| `fs:changed` | 广播 | `data-ops-watch` | `{ dir, paths, invalidate }` |
| `fileOps:approval` | 广播 | `data-ops-file-operations` | 待批准计划 |
| `mcp.access` | 配置 | `config.json` | `off/read/standard/full` |
| `mcp.writeRoots` | 配置 | `config.json` | 允许写入的根目录 |
| MCP 工具 | — | — | `file_copy/move/rename/mkdir/trash`、`tag_*`、`meta_*`、`search_files`、`index_*`、`command_list/run`、`screenshot_window` |

---

## 10. 里程碑

```
F0 安全地基 ──► F1 写能力闭环 ──► F2 知识持久化 ──► F3 加速层 ──► F4 索引/搜索 ──► F5 平台体验 ──► F6 Lore(可选)
      │                 │                  │
      └─ 审计/存储/长任务 └─ 计划-批准-执行   └─ SQLite/标签/会话/多栏
```

依赖关系：

- F1 依赖 F0（批准流程、审计）。
- F2 依赖 M1/M5；不依赖 F1，但 F1 的重命名要与 F2 的 `path_key` 同步（否则标注丢失）。
- F3 独立，可提前穿插。
- F4 依赖 F2（复用 `db`）。
- F5 依赖 F1/F2 的命令与设置项。

---

## 11. 进度台账

依赖选型见第 12 章；"备注"列写明该块用哪个库或为什么自研。状态：✅ 已完成并有验证证据 / ◐ 已实现但未实机验证 / ☐ 未开始。

| 编号 | 内容 | 状态 | 备注 |
| --- | --- | --- | --- |
| F0-1 | MCP 权限闸门 | ✅ | 三档 + `mutating/impact` + 结构化拒绝 + 审计；`mcp-guard.mjs` 20/20 通过 |
| F0-2 | store / jobs / paths 基础服务 | ✅ | `store.mjs` 22 条、`jobs.mjs` 12 条断言通过；文件操作任务结果经 store 持久化 |
| F0-3 | 审计日志 | ✅ | MCP 审计与文件操作写入均验证；MCP 权限矩阵 20/20 通过 |
| F1-1 | 文件写操作服务 | ✅ | `files.mjs` 覆盖计划/批准/指纹、Markdown 写入、冲突/stale、复制/移动/重命名/回收站、撤销、MCP pending 与人工批准 |
| F1-2 | 右键菜单/确认/进度/拖出 | ◐ | 新增 `overlay.root`；Native drag 与 UI 待最终实机运行 |
| F1-3 | 撤销 | ✅ | `files.mjs` 验证移动与重命名撤销；能力限最近 20 项内存栈，重启清空 |
| F2-1 | SQLite catalog | ◐ | 单连接 `node:sqlite`、WAL、迁移与基础表已实现；打包态 WAL/FTS5 待最终验证（§12.6-1） |
| F2-2 | 元数据迁移 | ◐ | 一次性迁移进 SQLite 并移除对应 guard 白名单；待实机回归 |
| F2-3 | 标签树与标注 | ✅ | `annotations.mjs` 验证标签创建、重命名、物化路径、合并迁移和清理 |
| F2-4 | 会话/工作区 | ◐ | 主进程 IPC 与 store 防抖已实现；待 Explorer 消费接入与最终实机运行 |
| F2-5 | 多栏 | ◐ | Explorer pane store 工厂，支持 1/2/4 栏；待实机回归 |
| F3-1 | 缩略图 | ✅ | `thumbnails.mjs` 验证主进程 JPEG 返回与缓存一致性（缓存命中约 4 ms）；渲染层 60 项 / 3.5 MB `localStorage` 缓存已在真实图片目录验证写入与重载恢复，并按文件修改时间区分；格式覆盖率仍取决于 Windows 系统提供器 |
| F3-2 | 分页浏览 | ✅ | `paging-watch.mjs` 验证 501 项跨 3 页无遗漏 |
| F3-3 | 目录监视 | ✅ | `paging-watch.mjs` 验证外部文件变更广播 |
| F4-1 | 扫描流水线 | ✅ | `index-search.mjs` 完成 7,420 项扫描（3,478 文件、3,942 目录） |
| F4-2 | 搜索 | ✅ | `index-search.mjs` 通过 MCP 搜索到 `docs/ROADMAP.md` |
| F4-3 | 合成数据与基准 | ✅ | `perf.mjs` 运行 1k/10k/100k；记录滚动约 61/61/56 FPS |
| F5-1 | 设置页 | ✅ | `settings-commands.mjs` 确认设置 schema 与必需项注册 |
| F5-2 | 命令面板 | ✅ | `settings-commands.mjs` 确认 Ctrl+K 面板与内置命令注册 |
| F5-3 | 启动台 | ✅ | `launcher.mjs` 检查缓存条目、名称过滤与图标 IPC |
| F5-4 | 剪贴板升级 | ✅ | `clipboard.mjs` 覆盖文本/图片历史、收藏清理、PNG 读取、MCP 图片返回并恢复系统剪贴板 |
| F5-5 | 笔记 | ✅ | Milkdown Crepe 所见即所得内核 + `yaml` frontmatter；`notes-editor.mjs` 通过 MCP 全链路（切目录/选笔记/改正文/保存/截图/暗色变量）；后续项见 [docs/NOTE_EDITOR.md](NOTE_EDITOR.md) |
| F5-6 | 白板 | ✅ | `notes-whiteboard.mjs` 验证场景 Store 往返和画布挂载；**tldraw 许可证不允许**（§12.2） |
| F5-7 | 更新 | ◐ | `updater.mjs` 验证只读状态；目录包构建成功。没有配置发布源，真实更新检查/下载/安装未覆盖 |
| F6 | Lore 版本历史 | ☐ | 可选 |

---

## 12. 开源库选型

> 2026-10-28 调研。目标：把第 5 章里"自己写"的部分换成成熟库；只有**没有合适库**、**库会引入原生模块**、或**许可证不允许**时保留自研。
> 依据：npm registry 元数据（版本 / `license` / `type` / `engines`）+ 本机 Electron 40.10.6（内置 Node 24.15.0）实测。

### 12.1 五条约束

1. **先用平台内置。** 本路线图里最难的几块 Electron 已经内置：`node:sqlite`（含 FTS5、WAL，已在本机实测通过）、`nativeImage.createThumbnailFromPath`、`shell.trashItem`、`shell.readShortcutLink`、`webContents.startDrag`、`fs.opendir`、`fs.watch({ recursive: true })`。内置能力不占依赖、不受许可证约束，优先级高于任何 npm 包。
2. **主进程是 CJS + `externalizeDepsPlugin()`。** 依赖不打包，运行时直接 `require`，所以纯 ESM 库（chokidar 6、p-limit 7、marked 18、file-type 22、electron-store 12…）不能直接 require。接法只有两种：`externalizeDepsPlugin({ exclude: ['x'] })` 打进 main bundle，或在插件内 `await import('x')`。下表逐项标注。
3. **许可证只接受 MIT / ISC / Apache-2.0 / BSD。** 排除 source-available、带 license key 技术强制、带署名水印的库（见 12.2）。
4. **不引原生模块（`.node`）。** 引了就要 `electron-rebuild`、按 ABI 分发。本轮选型里没有任何一项需要破例。
5. **一个能力只装一个库，备选只登记不安装。** 依赖表要能一眼看完。

### 12.2 关键否决：tldraw

原 F5-6 写"直接用 tldraw"。核对其 `LICENSE.md`（v5.5.2，`license: "SEE LICENSE IN LICENSE.md"`）后**不成立**：

- 只允许 Development Environment 使用；`Production Environment` 定义为"任何面向最终用户的部署"，本应用打包分发命中该定义。
- 条款禁止"禁用、修改或干扰 License Key 的强制校验"，源码内含有效性校验与部署环境检测（技术强制）。
- 未取得商业 License Key 时会有可见署名/水印。

结论：白板改用 **`@excalidraw/excalidraw` 0.18.1（MIT，peer 明确支持 React 19）**。代价是它自带完整编辑器 UI，无法改成应用外壳的视觉风格——这条写进 PORTS 作为已知边界。若产品必须 tldraw 的交互模型，则走商业授权，不在本路线图范围。

### 12.3 选型总表

| 能力 | 原计划自研 | 首选 | 版本 | 许可 | 形态 | 接入 | 说明 |
| --- | --- | --- | --- | --- | --- | --- | --- |
| F0-2 原子 JSON 写 | 60 行（tmp+fsync+rename+.bak） | ~~write-file-atomic 8.0.0~~ → 自研 | — | — | — | — | 库只做单次写入；本项目还要版本信封、`.bak` 回退、按 key 串行，原子替换实际只有 ~15 行，已实测通过 |
| F0-1 / M8 参数校验 + JSON Schema | 150 行 | **zod** | 4.6.7 | MIT | CJS+ESM | 已在依赖里 | `z.toJSONSchema()` 内置，不需要 ajv |
| F1-1 删除到回收站 | 80 行 Win32 FFI | **`shell.trashItem`** | 内置 | — | — | — | 跨平台 |
| F1-1 复制/移动 + 进度 | 300 行 | **`fs.cp` + 自管计数** | 内置 | — | — | — | 进度按文件数；不引 progress-stream（2017 年后无更新） |
| F1-1 类型嗅探 | 120 行魔数表 | file-type | 22.2.0 | MIT | ESM | main 内 `await import()` | 仅在缩略图回退/预览判定需要时加 |
| F1-2 拖出到系统 | — | **`webContents.startDrag`** | 内置 | — | — | — | 不需要额外库 |
| F1-3 撤销 | 200 行 | 反向操作日志（复用 F1 计划） | — | — | — | — | 没有通用库；撤销单位是"计划" |
| F2-1 数据库 | 大 | **`node:sqlite`** | 内置 | — | — | — | 已实测 FTS5/WAL，省掉 better-sqlite3 + rebuild |
| F2-1 查询构建 | — | 裸 SQL + 预编译语句 | — | — | — | — | 见 12.4 |
| F2-1 迁移 | 40 行 | **`PRAGMA user_version`** | 内置 | — | — | — | 不需要 migration 框架 |
| F2-3 标签树 | — | 物化路径列 + SQL | — | — | — | — | 不需要 ltree 类库 |
| F3-1 缩略图 | 大（含 ffmpeg） | **`nativeImage.createThumbnailFromPath`** | 内置 | — | — | — | 走系统缩略图提供器，覆盖图片/视频/PDF/Office |
| F3-1 图片尺寸 / EXIF | 200 行 | image-size 2.0.4（+ 可选 exifr 7.1.3） | MIT | CJS | `require` | exifr 最后发布于 2021，只在真要 EXIF 时加 |
| F3-2 虚拟滚动 | 已有 120 行 | 保留现有；可选 **@tanstack/react-virtual** | 3.14.23 | MIT | ESM | renderer 打包 | 见 12.4 |
| F3-3 目录监视 | 400 行 | **chokidar** | 6.0.0 | MIT | ESM | main 内 `await import()` | 要求 Node ≥22.22（本机 24.15 满足） |
| F3 / F4 并发上限 | 25 行 | p-limit | 7.3.3 | MIT | ESM | 同上 | 只需要固定批次时可退回分批循环 |
| F4-1 忽略规则 | 60 行 | picomatch | 4.0.7 | MIT | CJS | `require` | 需要 `.gitignore` 语法时 |
| F4-1 全盘扫描 | — | **`fs.opendir` + `utilityProcess`** | 内置 | — | — | — | CPU 密集才下沉，I/O 密集留在主进程 |
| F4-2 搜索 | — | **SQLite FTS5** | 内置 | — | — | — | 不需要独立搜索引擎 |
| F4-2 前端即时过滤 | — | 现有子串过滤；可选 fuse.js 7.5.0 | Apache-2.0 | ESM | renderer | 体积换模糊匹配，非必需 |
| F5-1 设置表单 | 300 行 | **zod schema + 控件映射表** | — | — | — | — | 见 12.4 |
| F5-2 命令面板 | 300 行 | **cmdk** | 1.1.1 | MIT | CJS | renderer | 自带键盘导航、过滤、无障碍语义 |
| F5-3 启动台 | — | **`shell.readShortcutLink` + PowerShell** | 内置 | — | — | — | 不要引 .lnk 解析库 |
| F5-4 剪贴板历史 | 大 | **`clipboard` + SHA-256 去重** | 内置 | — | — | — | 图片存 PNG，不引库 |
| F5-5 Markdown 所见即所得 | 大 | **@milkdown/crepe** + **@milkdown/kit** | 7.23.0 | MIT | ESM | renderer | 代码块用内核自带的 CodeMirror，公式用 KaTeX；Markdown 是唯一真源，组件样式必须按特性逐个引入 `theme/common/*.css` |
| 白板内联 HTML 净化 | 少量 | **dompurify** | 3.4.17 | MPL-2.0\|Apache-2.0 | CJS | renderer | 笔记不做 HTML 渲染，只有 `canvas-ops-whiteboard` 需要净化 |
| F5-5 frontmatter | 60 行 | yaml | 2.9.1 | ISC | CJS | renderer | 面板解析/回填 YAML 头；不要用 gray-matter（2021 年后无更新） |
| F5-6 白板 | 大 | **@excalidraw/excalidraw** | 0.18.1 | MIT | ESM | renderer | 见 12.2；样式是它的，不可改 |
| F5-7 自动更新 | 大 | **electron-updater** + electron-builder | 6.8.11 / 26.18.0 | MIT | CJS | main / dev | 需要发布流水线 |
| 验证脚本 | 已有 6 个 | 保留 CDP 脚本；可选 @playwright/test | 1.64.1 | Apache-2.0 | CJS | devDep | 见 12.4 |

### 12.4 有争议项的取舍理由

**SQLite 访问层：为什么不用 ORM。**
- `drizzle-orm` 0.45.4 的 SQLite 驱动只有 better-sqlite3 / bun / d1 / durable / expo / libsql / op / sql-js / sqlite-proxy / prisma，**没有 `node:sqlite`**；`sqlite-proxy` 是异步回调接口，套同步 `DatabaseSync` 还要自己造一层 Promise。
- `kysely` 0.29.7 只有泛型 `SqliteDialect`，要自己实现 `SqliteDatabase` / `SqliteStatement` 接口（约 40 行）并手写类型；且它是 ESM-only，得打包或动态 import。
- 本项目查询形状很窄（按目录列、按 id 取、按 FTS 查、upsert）。裸 SQL + `prepare()` 缓存在 `data-provider-catalog` 内部即可，不引入元数据体积。
- **结论：都不装。** 若 F4 出现多表 join 组合爆炸，再在 provider 内部加 kysely（影响面只在一个插件）。

**设置表单：为什么不引 @rjsf/core。**
- `@rjsf/core` 6.11.0 是 JSON Schema 驱动，但自带主题与 widget 层；要让它长得像本应用，15 个控件的适配成本不低于自己写映射。它还依赖 ajv 在前端校验，与"渲染器只画、主进程校验"的约定冲突。
- 已有 zod 4，`z.toJSONSchema()` 内置（无需 ajv），schema 本来就由主进程持有。设置页只需要 8 种控件（布尔、枚举下拉、分段、数字、文本、路径、只读、动作），映射表约 200 行。
- **结论：不装。** 将来需要嵌套对象/数组表单时，再引 @rjsf/core 并为它写一套 widget。

**虚拟滚动：替换现有实现吗。**
- 现有 `useVirtualizer.ts` 只做"窗口内渲染 + 固定行高"，缺动态行高、滚动到索引、横向虚拟化；`@tanstack/react-virtual` 覆盖这些且 headless（不带样式）。
- 但 F3-2 的真正瓶颈是数据源全量常驻内存，换虚拟库不解决。先做窗口化数据结构。
- **结论：暂不替换**，登记为 F3-2 的可选依赖。

**目录监视：chokidar 还是自己包 `fs.watch`。**
- Node 24 在 Windows 已支持 `fs.watch({ recursive: true })`，chokidar 6 正是在它之上做 lstat 复核，把事件风暴收敛成最终状态，并处理 `awaitWriteFinish`。自己写等于重写这套复核。
- 风险：v6 是 2026-10 的新大版本（`interval`→`pollingInterval`、`close()` 后 `add()` 抛错、新增 `backend` 选项），示例少。出问题可回退 chokidar 4.0.3（同为 MIT，API 更稳）。
- **结论：采用 chokidar 6 并锁版本**，回退路径写进 PORTS。

**并发：p-limit 还是手写。**
- 需求只是"最多 8 个 stat 并发"，手写 20 行；但 p-limit 还提供 `clearQueue` / `activeCount`，取消扫描时用得上，体积约 3KB。
- **结论：F3 引入 p-limit**；若实测只需固定批次，改回分批循环。

**验证脚本：换 Playwright 吗。**
- `@playwright/test` 1.64.1 提供 `_electron.launch()`（已核对类型定义存在），可直接启动 Electron、在主进程 `evaluate`、自动等待、trace、失败截图，比手搓 CDP 的 `launch.mjs` / `evaluate.mjs` 强。
- 但现有 6 个脚本已在用，路径与产物约定写进了 AGENTS.md，替换要同步改文档与全部脚本。
- **结论：本轮不换。** 等 verify 脚本超过约 10 个、或需要断言主进程内部状态时，整体迁到 Playwright（脚本仍放 `scripts/verify/`，产物仍落 `artifacts/verify/`）。

**日志：为什么不用 electron-log。**
- 现有 `system-basic-runtime-log` 是内存环形缓冲 + MCP 查询，缺落盘轮转。electron-log 5.4.4 解决文件轮转，但它是全局单例、会接管 console，和 Cordis 插件生命周期不匹配。
- **结论：审计自己 append `audit.jsonl`；运行日志用 `fs.createWriteStream` + 按天轮转，不引库。**

**确实没有库、必须自己写的部分。** 这些正是本项目的工作量所在，也是差异点，不要指望依赖能省掉：

1. 计划 / 批准 / 执行（M3）：没有通用库能表达"人工批准 + 指纹 + 过期"。
2. 路径规范化与 `path_key`（大小写折叠、UNC、符号链接）：Windows 语义只有自己定义才准确。
3. 两阶段扫描 + 冲突保留 `id`：绑定自家 schema。
4. 缩略图预算与剪枝：绑定自家缓存表。
5. 标签树（物化路径）与合并/迁移规则。
6. 撤销（F1-3）：撤销单位是"计划"，需要反向操作日志，没有库能代劳。

### 12.5 按批次的依赖清单

| 批次 | 运行期新增依赖 | 数量 |
| --- | --- | --- |
| F0 | 无（`write-file-atomic` 经评估不需要，见 12.3；zod 已在依赖中） | 0 |
| F1 | 无 | 0 |
| F2 | 无 | 0 |
| F3 | `chokidar@6.0.0`、`image-size@2.0.4`、`p-limit@7.3.3`（可选） | 2–3 |
| F4 | `picomatch@4.0.7`（可选） | 0–1 |
| F5 | `cmdk@1.1.1`、`@milkdown/crepe@7.23.0`、`@milkdown/kit@7.23.0`、`dompurify@3.4.17`、`yaml@2.9.1`、`@excalidraw/excalidraw@0.18.1`、`electron-updater@6.8.11` | 7 |
| 仅开发 | `electron-builder@26.18.0` | 1 |

F0–F2 目前不新增任何依赖——它们全部落在 Electron/Node 内置能力与 zod 上。可选但**不装**的登记项：`write-file-atomic`、`file-type`、`exifr`、`fuse.js`、`@tanstack/react-virtual`、`@playwright/test`、`electron-log`、`marked`（笔记走所见即所得内核，不搭 HTML 渲染管线）。

### 12.6 落地前必须实测（写进 F0 的验证脚本）

| # | 项 | 为什么不能拍板 |
| --- | --- | --- |
| 1 | `node:sqlite` 在**打包后**打开 WAL + FTS5 | 开发态已通过；DB 必须在 `userData`（可写），不能放 asar 内，打包态未验证 |
| 2 | ESM-only 库进 main | `externalizeDepsPlugin({ exclude })` 打包 vs 插件内 `await import()`，先写最小插件对比体积与启动耗时 |
| 3 | `createThumbnailFromPath` 对 mp4/PDF/docx 的出图率与耗时 | 依赖系统缩略图提供器，Win10/11 与旧系统差异大 |
| 4 | Excalidraw 在 Electron renderer 的体积与资源 | 需 `import '@excalidraw/excalidraw/index.css'`，离线字体/图片是否齐全 |
| 5 | cmdk 是否必须套 Dialog | 它依赖 `@radix-ui/react-dialog`，而本应用有 `floating.panels` 容器 |
| 6 | `z.toJSONSchema()` 输出够不够画设置页 | 已在本机 zod 4.6.7 实测：`boolean`/`enum`/`default`/`description` 都能正确输出（draft 2020-12）。注意带 `default` 的字段仍出现在 `required` 里，渲染器要按"有 default 即非必填"处理；`z.number` 的 min/max 与自定义控件类型需再加 `x-ui` 注解 |
| 7 | electron-updater 与 electron-vite 产物约定 | `app-update.yml`、`latest.yml` 的生成位置需要 electron-builder 配置 |

### 12.7 本章对前文的修订

- **F5-6 白板：tldraw → `@excalidraw/excalidraw`**（理由见 12.2）。
- **§1 增加第 6 条结论**：能用内置能力就不装库。
- F0 台账备注补"先跑 12.6 的 1、2、6 三项"。
