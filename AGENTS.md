# DeskSuite 项目约定

React 19 + Electron 40 + Vite 8（electron-vite 6）+ Cordis 4 插件容器。主进程是唯一的插件运行时，渲染进程是纯 React 界面。

## 架构

```
src/main/
  app.ts            # 创建根 Context，按序启动内置服务，import.meta.glob 自动聚合插件
  paths.ts          # 打包版 userData 重定向到安装目录 data\；必须保持为 index.ts 第一个 import
  services/         # 内置服务（Service 子类，手工生命周期）
    config.ts       #   config：userData/config.json 读写
    ipc.ts          #   ipc：bridge:invoke 路由 + bridge:event 广播
    mcp.ts          #   mcp：MCP 工具注册表 + 本机 HTTP 服务器（唯一监听点）
    window.ts       #   window：唯一的 BrowserWindow 创建点（无边框窗口）
  plugins/          # 业务功能一律写成 Cordis 插件；命名 <域>-<子类>-<名称>，每插件一个文件夹 + PORTS 契约文档
    demo-basic-greet/         #   域 demo / 子类 basic / 名称 greet（最小示例）
    data-ops-filesystem/      #   域 data / 子类 ops / 名称 filesystem（文件系统 IPC + 文件 MCP 工具）
    system-basic-app-tools/   #   域 system / 子类 basic / 名称 app-tools（基础 MCP 工具）
    system-basic-window-controls/ # 无边框窗口控制
    system-basic-clipboard/   #   系统剪贴板 IPC + MCP
    system-basic-runtime-log/ #   主进程日志缓冲与运行时信息
src/preload/index.ts  # 只暴露唯一桥 window.bridge（invoke / onEvent）
src/renderer/
  src/workbench/      # 宿主：容器 + 槽位 + 布局/主题/日志状态 + 服务注册表 + SDK，不含可视界面
  src/plugins/        # 渲染层插件：外壳、UI 原语、所有界面组件；命名规则同主进程插件
scripts/guard.mjs     # 架构守护检查（dev 启动前自动执行）
scripts/verify/       # 实机验证与调试脚本（CDP / MCP / 截图），用法见 docs/VERIFY.md
```

## 验证脚本约定（强制）

1. 所有测试、调试、验证脚本一律放在 `scripts/verify/`，基于 `common.mjs` 复用 CDP/MCP 工具函数；**禁止**把这类脚本写到系统临时目录或其他仓库外路径。
2. 产物（截图、应用日志、pid）统一写入 `artifacts/verify/`，该目录已被 gitignore；脚本路径/输出目录可经 `DESKSUITE_CDP_PORT`、`DESKSUITE_MCP_URL`、`DESKSUITE_VERIFY_DIR` 覆盖。
3. 应用必须由 `node scripts/verify/launch.mjs` 启动（自动移除 `ELECTRON_RUN_AS_NODE`、附加 `--remote-debugging-port`），结束用 `node scripts/verify/stop.mjs`。
4. 界面断言优先经 `evaluate.mjs` 读取 DOM/几何；截图统一走 `capture_window` MCP 工具（内部已 `invalidate()`，避免窗口遮挡时拿到上一帧）。
5. **应用功能验收只能通过 DeskSuite 自身 MCP 工具或基于 MCP 的验证脚本执行状态变更与功能操作。禁止使用电脑操控、鼠标键盘自动化、DOM click/dispatch 或系统对话框自动化来代替 MCP 操作。** `evaluate.mjs` 仅用于只读 DOM/状态/几何检查，`capture_window` MCP 用于截图。如果目标能力缺少 MCP 入口，应先补齐对应插件 MCP 工具和验证脚本，再通过 MCP 验收；不能绕过 MCP 缺口直接操控界面。
6. 新增脚本须在 `docs/VERIFY.md` 的脚本表中登记用途与示例。
7. **开发和验收阶段使用 MCP 最高权限 `full`。** 启动验证实例时显式传入 `--access full`；使用隔离 profile，并把可写根限定在 `artifacts/verify/samples`。这条规则只适用于开发/验证实例，不改变发行版默认权限策略。

## 批次开发验收（强制）

把同一阶段或相互依赖的小改动合并为一个开发批次。一个批次的代码、插件契约、验证脚本和文档全部收齐后，再统一运行 `guard`、`typecheck` 和需要的生产构建，并启动验证实例，通过 DeskSuite 自身的插件 MCP 验收本批全部相关能力，使用 MCP 截图并查看结果。不要因为单个小问题或单个子任务反复构建、启动和截图。多个隔离 profile 的验证可以在同一批次中顺序执行；若无需更换 profile，应复用同一应用实例和构建产物。

若批次验收发现问题，只在产品代码变化后重跑受影响的静态检查/构建，并重跑受影响的 MCP 场景与截图；如果只调整文档或验证报告，不重复生产构建。静态检查、单元测试或代码审查不能替代该批次所需的 MCP 实机验收。具体步骤见 `docs/VERIFY.md` 的“批次开发后的 MCP 与截图确认（必做）”。

## 插件开发规则（强制）

1. 业务功能必须写成 `src/main/plugins/<域>-<子类>-<名称>/` 下的 Cordis 插件（**每个插件一个独立文件夹，入口 `index.ts`**，辅助文件都留在插件文件夹内），`export default { inject, apply }` 对象式，通过 `inject` 声明依赖。
   - **命名规范**：三段及以上 kebab-case。**域**（第一段）= 产品功能大类：`data`（数据操作/扩展）、`canvas`（画布）、`note`（笔记）、`project`（项目管理）、`system`（程序自身）、`demo`（示例）；新增域需同步加进 guard.mjs 的 DOMAINS 列表。**子类**（第二段）= 域内的功能分类：操作/转换类用 `ops`（如 `data-ops-*` 通用数据处理）、格式/扩展类用 `ext`（如 `data-ext-*` 数据格式扩展）、对外提供共享能力的用 `provider`（如 `system-provider-thumbnail` 程序级缩略图提供）。**名称** = 唯一标识。
   - **提供型插件（provider）**：为其他插件提供共享能力的插件（如缩略图、通用数据处理）。在 `apply` 内用 `ctx.reflect.provide('<服务名>', 实现)` 注册服务（随插件卸载自动回收），服务名用 camelCase，类型经 `declare module 'cordis'` 声明合并导出。**跨插件协作的唯一通道是服务注入**：消费方 `inject: ['<服务名>']`，严禁文件级 import。
   - **同域拆分**：一个大功能域（如画布）拆成多个小插件文件夹，共享域前缀（`canvas-shapes-*`、`canvas-text-*`…），各自独立自动加载、独立维护契约，禁止相互 import。
   - **插件内部子模块**：单个插件文件夹内部可以有子文件/子目录（作为内部实现，不会被注册为独立插件），对外契约一律以该插件的 PORTS 文档为准。
   - **契约文档**：每个插件文件夹内必须维护 `PORTS.md`（英文）与 `PORTS_ZH.md`（中文），说明元数据（域/子类/名称/入口）、inject 依赖、提供的 IPC 服务、MCP 工具、广播事件、消费的配置项。新插件落地时同步创建，接口变更时同步更新。守护脚本强制存在。
   - **禁止 import 其他插件的任何文件**；插件相对导入只允许 `./`（自己文件夹内）和 `../../services/`（内置服务的类型与工具函数，按目录深度调整 `../` 层级），守护脚本会拦截越界导入。
2. **插件全自动发现**：app.ts 用 `import.meta.glob('./plugins/*/index.ts')` 聚合，新建插件文件夹（含 index.ts）即自动加载。禁止为接入插件而修改 app.ts、services、preload 等基础文件；守护脚本会拦截静态 import 插件的行为。
3. 插件对渲染进程暴露能力，只能通过 `ctx.ipc.handle(service, methods)` 注册；事件推送用 `ctx.ipc.broadcast(channel, payload)`。渲染层调用：`window.bridge.invoke(service, method, ...args)`。新注册的服务会自动出现在 `system.services` 聚合列表中。
4. 禁止在 `window.ts` 之外创建 `BrowserWindow`；窗口能力走 `ctx.window` 服务。
5. 渲染进程禁止 import `electron`，只能用 `window.bridge`。
6. preload 禁止新增第二个 `exposeInMainWorld`，桥的名字固定为 `bridge`。
7. 新插件完成后跑 `npm run guard` + `npm run typecheck`。

## 渲染层插件开发规则（强制）

**界面框架、每个界面的框架、每个组件都必须落在各自的渲染层插件里，不得写入基础程序（`src/renderer/src/workbench/`）。**

1. 渲染层插件位于 `src/renderer/src/plugins/<域>-<子类>-<名称>/`（入口 `index.tsx`，`PORTS.md` + `PORTS_ZH.md` 必须存在），命名/域白名单与主进程插件完全一致。
2. 插件对象用 `definePlugin({ id, name, version, description, author, core, contributions, services, setup })`，`id` 必须等于文件夹名；`contributions` 声明槽位贡献（`id/slotId/order/title/icon/badge/component/label`），`services` 注册跨插件服务（重名抛错），`setup` 做初始化并返回清理函数。`core: true` 的核心插件在控制中心不可停用。
3. **唯一宿主入口是 `workbench/sdk`**：插件只能 `import ... from '../../workbench/sdk'`（按深度调整 `../`），禁止引用 `workbench/` 内部其他文件，禁止引用其他插件文件；`sdk.ts` 不得反向 import `registry.ts`（避免循环依赖）。
4. 宿主 `workbench/` 只负责容器职责：Provider 串联（`app.tsx`）、槽位分发（`slot-context.tsx`）、布局/主题/日志状态、服务注册表、bridge API、SDK、自动发现（`registry.ts` 的 `import.meta.glob('../plugins/*/index.tsx')`）与插件启停（`desksuite.workbench.plugins`）。宿主禁止静态 import 插件。
5. 槽位：`app.root`、`top.actions`、`top.window_controls`、`sidebar.activity`、`sidebar.activity.bottom`、`sidebar.left.tabs`、`sidebar.left.content`、`workspace.toolbar`、`workspace.views`、`sidebar.right.tabs`、`sidebar.right.content`、`bottom.tabs`、`bottom.toolbar`、`bottom.content`、`statusbar.left`、`statusbar.right`、`floating.panels`。标签页与内容共享贡献 `id`（同一槽位内唯一）；`label` 组件可为页签提供动态文案/徽标；`sidebar.activity.bottom` 是活动栏底部固定组；顶栏不放业务导航（路径面包屑属于 `workspace.toolbar`）；悬浮面板挂到 `floating.panels`，由外壳统一承载挂载点。
6. UI 原语必须经由 `ui` 服务（`useUiKit()`）获取，实现属于 `system-provider-ui-kit`；外壳属于 `system-basic-shell`，二者都不得移回宿主。
7. 渲染层跨插件协作只允许渲染层服务（`getService` / `useSyncExternalStore`），可选服务缺失时必须降级而不是崩溃；能力数据一律经 `window.bridge.invoke`（`call()`）获取。
8. 悬浮面板保持固定像素尺寸 + 内部滚动，页签切换不得导致面板位移或尺寸跳变；界面文案使用中文。
9. 插件启停只影响渲染层槽位与 `setup` 生命周期；已注册的渲染层服务不随停用回收（已知限制），停用状态持久化在 `localStorage` 的 `desksuite.workbench.plugins`。

## LeaferJS 开发约定（强制）

涉及 LeaferJS 的新增、修改、审查或答疑，优先使用已安装的 Codex `leafer-ai` 技能，并按技能指引优先查阅 `leaferjs/ai-docs`。DeskSuite 集成边界、允许的 LeaferJS 导入位置和资源生命周期规则见 `docs/LEAFERJS.md`；`scripts/guard.mjs` 会约束代码中的 LeaferJS 包导入位置。技能与文档规则同时适用于画布功能、图片预览和共享资源服务。


## MCP 工具注册约定（强制）

应用在本机暴露一个 MCP 服务器（Streamable HTTP，无状态），外部 AI 直连即可调用所有插件的能力：

- 地址：`http://127.0.0.1:9600/mcp`（端口存于 config.json 的 `mcp.port`，仅监听 127.0.0.1）
- **其他插件要暴露能力给 AI 时**：`inject: ['mcp']`，然后 `ctx.mcp.registerTool(name, { description, inputSchema?, execute })`。工具自动聚合进 tools/list，无需改任何基础文件。
- `execute` 返回 `McpToolResult`：文本用 `mcpText()`，图片用 `{ type: 'image', data: base64, mimeType }`，失败用 `mcpError()`（均从 `services/mcp` 导入）。
- 工具名全局唯一，重复注册会抛错；命名用 snake_case 动词短语（如 `capture_window`）。
- 禁止在 `services/mcp.ts` 之外创建任何网络监听（createServer/.listen），守护脚本会拦截。
- 内置基础工具（`system-basic-app-tools`）：`get_app_info`、`list_windows`、`control_window`、`capture_window`、`capture_screen`；`data-ops-filesystem` 提供 `list_drives`、`list_directory`、`read_text_file`；`system-basic-clipboard` 提供 `read_clipboard`、`write_clipboard`；`system-basic-runtime-log` 提供 `get_runtime_logs`、`clear_runtime_logs`。

## 命令

- `npm run dev` / 双击 `start-dev.bat`：开发（守护检查 → 更新依赖 → 清理 5173 → 启动，热重载）
- `npm run build` + `npm run preview`：生产构建与预览。本地构建会重新生成 `native/lore-bridge/bin/desksuite-lore-bridge.exe`；**不要提交或推送本地产物**，该二进制由 GitHub Actions 在 Lore 源码变更时编译并提交，普通程序文件变更不会触发 Rust 编译。
- `npx electron-vite build`：只构建主进程/preload/渲染层，不编译 lore-bridge。**开发阶段需要生产产物时用这个命令，避免使用 `npm run build`。**
- `npm run guard`：架构守护检查
- `npm run typecheck`：类型检查
- 实机验证（详见 `docs/VERIFY.md`）：
  - `node scripts/verify/launch.mjs [--build]` / `node scripts/verify/stop.mjs`：启动/停止带 CDP 的应用实例。`--build` 会触发 Rust 编译，**开发阶段不要使用**
  - `node scripts/verify/mcp.mjs smoke`：MCP 工具列表与基础调用冒烟
  - `node scripts/verify/evaluate.mjs '<表达式>'`：在渲染进程执行 JS（DOM/几何断言）
  - `node scripts/verify/capture.mjs [--screen]`：窗口/整屏截图到 `artifacts/verify/`
  - `node scripts/verify/errors.mjs`：重载渲染进程并收集异常/警告
  - npm 别名：`verify:launch`、`verify:stop`、`verify:smoke`、`verify:shot`、`verify:errors`

## 注意事项

- Windows 下 bat 脚本必须纯 ASCII（中文 + chcp 65001 会被 cmd 错位解析）。
- 主进程与 preload 输出固定为 CJS（`out/main/index.cjs`、`index.cjs`），配置见 `electron.vite.config.ts`，不要改回 ESM；`package.json` 的 `main` 指向 `.cjs`。
- 深色主题依赖 `.dark` 类，`src/renderer/src/index.css` 必须保留 `@custom-variant dark (&:where(.dark, .dark *))`，否则 Tailwind v4 会退回系统偏好、主题开关失效。
- cordis 锁定 4.0.0-rc.x 精确版本；升级前先确认 API 变化（Service 基类构造即注册，start/stop 为自行约定的生命周期）。
- 开发阶段不要运行任何触发 Rust 编译的命令（`npm run build`、`npm run build:lore-bridge`、`npm run build:lore-bridge:debug`、`launch.mjs --build`）。`npm run dev` 在 `native/lore-bridge/bin/desksuite-lore-bridge.exe` 存在时会自动跳过编译；只有 Lore Rust 源码/构建配置/二进制路径变更、手动触发工作流或推送 Lore 版本标签时，GitHub Actions 才编译并提交二进制；普通程序文件提交不触发 Rust 编译。
- 安装版（packaged）userData 固定重定向到安装目录 `data\`（`src/main/paths.ts` 探测可写后 `setPath`，不可写如 Program Files 时回落 `%APPDATA%`）。`build/installer.nsh` 的 `customRemoveFiles` 保证安装/升级/卸载只清程序文件、不删除 `data\`。开发模式与 `--user-data-dir`（验证 profile）不受影响。发布：推送与 package.json 版本一致的 `v*` 标签触发 `.github/workflows/release.yml`，CI 产出安装包 + `latest.yml` 传 GitHub Releases；更新源在应用设置的「应用更新」里填 GitHub 仓库地址。
