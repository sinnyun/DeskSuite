# 实机验证与调试脚本

`scripts/verify/` 下的 Node 脚本用于对**已构建**的 DeskSuite 做端到端检查：MCP 操作主进程能力，CDP 只读检查界面，MCP 截图留证。所有脚本共用 `common.mjs` 的连接与工具函数，产物统一写入 `artifacts/verify/`（已在 `.gitignore` 中忽略）。

## 前置条件

- Node 22+（脚本直接使用全局 `fetch` / `WebSocket`）
- 先执行 `npx electron-vite build` 生成生产产物（`out/renderer` 等）。**开发阶段不要执行 `npm run build` 或 `launch.mjs --build`**，它们会触发 Rust 编译 lore-bridge；`npm run build` 还会覆盖被跟踪的 `native/lore-bridge/bin/desksuite-lore-bridge.exe`（该二进制由 GitHub Actions 维护，如误覆盖用 `git restore native/lore-bridge/bin/desksuite-lore-bridge.exe` 还原，不要提交或推送）。
- 应用必须由 `launch.mjs` 启动：它会移除 `ELECTRON_RUN_AS_NODE`、附加 `--remote-debugging-port`，并把 pid / 日志写入产物目录

## 脚本一览

| 脚本 | 作用 | 示例 |
| --- | --- | --- |
| `explorer-view-composition.mjs` | 六种分组/内容视图组合、统一卡片样式、单列画廊左栏/唯一预览/20:80 几何、递归选择、列表虚拟化、四种分组方式、旧 grouped 迁移与重启恢复 | 先运行 `explorer-concept.mjs` 建立样例；隔离 full 实例中运行本脚本，同 profile 重启后 `--check-restart` |
| `explorer-concept.mjs` | 概念图布局验收：MCP 目录/视图/选择/评分/收藏与书签，浅深主题截图、2048/1280 宽度布局检查；复制样例目录的 PNG 到隔离 samples | 隔离 full 实例（write-root samples），设置 MCP/CDP 环境变量后 `node scripts/verify/explorer-concept.mjs [PNG样例目录]` |
| `version-action-recovery.mjs` | 验证生产 UI 命令计划的批准/执行协议、恢复拒绝不污染同步错误、空标题保存自动命名、源文件哈希不变以及保存按钮 DOM 状态 | 本脚本 `--prepare`；全新 profile `version-action-recovery`，full，write-root samples；分别 `--seed-one`、停机 `--edit-two`、重启 `--seed-two`、停机 `--edit-one`、重启后不带参数验收 |
| `version-storage.mjs` | 版本信息数据库查询与 Lore 操作分离；反复查询零 Lore 启动、指纹补齐、创建/恢复/分支后原子更新及重启持久化；显式旧库同步保留原文件哈希 | `node scripts/verify/version-storage.mjs --prepare`；profile `artifacts/verify/profiles/version-storage`、full、write-root `artifacts/verify/samples`；运行脚本，重启后 `--check-restart`；实际实例 `--reconcile-existing` |
| `lore-restore.mjs` | Shot 007 真实恢复现场隔离备份、恢复重试、01/03/02 连续切换与 MCP 任务错误查询；原文件模式仅完成已有恢复 | `node scripts/verify/lore-restore.mjs --prepare`；隔离 full 实例运行 `node scripts/verify/lore-restore.mjs`；实际实例运行加 `--original` |
| `drag-performance.mjs` | MCP 连续移动/渲染/命中/rAF 分位数、零中途保存与落点、9/200 对象/真实 Eagle 大图、模糊效果对比、4 轮窗口 resize 的可见视口/mount/三层 canvas/DPR 一致性；需运行 Eagle 并有 400 万像素以上图片 | `node scripts/verify/drag-performance.mjs [--baseline]`；`--inspect-live` 只读当前 renderState 并截图 |
| `image-transform-stability.mjs` | MCP 验证图片移动/缩放/旋转/翻转及历史、属性/锁定/裁剪全程保持原节点/子图层/租约且 ready；裁剪缩放落盘、重开几何、快速切换后的完整导出与截图 | `node scripts/verify/image-transform-stability.mjs` |
| `eagle-board.mjs` | Eagle 生产原图选择器边界回归；真实 Eagle 本机 API、NAS/映射盘原图拖入、条目链接、属性、刷新、定位后 API 确认选中、无 base64/原文件哈希、重启来源恢复 | `node scripts/verify/eagle-board.mjs`；同 profile 重启后 `--check-restart`（需 Eagle 开启 API 且有普通/无缩略图条目） |
| `whiteboard-drop.mjs` | 原生 File 桥参数回归；MCP 共用拖入入口的多图/编码链接/落点/去重/整批撤销与拒绝、仅链接落盘及源文件哈希、重启恢复；CDP 仅只读几何，MCP 截图 | `node scripts/verify/whiteboard-drop.mjs`；同 profile 重启后加 `--check-restart` |
| `crop-commit-order.mjs` | 提取生产裁剪结束/鼠标抬起回调，回归 UP → 双击关闭的微任务竞争、已有变换任务和一次历史事务；不派发界面事件 | `node scripts/verify/crop-commit-order.mjs` |
| `crop-render.mjs` | MCP 大图 200% 裁剪、连续裁剪、解码后几何、撤销/重做、保存重开及截图；默认 ffmpeg 生成样本，也可传入图片路径 | `node scripts/verify/crop-render.mjs [source.png]` |
| `resources.mjs` | 统一资源链接：多格式原始字节、并发去重、Range/HEAD/ETag、大文件分段、撤销/失联/版本、真实 Leafer 图片与视频播放/跳转，重启恢复；需 ffmpeg 生成隔离样本 | `node scripts/verify/resources.mjs`；重启同 profile 后 `node scripts/verify/resources.mjs --check-restart` |
| `network-drives.mjs` | 网络盘识别、默认显示/隐藏/恢复、完整驱动器 API 不受影响、按钮/列表 DOM 与截图；相同 profile 重启验证隐藏状态 | `node scripts/verify/network-drives.mjs`；重启后加 `--check-restart` |
| `quick-bookmarks.mjs` | 收藏分组增删改、多选收藏/同组去重/跨组复用、地址编辑/跳转、非法输入原子拒绝、DOM 几何与 MCP 截图；相同 profile 重启后检查持久化 | `node scripts/verify/quick-bookmarks.mjs`；重启后加 `--check-restart` |
| `launch.mjs` | 启动应用并等待 CDP 就绪（默认 9222）；支持隔离配置；`--unthrottled` 关闭遮挡时的渲染节流，供截图验收；`--build` 会触发 Rust 编译，开发阶段不要使用 | `npx electron-vite build && node scripts/verify/launch.mjs` 或 `node scripts/verify/launch.mjs --profile artifacts/verify/profiles/task --access full --write-root artifacts/verify/samples --port 9223` |
| `stop.mjs` | 结束 `launch.mjs` 启动的实例 | `node scripts/verify/stop.mjs [--force]` |
| `evaluate.mjs` | 在渲染进程执行 JS 并输出结果 | `node scripts/verify/evaluate.mjs "document.title"` |
| `mcp.mjs` | MCP 工具列表 / 单次调用 / 冒烟检查 | `node scripts/verify/mcp.mjs smoke` |
| `workcrate-quick-create.mjs` | 表格 TSV/CSV/多行解析、可编辑草稿几何、首次复用、原生物料往返、失败不落半批和后续追加；`--live` 验证已打开 VectorCraft 的撤销回滚 | `node scripts/verify/workcrate-quick-create.mjs [--live]` |
| `workcrate-project.mjs` | 通过 WorkCrate MCP 配置带引号的 Windows CLI 路径、创建隔离工程与 VectorCraft 文档，校验文件落盘、初始画板与重新打开同步 | `node scripts/verify/workcrate-project.mjs` |
| `workcrate-export.mjs` | 页面单选/多选/全选/取消、刷新保留选择，原生 PNG/JPG/多页 PDF 导出，文件数量/尺寸/页序/源文件不变与路径校验 | `node scripts/verify/workcrate-export.mjs` |
| `workcrate-presets.mjs` | 基础信息预置、保存、原生物料往返、下拉选项和底部提示几何；重启后加 `--check-restart` 校验主动清空/删除持久化 | `node scripts/verify/workcrate-presets.mjs`，重启相同 profile 后运行 `node scripts/verify/workcrate-presets.mjs --check-restart` |
| `workcrate-sync.mjs` | WorkCrate 保存自动刷新、保持编辑页、新增画板、原生排序、桌面双向同步及空文档窗口同步/编辑/打开恢复；外部编辑样本使用 VectorCraft MCP，应用操作使用 DeskSuite MCP | `node scripts/verify/workcrate-sync.mjs` |
| `capture.mjs` | 截取窗口或整屏，保存 PNG | `node scripts/verify/capture.mjs --screen` |
| `errors.mjs` | 重载渲染进程并收集异常/警告 | `node scripts/verify/errors.mjs --wait 4000` |
| `board-save.mjs` | 生产画板服务的防抖/最大等待/失败重试/在途编辑，以及迁移/独立文件/索引故障/大小写 ID 检查 | `node scripts/verify/board-save.mjs` |
| `board-native.mjs` | MCP 验证节点实例复用、通知零节点扫描、官方 TextEditor、原生嵌套 Group/组内编辑/变换/历史/复制删除、富文本兼容、导出及重启恢复；截图到 artifacts/verify/board-native.png | 隔离 profile 以 `--access full --write-root artifacts/verify/samples` 启动；`node scripts/verify/board-native.mjs`；可再用 `node scripts/verify/board-native.mjs --close-native` 验证未确认文字关闭保存（含编辑框只读几何/截图）；重启同 profile 后 `node scripts/verify/board-native.mjs --check-restart` || `board-save-live.mjs` | MCP 实机保存合并、独立文件、迁移、切换/关闭保存、截图及重启恢复 | 使用全新隔离 profile `artifacts/verify/profiles/board-save-v2`，以 `--access full --write-root artifacts/verify/samples` 启动；运行 `node scripts/verify/board-save-live.mjs`，脚本通过 MCP 关闭后重启同 profile，运行 `node scripts/verify/board-save-live.mjs --check-restart`；自定义 profile 名设 `DESKSUITE_SAVE_PROFILE` |
| `store.mjs` | 基础服务 `store` / `paths` 的纯 Node 单测（不需要启动应用） | `node scripts/verify/store.mjs` |
| `jobs.mjs` | 基础服务 `jobs` / `audit` 的纯 Node 单测（不需要启动应用） | `node scripts/verify/jobs.mjs` |
| `mcp-guard.mjs` | MCP 三档权限 × 读写工具的矩阵断言（需要已启动的应用） | `node scripts/verify/mcp-guard.mjs` |
| `annotations.mjs` | 标签树创建、重命名、物化路径、合并与清理（需要已启动的应用） | `node scripts/verify/annotations.mjs` |
| `files.mjs` | 已配置写入根内验证 Markdown 安全写入、复制/移动/重命名/新建/回收站、冲突策略、stale、撤销与 MCP 审批（需要已启动的应用） | `node scripts/verify/files.mjs` 或 `node scripts/verify/files.mjs --root <mcp.writeRoots 中的路径>` |
| `perf.mjs` | 在隔离 catalog profile 下测量 1k/10k/100k 行注入，并记录渲染内存与滚动帧率到 JSON（需要已启动的应用） | `node scripts/verify/perf.mjs` 或 `node scripts/verify/perf.mjs --counts=1000,10000` |
| `thumbnails.mjs` | 请求原图/任意文件两次，检查 JPEG data URL 与缓存一致性（需要已启动的应用） | `node scripts/verify/thumbnails.mjs [--path <绝对路径>]` |
| `clipboard.mjs` | 剪贴板文本/图片历史、收藏/清理、恢复系统剪贴板与 MCP 图片返回（需要已启动的应用） | `node scripts/verify/clipboard.mjs` |
| `launcher.mjs` | 启动台缓存条目、名称搜索和应用图标 IPC（需要已启动的应用） | `node scripts/verify/launcher.mjs` |
| `launcher-organize.mjs` | 通过启动台 MCP 扫描当前程序、按用途分类、清理冗余版本标题、补充缺失说明并回读验证 | 隔离实例以 `--access full --write-root artifacts/verify/samples` 启动；`DESKSUITE_MCP_URL=http://127.0.0.1:9635/mcp node scripts/verify/launcher-organize.mjs` |
| `index-search.mjs` | 扫描指定目录并通过 MCP 搜索确认索引结果（需要已启动的应用；可选传入扫描根目录） | `node scripts/verify/index-search.mjs [<目录>]` |
| `paging-watch.mjs` | 验证超大目录续页与 watcher 变更广播（需要已启动的应用；脚本通过临时目录生成样本） | `node scripts/verify/paging-watch.mjs` |
| `explorer-watch.mjs` | 验证 Explorer 目录视图与标签聚合视图的变更自动增量更新：修改/新增/删除在数秒内反映、重复对账不丢监听、未打标签文件不混入聚合列表、更新期间不触发整表重载；通过 `workspaces.setPane` 切换目录或标签，DOM 只读断言，`--shot` 额外经 `capture_window` 记录标签聚合态截图（需要已启动的应用） | `node scripts/verify/explorer-watch.mjs [--shot]` |
| `notes-editor.mjs` | 笔记专项 MCP 验收：目录/笔记选择、保存审批、新建草稿保护与落盘、资源 URI 图片显示且旧相对链接不改写、frontmatter 保真、只读搜索/大纲、草稿恢复/丢弃、属性编辑、查找替换、源码/阅读模式、Lore 快照/查询及主题截图 | `node scripts/verify/notes-editor.mjs`（需先以 `--access full --write-root artifacts/verify/samples` 启动应用） |
| `notes-whiteboard.mjs` | 白板专项验证的兼容入口，调用 `whiteboard-persistence.mjs`，功能操作全部经 MCP | `node scripts/verify/notes-whiteboard.mjs` |
| `whiteboard-persistence.mjs` | Leafer 验收兼容入口，转入 leafer-board.mjs | `node scripts/verify/whiteboard-persistence.mjs`；重启后加 `--check-restart` |
| `leafer-board.mjs` | Leafer 实际编辑器变换、撤销/编组/锁定/分区、富文本、官方 Arrow、leafer-x-ruler 刻度层及 guide 持久化、Easy Snap 对象/guide 吸附（1×/2×）、图片内置裁剪编辑器（打开/比例/尺寸/重置/关闭与 clip 持久化）、设计视口 fit/zoom 及 zoomLayer 与 scene.view 同步、原生视频播放进度音量、PNG/JPEG、排列/搜索/书签、多画板隔离与重启恢复；MCP 操作、只读 DOM 与窗口截图 | `node scripts/verify/leafer-board.mjs`；同 profile 重启后加 `--check-restart` |
| `crop-scale-probe.mjs` | 裁剪缩放专项探针：resize、比例+尺寸、点选其他节点退出、先缩放/旋转再裁剪，逐场景对比编辑态与提交重建后的 box/layer/clip 及截图（需已启动的应用） | `DESKSUITE_MCP_URL=http://127.0.0.1:9619/mcp DESKSUITE_CDP_PORT=9244 node scripts/verify/crop-scale-probe.mjs` |
| `crop-undo-probe.mjs` | 裁剪后撤销/重做探针：确认 clip 与宽高随历史精确回退与重放（需已启动的应用） | `DESKSUITE_MCP_URL=http://127.0.0.1:9619/mcp DESKSUITE_CDP_PORT=9244 node scripts/verify/crop-undo-probe.mjs` |
| `settings-commands.mjs` | 检查设置 schema、命令注册、Ctrl+K 面板与内置命令（需要已启动的应用） | `node scripts/verify/settings-commands.mjs` |
| `unified-commands.mjs` | 校验每个已注册 MCP 工具自动出现在共享命令列表与渲染层命令 API，通过共享命令 MCP 打开设置、切换字体审查并用 `capture_window` 留图 | 隔离 profile 以 `--access full --write-root artifacts/verify/samples` 启动；`node scripts/verify/unified-commands.mjs` |
| `updater.mjs` | 只读检查更新服务 IPC 状态，不执行网络检查、下载或安装（需要已启动的应用） | `node scripts/verify/updater.mjs` |
| `tagview-smoke.mjs` | 标签聚合链路冒烟：创建父子标签、分配样例文件、验证 `tag_files` 父标签包含子孙标签文件（需要已启动的应用；样本在 `artifacts/verify/samples/tagview`） | `DESKSUITE_MCP_URL=http://127.0.0.1:9601/mcp node scripts/verify/tagview-smoke.mjs` |

`evaluate.mjs` 支持 `--file probe.js` 或从标准输入读取表达式；`mcp.mjs call` 支持从标准输入读取 JSON 参数：

`files.mjs` 会使用配置中的第一个 `mcp.writeRoots` 创建临时目录；未配置时可传入一个已授权根目录。脚本验证安全计划写入 Markdown 笔记、文件操作与撤销，并把单个临时文件移入系统回收站；MCP 无人批准路径等待最长 60 秒。报告写入 `artifacts/verify/files.json`。

`clipboard.mjs` 会验证文本与图片历史、收藏/清理和 MCP 图片返回；结束时恢复原系统剪贴板内容。若当前图片超过可恢复上限，脚本只检查 MCP 读取并跳过剪贴板变更；报告写入 `artifacts/verify/clipboard.json`。

`perf.mjs` uses `dev_inject_data` / `dev_clear_data` with an isolated profile and writes `perf-<date>.json` under `artifacts/verify/`; synthetic catalog rows never point to user files.

`index-search.mjs` 会通过 MCP 扫描参数目录（缺省为仓库根目录），等待扫描作业完成，再搜索 `ROADMAP.md`；报告写入 `artifacts/verify/index-search.json`。

`paging-watch.mjs` 会创建临时验证目录，检查续页无遗漏和外部文件变化事件，完成后清理临时样本；报告写入 `artifacts/verify/paging-watch.json`。

`explorer-watch.mjs` 先在 `artifacts/verify/samples/explorer-watch` 的目录视图执行重复对账、修改、新增、删除，断言行内容在超时内更新、监听目录未被拆除、刷新按钮未进入 loading（即未整表重载）；随后创建临时标签并分配给样本文件，把窗格切到该标签的聚合视图后重载页面，验证命中文件的修改被增量刷新、目录内未打标签的新文件不进入列表、删除已打标签文件后行被移除，且同样不触发整表重载；结束时恢复原窗格状态、删除临时标签并清理样本。加 `--shot` 时在标签聚合态写入 `explorer-watch-tag.png`（需同时设置 `DESKSUITE_MCP_URL` 指向该实例）。

`leafer-board.mjs`（兼容入口 `whiteboard-persistence.mjs` / `notes-whiteboard.mjs`）仅用于隔离 profile，使用 leafer-verify-a 与新建的专用画板。经 MCP 操作真实 Leafer 编辑器和统一资源图片/视频；样本在 artifacts/verify/samples/leafer-board，报告 leafer-board.json / leafer-restart.json，截图 leafer-board.png 与裁剪态 leafer-crop.png，导出样本 leafer-export.png。业务场景保存在 `<userData>/data/leafer-board-scenes.json`，图片/视频只保存永久 URI，Store 维护 `.bak`。旧 whiteboard-scenes.json 不改动。

```powershell
node scripts/verify/launch.mjs --profile artifacts/verify/profiles/leafer --access full --write-root artifacts/verify/samples --mcp-port 9612 --port 9237 --unthrottled
$env:DESKSUITE_CDP_PORT='9237'
$env:DESKSUITE_MCP_URL='http://127.0.0.1:9612/mcp'
node scripts/verify/leafer-board.mjs
node scripts/verify/stop.mjs
# 同上 launch 后：
node scripts/verify/leafer-board.mjs --check-restart
node scripts/verify/errors.mjs --wait 1500
node scripts/verify/stop.mjs
```

验收边界：脚本通过 MCP 编辑命令覆盖实际 Leafer 变换链路，不以鼠标/DOM 模拟代替。系统剪贴板图片、原生文件选择框及浏览器 HTML5 拖拽事件没有自动操作；导入业务链路由 MCP 使用合成原文件验证，不宣称覆盖操作系统 UI 手势。

`annotations.mjs` 会创建唯一前缀的临时标签，检查子标签物化路径与合并迁移，再通过 IPC 删除临时标签；报告写入 `artifacts/verify/annotations.json`。

`updater.mjs` 只读检查 `updater.get` IPC，不触发网络访问、下载或安装。更新打包可用 `npm run package:dir`（解包目录）和 `npm run package:win`（NSIS）；设置 `DESKSUITE_GITHUB_OWNER` / `DESKSUITE_GITHUB_REPO` 后，electron-builder 会生成发布所需的 `latest.yml`。发布仍需手动把 `latest.yml` 与安装包上传到相应 GitHub Releases。


```bash
node scripts/verify/mcp.mjs call list_directory '{"path":"E:\\ai\\DeskSuite"}'
node scripts/verify/evaluate.mjs "<表达式>"
```

## 环境变量

`resources.mjs` 使用 `artifacts/verify/samples/resource-links` 合成图片、WebM、文本、PDF 字节样本与 128 MiB 稀疏文件。所有登记、链接读取、Leafer 加载和媒体控制经 DeskSuite MCP；CDP 只读检查几何。文件系统写入仅用于构造样本及模拟外部修改/丢失。保留资源登记供重启校验，报告为 `resources.json` / `resources-restart.json`，截图为 `resources-image.png` / `resources-video.png`。PDF 样本本轮只验证格式无关字节通道，不代表已经实现 PDF 阅读器。

| 变量 | 默认值 | 说明 |
| --- | --- | --- |
| `DESKSUITE_CDP_PORT` | `9222` | Chromium 调试端口，同时用于 `launch.mjs` |
| `DESKSUITE_MCP_URL` | `http://127.0.0.1:9600/mcp` | 应用 MCP 地址；改了 `config.json` 的 `mcp.port` 时同步覆盖 |
| `DESKSUITE_VERIFY_DIR` | `<repo>/artifacts/verify` | 截图、日志、pid 文件目录 |

`launch.mjs --profile <目录>` 会在 `artifacts/verify/` 内创建独立 Electron userData 配置，不会读取或改写日常配置。可配合 `--access off|read|standard|full`、`--write-root <验证目录>` 和 `--mcp-port <端口>`；`--port` 设置 CDP 端口。profile 和 write root 都必须位于 `artifacts/verify/` 内。

**开发/验收阶段的 MCP 权限规则：**验证实例统一以最高权限 `--access full` 启动，确保专项脚本可以通过 MCP 完成写入和变更操作。仍须使用隔离 profile，并将可写根限制为 `artifacts/verify/samples`；不要为开发验证放开到用户目录或整盘。该规则不改变发行版默认权限策略。

## 产物

```
artifacts/verify/
  window.png      # capture.mjs 默认窗口截图
  screen.png      # --screen 整屏截图
  electron.log    # launch.mjs 启动的应用日志
  electron.pid    # stop.mjs 使用的进程号
```

## 约定与注意事项

- **功能操作只通过 DeskSuite 自身 MCP 执行**：验收脚本应调用本机 MCP 工具完成创建、更新、删除等功能操作。禁止用电脑操控插件、鼠标键盘自动化、CDP DOM click/dispatch 或自动操作系统文件对话框来替代 MCP。如果目标功能没有 MCP 入口，先补齐插件 MCP 工具和基于 MCP 的验收脚本，再进行实机验证。`evaluate.mjs` 只读检查 DOM、状态和几何；不得用于触发状态变化。截图使用 `capture_window` MCP 工具。
- **截图一律走 `capture_window` MCP 工具**：其实现会先 `invalidate()` 再截图，避免窗口被遮挡时返回上一帧。
- 界面断言优先用 `evaluate.mjs` 读取 DOM / 几何信息，截图只作视觉留证。
- MCP 服务器是无状态 Streamable HTTP，脚本每次调用前都会重新 `initialize`，可安全重复执行。
- 脚本仅用于本地开发，不参与构建，也不受 `guard.mjs` 对 `src/` 的架构规则约束。
- 应用关闭后 `electron.pid` 可能残留，`stop.mjs` 会识别并清理无效 pid。

## 典型流程

```bash
npx electron-vite build
node scripts/verify/launch.mjs
node scripts/verify/mcp.mjs smoke
node scripts/verify/capture.mjs
node scripts/verify/errors.mjs
node scripts/verify/stop.mjs
```

## 每阶段开发后的 MCP 与截图确认（必做）

每个开发阶段结束后（包括一个阶段性功能、重构、修复或界面调整完成时），都必须启动应用进行实机验收。使用 DeskSuite 自身插件提供的 MCP 工具验证本阶段涉及的实际能力，并调用 `capture_window` 截图、人工查看界面后，才算该阶段完成。不能把多个阶段累积到最终交付时再统一验证，也不能只用静态检查、单元测试或代码审查代替 MCP 实机验证和截图确认。

阶段验收步骤：

1. 运行 `npm run guard` 和 `npm run typecheck`，再运行 `npx electron-vite build`（开发阶段不要用 `npm run build`，它会触发 Rust 编译）。
2. 使用 `node scripts/verify/launch.mjs` 启动验证实例。
3. 运行 `node scripts/verify/mcp.mjs smoke` 确认 MCP 可连接、工具可调用；针对本次改动，再调用相关 MCP 工具或运行对应专项验证脚本。
4. 使用 `node scripts/verify/evaluate.mjs "<表达式>"` 只读检查改动相关的 DOM、状态或几何尺寸；按本阶段功能通过相关插件 MCP 工具或专项验证脚本执行操作并验证结果。若 MCP 缺少该能力，先补 MCP 工具和验证脚本。
5. 对 WorkCrate，使用隔离工程验证工程创建、原生文档/画板目录、缓存预览读取和文档打开入口；保存一处 VectorCraft 画板物料信息后同步，确认页面预览及物料栏刷新。运行 `node scripts/verify/capture.mjs`，人工查看项目、页面矩阵与画板详情截图。WorkCrate 不再提供绘图手势、对象编辑或导出控件。
6. 运行 `node scripts/verify/errors.mjs` 检查渲染异常，最后运行 `node scripts/verify/stop.mjs`。

如果本阶段改动影响窗口尺寸、布局、持久化或界面样式，必须验证相应几何、重启恢复或交互状态，并查看对应截图。阶段交付说明必须记录使用的 MCP/专项验证、结果、截图路径和未通过项；有未通过项时，明确记录原因和后续处理状态。

也可使用 npm 别名：`npm run verify:launch`、`verify:stop`、`verify:smoke`、`verify:shot`、`verify:errors`。

不需要启动应用的基础服务单测：

```bash
node scripts/verify/store.mjs   # store / paths
node scripts/verify/jobs.mjs    # jobs / audit
```

## 验证记录

裁剪提交顺序修复后，隔离实例运行 `leafer-board.mjs` 的 9 组完整白板 MCP 回归全部通过（含变换/吸附、裁剪、图片/视频、导出及多画板隔离）；报告 `artifacts/verify/leafer-board.json`。

| 日期 | 范围 | 命令 | 结果 |
| --- | --- | --- | --- |
| 2026-10-30 | MCP、IPC 与命令面板收敛到共享命令注册表 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/unified-commands-v3 --access full --write-root artifacts/verify/samples --mcp-port 9642 --port 9252 --unthrottled`、`unified-commands.mjs` | MCP 工具不再由独立 MCP map 持有，80 个 MCP 工具与 171 个 IPC 方法都投影到核心命令注册表，总计 271 条目录项。`command_run` 调用 `ipc.filesystem.drives` 返回真实驱动器数据，并调用 `ui.open-panel` 打开设置；MCP 截图 `artifacts/verify/unified-commands.png` 已查看。界面动作按 full MCP 访问级别直接执行；命令面板执行写操作仍显示确认。 |
| 2026-10-29 | 全部元素拖动迟滞：画布尺寸反馈修复 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/drag-performance --access full --write-root artifacts/verify/samples --mcp-port 9642 --port 9267 --unthrottled`、`drag-performance.mjs --baseline` / 修复后运行、`image-transform-stability.mjs`、`crop-commit-order.mjs`、`leafer-board.mjs`、`errors.mjs --wait 1500` | 用户现场只读 9 节点、snap/rulers 均关闭、renderState 高 2823；隔离实例 DOM 复现 root 高 695、mount/canvas 高 1390，mount 内联 position:relative 覆盖原 absolute 类。改为内联 absolute/inset 且仅监听可见视口，按需 resize，消除内部 canvas 反向驱动尺寸。4 轮 MCP 窗口缩放后 root/mount/renderer/三层 canvas CSS 与 DPR backing 尺寸全部一致；修复后样本 1095×635 对应 DPR1.5 backing 1643×953，不再膨胀。9/200 对象及 2160×3840 Eagle 图的语义移动测量通过：不吸附时编辑 P95 约 0.2–0.3ms、rAF P95 约16.8ms，移动期间场景更新0、坐标误差<0.001；基线同样有低CPU与GPU加速，因此未把引擎、吸附或模糊效果认定为用户小场景的性能根因。保留正式外观与像素比。图片22项、裁剪时序2项、完整白板9组通过，重载异常0。报告 `drag-performance-baseline.json` / `drag-performance-after.json`；`drag-live-window.png`、`drag-performance-after.png` 已查看。未模拟系统鼠标，语义测量不等同物理输入延迟测量；用户原画板未改写。 |
| 2026-10-29 | 图片移动/变换后闪烁与重复加载 | `guard`、`typecheck`、`build`、隔离 full 权限 `launch.mjs --profile artifacts/verify/profiles/image-transform-stability --access full --write-root artifacts/verify/samples --mcp-port 9641 --port 9266 --unthrottled`、`image-transform-stability.mjs`、`crop-commit-order.mjs`、`crop-render.mjs`、`leafer-board.mjs`、`errors.mjs --wait 1500` | 修复前用同一专项确认移动一次即更换 ClipImage/子图层/租约并变成 ready:false。修复后同资源图片原位同步；专项 22 项通过（移动/缩放/旋转/翻转及撤销/重做、属性/锁定、裁剪提交/裁剪后缩放/移动、保存重开、快速导航后导出），连续操作保持原实例/租约与 ready:true；重开后裁剪几何精确恢复。发现并修复快速切换后的异步缩略图任务可能等待已销毁画板、堵住全局导出队列，改为资源就绪后的同步小预览并复查节点归属。时序回归、大图裁剪和完整白板 9 组（含 PNG/JPEG）通过，重载渲染异常 0。报告 `image-transform-stability.json`；截图 `image-transform-stability.png` 已查看。状态变化仅走 DeskSuite MCP，未模拟鼠标/DOM 事件。 |
| 2026-10-29 | Eagle 画板统一链接与来源属性插件 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/eagle-board --access full --write-root artifacts/verify/samples --mcp-port 9640 --port 9265 --unthrottled`、`eagle-board.mjs`、同 profile 重启 `--check-restart`、`whiteboard-drop.mjs`、`leafer-board.mjs`、`resources.mjs`、干净重启 `errors.mjs --wait 1500` | 参考 FileAtlas EagleLinks 原图匹配/文件夹/定位链路，实现独立 main data-provider-eagle-links 与 renderer canvas-ext-eagle，经通用画板扩展注册属性/来源增强/链接解析。真实本机 Eagle V2、X: 映射 NAS 的原图拖入及 canonical UNC file:// 链接、noThumbnail 深链接、属性名称/ID/文件夹/标签/尺寸/路径、刷新、一次撤销/重做、误拖缩略图/非法链接拒绝均通过；MCP eagleOpen 实际派发，Eagle API 确认目标被选中，已查看全屏 `eagle-item-opened.png`。画板只存稳定 URI，来源快照在独立 Store，原图哈希不变；重启后节点/链接/来源元数据精确恢复。普通拖入、白板 9 组、资源 7 组通过；资源负例产生的 400/404/405/409/416 控制台记录属预期，干净重启后渲染异常 0。截图 `eagle-board-properties.png`、`eagle-board-restart.png` 已查看；报告 `eagle-board.json` / `eagle-board-restart.json`。遵守约定未做鼠标拖放/DOM 事件模拟，验收通过共用 dropImport MCP 入口；Eagle 原图 sibling 规则仍依赖其当前 .info 布局，歧义时明确失败。 |
| 2026-10-29 | 画板图片拖拽统一链接导入 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/whiteboard-drop --access full --write-root artifacts/verify/samples --mcp-port 9639 --port 9264 --unthrottled`、`whiteboard-drop.mjs`、相同 profile 重启 `--check-restart`、`leafer-board.mjs`、`errors.mjs --wait 1500` | 原生 File 经唯一桥的通用参数适配使用 webUtils 解析路径，再走统一 resources.register，不复制/嵌入原图；业务代码保留在现有资源/画板插件。MCP 共用 dropImport 验证多图/去重、200% 落点、中文/空格/#/% 编码 URI、已有统一链接、单次撤销整批、10 类无效输入不落半批、落盘无 data/base64/blob/版本 URL、源文件哈希不变；重启后全部图片节点几何和链接精确恢复并解码。原生 File 参数边界用生产 preload 回归桩测试；遵守约定未自动化系统鼠标拖入，拖入高亮未通过事件模拟验收。完整白板 9 组通过，重载渲染异常 0。报告 `whiteboard-drop.json`；截图 `whiteboard-drop.png` / `whiteboard-drop-restart.png` 已查看。 |
| 2026-10-29 | 双击应用裁剪后图片缩小 | `guard`、`typecheck`、`build`、`crop-commit-order.mjs`、隔离 `launch.mjs --profile artifacts/verify/profiles/crop-investigation --access full --write-root artifacts/verify/samples --mcp-port 9625 --port 9250 --unthrottled`、`crop-render.mjs`（用户截图及 1800×1200 合成图）、`errors.mjs --wait 1500` | 查明 Pointer.UP 的通用变换微任务先于裁剪 END 保存，提前重建图片后可能将未解码子图层默认 100×100 写入 clip；只读查看用户现场已保存 clip=100×100、外框约 271×192。裁剪结束同步捕获完整几何，裁剪及待提交期间阻止通用保存；生产回调时序回归两组通过。MCP 大图 200% 首次/连续裁剪、单次撤销/重做、保存重开精确几何通过；已查看 `crop-render-first-live.png`、`crop-render-first-after.png`，内容比例和位置一致。报告 `crop-commit-order.json`、`crop-render.json`，重载渲染异常 0。未模拟鼠标双击，双击时序由生产回调回归验证；用户现场数据未改写。 |
| 2026-10-29 | 白板视口迁移至 Leafer 官方插件 | `npm run guard`、`npm run typecheck`、`npm run build`、隔离 `launch.mjs --profile artifacts/verify/profiles/viewport-plugin --access full --write-root artifacts/verify/samples --mcp-port 9632 --port 9257 --unthrottled`、MCP smoke、`leafer-board.mjs`、`errors.mjs --wait 1500`、`capture.mjs` | 安装官方 `@leafer-in/viewport`/`@leafer-in/view` 2.3.2；由 design 视口接管滚轮/触控板平移缩放及 Space/中键拖拽，由 View 插件接管 fit/zoom；删除 React 中对应 wheel/pan 数学，顶部缩放按钮与 MCP 命令改走插件。zoomLayer 属性变化按帧写回 `scene.view`。白板 MCP 专项 8 组通过，新增断言确认 fit/zoom 运行态与场景状态同步及缩放下限 0.05；MCP smoke 通过；重载后渲染异常 0。截图 `artifacts/verify/viewport-plugin/window.png` 已查看。 |
| 2026-10-29 | 富文本插件评估与 Arrow 迁移 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/leafer-arrow --access full --write-root artifacts/verify/samples --mcp-port 9633 --port 9258 --unthrottled`、MCP smoke、`leafer-board.mjs`、同 profile 重启 `--check-restart`、`errors.mjs --wait 1500`、`capture.mjs` | 源码评估官方 HTMLText：自然尺寸测量并以图片渲染，固定宽度会缩放内容，无法满足便签框内换行，故未替换富文本排版并移除未使用依赖；改用官方 `@leafer-in/arrow` 2.3.2 负责 arrow 节点箭头尖端，普通 line 仍用 Leafer Path，保存 schema 不变。专项 MCP 9 组、重启精确恢复、MCP smoke 通过；渲染异常 0；截图 `artifacts/verify/window.png` 已查看。 |
| 2026-10-29 | 白板标尺刻度迁移到 leafer-x-ruler | `npm run guard`、`npm run typecheck`、`npm run build`、`npm ls leafer-x-ruler @leafer-ui/core @leafer-in/editor @leafer-in/text-editor --depth=1`、隔离 `launch.mjs --profile artifacts/verify/profiles/leafer-ruler --access full --write-root artifacts/verify/samples --mcp-port 9634 --port 9259 --unthrottled`、MCP smoke、`leafer-board.mjs`、同 profile 重启 `--check-restart`、`errors.mjs --wait 1500`、`capture.mjs` | 安装社区 `leafer-x-ruler` 2.0.1；刻度与选中对象标记由插件图层绘制，React 只留拖动热区和参考线预览/持久化覆盖。插件 peer 范围支持 Leafer 2.x，依赖实际去重至项目锁定的 2.3.2。白板 MCP 9 组、含插件画布图层只读断言、guide 命令和吸附、重启精确恢复均通过；渲染异常 0；截图 `artifacts/verify/window.png` 已查看。 |
| 2026-10-29 | 白板旋转/翻转变换迁移到 Leafer Editor | `npm run guard`、`npm run typecheck`、`npm run build`、隔离 `launch.mjs --profile artifacts/verify/profiles/leafer-transform --access full --write-root artifacts/verify/samples --mcp-port 9635 --port 9260 --unthrottled`、MCP smoke、`leafer-board.mjs`、同 profile 重启 `--check-restart`、`errors.mjs --wait 1500`、`capture.mjs` | `rotate`/`flip` 命令通过活动 Editor 的 `rotateOf`/`flip` 操作，并统一从引擎映射最终几何至一次 `canvas.edit`；移除命令层手写的翻转坐标/scale 几何。Resize 2.3.2 已由 Editor 依赖安装，角点比例缩放继续由 Editor/Resize 管理。MCP 专项旋转、翻转、撤销、重做和变换检查通过；移动自动吸附、对齐线、距离与等间距提示继续由 Easy Snap 提供，批量排列/等距命令仍提交场景事务。重启精确恢复通过，渲染异常 0；截图 `artifacts/verify/window.png` 已查看。 |
| 2026-10-29 | Easy Snap 源码集成复核与缩放视图回归 | `leafer-board.mjs`（MCP `whiteboard_panel` transform/guide/settings，CDP 仅只读几何）、`errors.mjs --wait 1500`、`capture.mjs` | 对照 1.11.0 README 与打包类型/实现，确认 `collectSnapElements` 扩展、Editor move 监听、snapSize 和 enable/disable 生命周期；加上 2× zoom 持久 guide 吸附断言。普通对象与 guide 在 1×、2× 下吸附到预期位置，白板专项 passed:true，MCP 操作通过；渲染异常 0。 |
| 2026-10-29 | 白板吸附改用 leafer-x-easy-snap | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/easy-snap-final --access full --write-root artifacts/verify/samples --mcp-port 9628 --port 9253 --unthrottled`、MCP smoke、`leafer-board.mjs`、`errors.mjs --wait 1500`、`capture_window` | 移除引擎内自写的节点/标尺坐标匹配、6 像素阈值和 10 单位网格吸附；启用 leafer-x-easy-snap 1.11.0，使用插件对齐线、距离标签、等间距提示；持久化标尺线经 `collectSnapElements` 适配为 sky 层目标并按画布视图偏移转换，线段端点置于视口外以避免误加另一轴候选。MCP 专项验证普通对象对齐及标尺线对齐通过；白板全面专项 8 组通过，PNG/JPEG 导出、裁剪、视频、撤销/重做及隔离均通过；截图 `artifacts/verify/leafer-board.png`、`artifacts/verify/leafer-snap.png` 已查看，渲染异常 0。另去掉与编辑插件重复注册的引擎 `select` 命令，避免白板挂载失败。 |
| 2026-10-29 | 画板图片裁剪改用库内置裁剪编辑器 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/crop-inner --access full --write-root artifacts/verify/samples --mcp-port 9618 --port 9243 --unthrottled`、`leafer-board.mjs`、同 profile 重启后 `--check-restart`、`capture.mjs`、`errors.mjs --wait 1500` | 接入 leafer-x-clip-resize-inner-editor 1.10.0：图片节点改为 ClipImage，双击或工具栏裁剪按钮进入库内置裁剪编辑器，裁剪窗可移动/缩放/旋转/拉伸；退出时合并为一次撤销事务。持久化 clip 按节点框归一化并保留图层旋转/缩放，旧 crop 只读兼容并自动转换。MCP 验证 cropOpen/cropState/cropRatio/cropResize/cropReset/cropClose 全部通过，关闭后节点宽度与持久化 clip 正确；重启后场景 JSON 完全一致、裁剪图片正常解码显示；渲染异常 0。截图 `artifacts/verify/leafer-crop.png`（虚线为整图、白框为裁剪窗与角点/旋转手柄）与 `artifacts/verify/window.png` 已查看。未通过项：双击进入与 Escape 退出依赖 Leafer 双击事件与键盘事件，按约定未做鼠标/DOM 自动化，仅由库事件路径与裁剪态截图留证。 |
| 2026-10-29 | 裁剪缩放专项排查与 select 命令 | `guard`、`typecheck`、`launch.mjs --profile artifacts/verify/profiles/crop-probe --access full --write-root artifacts/verify/samples --mcp-port 9619 --port 9244`、`crop-scale-probe.mjs`、`crop-undo-probe.mjs`、`leafer-board.mjs`（隔离 leafer profile，报告 passed:true 7 组 0 告警） | 排查"裁剪后图片被缩放"：未使用 leafer-x-easy-snap（吸附为 engine 内自实现，仅调位置不改尺寸）。新增引擎 `select({ids})` 命令后实测 7 条路径全部精确一致（编辑态 vs 提交重建后 box/layer/clip 误差 <0.01，截图无变形）：固定尺寸裁剪、比例+尺寸、点选其他节点退出、先缩放(scale 1.5)再裁剪、先旋转(15°)再裁剪、撤销恢复原状、重做还原裁剪。库手柄拖拽经源码核对与 cropResize 同一 scaleOfWorld(resize) 数学。未复现缩放错误；发现的相邻缺陷：`duplicate`（副本按钮/Ctrl+D）命令从未注册，白板面板按钮为死功能，待后续补齐。探针脚本已登记。 |
| 2026-10-29 | 图层面板树形与缩略图 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/wb-style --access full --write-root artifacts/verify/samples --mcp-port 9616 --port 9241 --unthrottled`、MCP `whiteboard_panel`（open / add / group / frame / inspect）、`capture.mjs`、`errors.mjs --wait 1500` | 图层页改为树形列表：按 z 序倒序渲染，组合与分区可折叠展开（组合默认收起、分区默认展开），组行显示成员数；每行渲染内容缩略图（引擎新增 `thumbnail` 命令，按指纹缓存，图形/文本/笔记实测出图）；行尾内联置顶/置底/锁定(解锁)/删除操作（点击先单选该节点再执行命令）；行间增加分割线，悬停高亮。选中行高亮，Shift 点击多选保留。截图 `artifacts/verify/window.png` 已查看（可见组合行折起、图形行缩略图与 4 个行内操作图标、行分割线）。MCP 检查场景结构不变；重载渲染异常 0。未通过项：折叠/展开与行内操作为点击交互，仅视觉留证未自动化点击。 |
| 2026-10-29 | 底部对象工具栏图标化 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/wb-style --access full --write-root artifacts/verify/samples --mcp-port 9616 --port 9241 --unthrottled`、MCP `whiteboard_panel`（open / add）、`capture.mjs`、`errors.mjs --wait 1500` | 底部对象操作全部由文字按钮改为 lucide 图标按钮（复制/粘贴/副本/删除、旋转/翻转、组合/锁定、置顶/置底/折叠、横排/竖排/网格、等距、分区、图片裁剪），悬停保留中文标题，锁定/折叠按状态切换图标；选中对象时显示操作栏。截图 `artifacts/verify/window.png` 已查看，重载渲染异常 0；无未通过项。 |
| 2026-10-29 | 白板工具栏职责重排 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/wb-style --access full --write-root artifacts/verify/samples --mcp-port 9616 --port 9241 --unthrottled`、MCP `whiteboard_panel`（open / add / lock / rotate / arrange / order / undo / inspect）、`capture.mjs`、`errors.mjs --wait 1500` | 属性页对象操作（复制/变换/组合/排列/分区/图片裁剪弹层）下沉到底部对象工具栏（未选中时显示提示）；缩放/适应/聚焦/背景/吸附/标尺/导出上移到顶部工具栏并自动换行；"更多"页取消，搜索、视图书签、导入浏览器选中文件并入顶部"…"弹出面板（内部滚动）。检查器仅剩图层/属性两页。MCP 命令全部通过，重载渲染异常 0。截图 `artifacts/verify/window.png` 已查看。未通过项：启动后首次 `whiteboard_panel open` 超时一次（"白板界面未响应"），随后调用恢复正常，判定为启动竞态，未影响功能；"…"菜单与裁剪弹层为弹出交互，仅视觉留证。 |
| 2026-10-29 | 白板面板布局对齐参考稿 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/wb-style --access full --write-root artifacts/verify/samples --mcp-port 9616 --port 9241 --unthrottled`、MCP `whiteboard_panel`（open / add / undo / settings.snap / export / inspect）、`capture.mjs`、`errors.mjs --wait 1500` | 画板控制条改为下拉 + 新建/重命名铅笔 + 已保存胶囊 + 撤销/重做 + 更多菜单（删除/元素数），左侧工具栏纯图标，检查器改为顶部横排页签（激活蓝块 + 右侧折叠），底部工具条纯图标分段（缩放/适配/背景循环/吸附/标尺/导出）。功能经 MCP 全部通过（添加、撤销、设置切换、PNG 导出返回图像数据），渲染异常 0。截图 `artifacts/verify/window.png` 已查看；铅笔重命名与更多菜单为弹出交互，仅视觉留证未自动化点击。无未通过项。 |
| 2026-10-29 | 统一资源链接提供插件 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/resources --access full --write-root artifacts/verify/samples --mcp-port 9612 --port 9237 --unthrottled`、MCP smoke、`resources.mjs`、相同 profile 重启后 `--check-restart`、`errors.mjs --wait 1500` | 9 类样本原始字节、特殊字符路径、12 个并发去重、Range/HEAD/ETag/If-Range、128 MiB 分段、过期版本/失联/撤销、真实 Leafer 图片解码与并发租约、WebM 播放/跳转/暂停、重启 URI 与字节恢复通过。截图 `artifacts/verify/resources-image.png` / `resources-video.png` 已查看；报告 `resources.json` / `resources-restart.json`。负例请求按预期返回 400/404/405/409/416；干净重启后渲染异常/警告 0，无未通过项。本阶段是资源服务及消费面板，不代表已完成新画板或 PDF 阅读器。 |
| 2026-10-29 | 白板持久化与图片恢复 | `guard`、`typecheck`、`build`、隔离 full 权限 launch（profile `artifacts/verify/profiles/whiteboard`，write root `artifacts/verify/samples`，MCP 9610 / CDP 9235）、MCP smoke、`whiteboard-persistence.mjs`、重启后 `--check-restart`、`errors.mjs --wait 1500` | 并发创建、真实编辑器图形/图片自动保存、切换隔离、超限拒绝、删除、重启恢复通过。截图 `artifacts/verify/whiteboard-persistence.png` 已查看，报告 `whiteboard-persistence.json` / `whiteboard-restart.json`。未通过项：重载后 Excalidraw CDN 字体预载被现有 CSP 阻止（460 条）；独立字体资源问题未在本次处理，图形/图片保存恢复不受影响。 |
| 2026-10-29 | 网络驱动盘显示开关 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/network-drives --access full --write-root artifacts/verify/samples --mcp-port 9608 --port 9231 --unthrottled`、MCP smoke、`network-drives.mjs`、相同 profile 重启后 `--check-restart`、`errors.mjs --wait 1500` | 真实识别 V/W/X/Y/Z 五个网络盘，默认 9 个驱动器，隐藏后只显示 C/D/E/F 四个本地盘；恢复显示、非法输入拒绝、完整驱动器 API 不受影响及重启隐藏恢复通过。按钮宽 28px，无横向溢出，渲染异常/警告 0。截图 `network-drives-visible.png` / `network-drives-hidden.png` 已查看，报告 `network-drives.json` / `network-drives-restart.json`（均位于 artifacts/verify）；无未通过项。 |
| 2026-10-29 | 文件侧栏快速收藏分组 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --profile artifacts/verify/profiles/quick-bookmarks --access full --write-root artifacts/verify/samples --mcp-port 9608 --port 9231 --unthrottled`、MCP smoke、`quick-bookmarks.mjs`、相同 profile 重启后 `--check-restart`、`errors.mjs --wait 1500` | 分组增删改、混合多选仅收藏文件夹、同组去重（含大小写与尾斜杠）、跨组复用、收藏名称/地址编辑及跳转、非法输入原子拒绝、空选择禁用、持久化恢复均通过。侧栏宽 251px 无横向溢出；渲染异常/警告 0；截图 `artifacts/verify/quick-bookmarks-groups.png` 和 `quick-bookmarks.png` 已查看，报告 `quick-bookmarks.json` / `quick-bookmarks-restart.json`；无未通过项。 |
| 2026-10-29 | WorkCrate 表格快速创建 | `guard`、`typecheck`、`build`、隔离 `launch.mjs --access full --write-root artifacts/verify/samples --mcp-port 9604 --port 9227 --unthrottled`、`workcrate-quick-create.mjs` / `--live`、MCP smoke、`errors.mjs --wait 1500` | TSV/CSV/多行引号、空行过滤、重复表头/超列/非法输入拒绝通过；3 行生成 3 张 A3 画布并复用初始画板，数量与扩展物料原生往返一致，后续追加至 4 张；headless 和已打开 GUI 两种路径均通过，中途超长布局失败取消撤销组且源文件不变。表格 21 格及面板几何通过，渲染异常 0。截图 `artifacts/verify/workcrate-quick-create-{table,pages,material}.png` 已查看，报告 `artifacts/verify/workcrate-quick-create.json`；无未通过项。 |
| 2026-10-29 | 页面管理选择与原生画板导出 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-export --access full --write-root artifacts/verify/samples --mcp-port 9602 --port 9225 --unthrottled`、`workcrate-export.mjs`、`workcrate-sync.mjs`、MCP smoke、`errors.mjs --wait 1500` | 通过 MCP 切换单选/多选/全选/取消，DOM 核对勾选和刷新保留选择；选中第 1/3 页导出 2 张原生 PNG，2× 尺寸 2381×1684；全部 PNG/JPG 各 3 张，PDF 3 页。重复导出独立目录；空/过期/重复 ID 与越权路径拒绝；原生源文件哈希不变；已打开 GUI 的未保存画板也可导出。截图 `artifacts/verify/workcrate-page-export.png`，报告 `artifacts/verify/workcrate-export.json`。 |
| 2026-10-28 | WorkCrate 空 VectorCraft 窗口报错修复 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-empty-desktop --access full --write-root artifacts/verify/samples --mcp-port 9602 --port 9225 --unthrottled`、`workcrate-sync.mjs`、MCP smoke、`errors.mjs --wait 1500` | 13 项专项验证通过，包含真实关闭最后一个 VectorCraft 文档后自动检查不报错、只读同步读取磁盘且保持 GUI 空窗口、编辑时自动打开工程，以及打开入口恢复空窗口。原有未保存修改双向同步和排序通过；渲染异常 0。截图 `artifacts/verify/workcrate-sync-editor.png`，报告 `artifacts/verify/workcrate-sync.json`。 |
| 2026-10-28 | WorkCrate 物料基础信息和底部提示 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-presets --access full --write-root artifacts/verify/samples --mcp-port 9602 --port 9225 --unthrottled`、`workcrate-presets.mjs`、相同 profile 重启后 `workcrate-presets.mjs --check-restart`、MCP smoke、`errors.mjs --wait 1500` | 9 类预置、保存读取、非法重复字段不改原数据、原生物料保存/同步往返通过；DOM 确认基础信息分页、5 个主物料和 8 个扩展参数下拉框、底部提示；手动清空/删除在重启后保留。截图 `artifacts/verify/workcrate-basic-information.png`、`artifacts/verify/workcrate-material-presets.png`；报告 `artifacts/verify/workcrate-presets.json`。 |
| 2026-10-28 | WorkCrate 自动刷新、编辑页排序与双向同步 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-sync-final --access full --write-root artifacts/verify/samples --mcp-port 9602 --port 9225 --unthrottled`、`workcrate-sync.mjs`、`mcp.mjs smoke`、`errors.mjs --wait 1500` | 9 项专项断言通过：外部保存自动刷新、手动同步保持编辑页和选中画板、三页签文案、编辑页新增画板入口、原生排序落盘、重复 ID 拒绝、GUI 未保存修改自动同步、WorkCrate 新增/排序和物料写入已打开 GUI。DOM 确认可拖动入口；按约定未用鼠标/DOM 模拟拖动，排序功能通过 MCP 验收。渲染异常 0。截图 `artifacts/verify/workcrate-sync-{projects,pages,editor}.png`，报告 `artifacts/verify/workcrate-sync.json`。外部启动的 VectorCraft 需启用配置的控制端口，且写入时切到对应工程文档。 |
| 2026-10-28 | WorkCrate 带引号路径创建修复 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-path-fix --access full --write-root artifacts/verify/samples --mcp-port 9602 --port 9225`、`workcrate-project.mjs`、`mcp.mjs smoke`、只读 DOM、`capture.mjs`、`errors.mjs --wait 1500` | 带首尾空白及双引号的 CLI 路径经 MCP 保存、读取后正确归一化；原生文档和便携 project.json 均落盘，1 个初始画板，重新打开同步成功；页面项目卡片及预览正常，无 alert，渲染异常 0。截图：`artifacts/verify/window.png`。 |
| 2026-10-28 | WorkCrate MCP 创建链路与开发权限规则 | `npm run guard`、`npm run typecheck`、`npm run build`、`launch.mjs --profile artifacts/verify/profiles/workcrate-create-mcp --access full --write-root artifacts/verify/samples --mcp-port 9601 --port 9224`、`workcrate-project.mjs`、`mcp.mjs smoke`、`workcrate_panel_open`、`capture.mjs`、`errors.mjs --wait 1500` | 通过 MCP 配置 VectorCraft CLI、创建工程/原生文档/初始画板，画板目录含 1 页；通过 MCP 打开 WorkCrate 并检查窗口截图。渲染异常 0。截图：`artifacts/verify/window.png`；隔离工程位于 `artifacts/verify/samples/WorkCrateMcp-*`。 |
| 2026-10-28 | F0 安全地基 | `store.mjs`、`jobs.mjs` | 全绿（store 22 条 / jobs 12 条断言） |
| 2026-10-28 | F0 实机 | `launch.mjs --build` → `mcp.mjs smoke` → `mcp-guard.mjs` → `errors.mjs` → `stop.mjs` | 冒烟 12 个工具；权限矩阵 20/20 通过；渲染层异常 0；审计落盘 5 条；暂存篮跨重启保留 |
| 2026-10-28 | F1–F5 统一回归 | `files.mjs`、`annotations.mjs`、`thumbnails.mjs`、`paging-watch.mjs`、`index-search.mjs`、`perf.mjs`、`settings-commands.mjs`、`launcher.mjs`、`clipboard.mjs`、`notes-whiteboard.mjs`、`updater.mjs` | 文件操作/人工批准/撤销、标签合并、缩略图缓存、501 项分页与 watcher、7,420 项索引和搜索、1k/10k/100k 性能、设置/命令/启动台、剪贴板图片、白板场景均通过；更新仅检查只读 IPC 状态 |
| 2026-10-28 | 最终质量门 | `npm run guard`、`npm run typecheck`、`npm run package:dir`、`errors.mjs --wait 1500`、`capture.mjs` | guard/typecheck/目录打包通过；重载后渲染异常 0；窗口截图已生成 |
| 2026-10-28 | 缩略图缓存守护例外 | `npm run guard`、`npm run typecheck`、`npm run build`、`launch.mjs`、`errors.mjs --wait 1500` | 单一 `desksuite.explorer.thumbnails` 键例外通过守护；缓存限 60 项 / 3.5 MB 且按修改时间隔离；在 Pictures 图片目录验证 JPEG 缓存写入并重载恢复，1 项 / 5,527 字符；渲染异常 0 |
| 2026-10-28 | MCP 单工具脚本退出 | `launch.mjs`、`mcp.mjs call list_directory`、`errors.mjs --wait 1000`、`stop.mjs` | 单工具调用成功并以 0 退出；调整脚本为设置 `process.exitCode`、等待网络句柄自然关闭；渲染异常 0 |
| 2026-10-28 | 暂存篮浮层与窗口适配 | `npm run guard`、`npm run typecheck`、`npm run build`、`launch.mjs`、CDP UI 检查、`errors.mjs --wait 1000` | 暂存篮实测 400×320、关闭后面板消失且应用仍运行、渲染异常 0；主窗口按主显示器工作区限制初始尺寸 |
| 2026-10-28 | 分组视图工具栏与分组方式 | `guard`、`typecheck`、`build`、`launch`、`mcp.mjs smoke`、CDP 工具栏/分组切换检查、`capture.mjs`、`errors.mjs` | MCP 冒烟通过；工具栏分组视图可开关，类型/修改时间（分钟）/评分/所在文件夹四种分组均可切换，子文件夹可显示；分组折叠后 0 张卡片、展开恢复；图片缩略图可见；渲染异常 0；截图 `artifacts/verify/window.png` |
| 2026-10-28 | 默认窗口尺寸 | `guard`、`typecheck`、`build`、`launch`、CDP viewport 检查 | 默认窗口目标尺寸为 3000×2000，当前显示器将实际 viewport 限制为 2560×1392 |
| 2026-10-28 | 文件工具栏整理 | `guard`、`typecheck`、`build`、`launch`、`mcp.mjs smoke`、CDP 行高/可见控件检查、`capture.mjs`、`errors.mjs` | 地址导航与视图操作分行；工作区/窗格控制并入视图行；全局索引搜索移至 `top.actions`，目录搜索保留在地址栏；工具栏无滚动容器；MCP 冒烟通过、渲染异常 0；截图 `artifacts/verify/window.png` |
| 2026-10-28 | Lore / WorkCrate 初版集成 | `npm run guard`、`npm run typecheck`、`npm run build`、`launch.mjs`、`mcp.mjs smoke`、`versions_state`、`workcrate_projects_list`、WorkCrate 创建/删除临时工程 UI、`errors.mjs --wait 1500`、`capture.mjs` | guard/typecheck/build 通过；Lore bridge release 构建成功；MCP 列表包含版本、工程与画板工具；未版本文件返回 `unversioned`，工程列表可读；WorkCrate 工程创建可用，临时工程已移入应用回收区；渲染异常 0；界面截图：`artifacts/verify/lore-versions.png`（Lore 空状态）、`artifacts/verify/workcrate.png`（WorkCrate 空列表） |
| 2026-10-28 | Lore / Version Info / WorkCrate 隔离验收 | `npm run guard`、`npm run typecheck`、`npm run build`、`launch.mjs --profile artifacts/verify/profiles/lore-workcrate --access full --write-root artifacts/verify/samples --port 9223`、`mcp.mjs smoke`、Lore 创建/状态/列表/恢复、WorkCrate 创建/引用/修改/移除/删除、`errors.mjs --wait 1500`、`capture.mjs` | Lore 隔离样本恢复回版本 1 后再次创建版本；时间线展示 3 个版本及当前标记和 main 分支。WorkCrate 引用显示 `available: true`，引用更新与移除成功；工程删除成功且源样本保留。修复 void MCP 操作返回无效结果的问题后，删除操作返回合法 `null`。guard/typecheck/build 通过；MCP 冒烟通过；事件桥改为单个底层监听器后渲染异常/警告 0。截图：`artifacts/verify/lore-versions-current.png`、`artifacts/verify/workcrate-current.png`。隔离 profile 内保留 Lore 合成样本和版本，未读取或迁移旧程序历史数据。 |
| 2026-10-29 | 标签面板样式重做与标签聚合视图 | `guard`、`typecheck`、`build`、`launch.mjs --profile artifacts/verify/profiles/tagview --access full --mcp-port 9601 --write-root artifacts/verify/samples`、`tagview-smoke.mjs`、只读 bridge IPC + DOM 断言、`errors.mjs --wait 1500`、`capture.mjs` | annotations 新增 `pathsForTag`/`counts` IPC 与 `tag_files` MCP；filesystem 新增 `statPaths`；explorer 增加标签聚合虚拟模式（面包屑标签芯片 + 退出聚合，`panes` 服务暴露 `showTagAggregate`）；TagPage 重做为可折叠树 + 缩进参考线 + 计数徽标 + 悬停操作 + 选中高亮，点击标签联动中间聚合视图。tag_files 父标签聚合含子孙标签文件通过；渲染进程 bridge 调用 `tree`/`counts`/`pathsForTag` 通过；渲染异常 0。截图 `artifacts/verify/window.png`。标签面板内的点击联动未做 DOM 模拟（遵守只读约束），由用户在界面实测确认 |

产物见 `artifacts/verify/{launch,smoke,mcp-guard,errors}.out`。

本轮统一验证产物（包括各专项 JSON 报告、`electron.log` 和 `window.png`）均位于 `artifacts/verify/`。尚未自动化覆盖：F1-2 系统拖出交互、F2 会话/工作区恢复与多栏切换、F5-5 笔记的完整选目录/读写/预览交互。更新服务没有发布源，未触发网络检查、下载或安装。`npm run package:dir` 成功生成 `release/win-unpacked/DeskSuite.exe`；electron-builder 提示缺少 package description/author、使用默认图标且未签名，这些提示不影响目录包生成。


### 2026-10-30 笔记新建与保存修复验收

- 隔离实例：`launch.mjs --profile artifacts/verify/profiles/notes-fix --access full --write-root artifacts/verify/samples --mcp-port 9623 --port 9248 --unthrottled`。
- `guard`、`typecheck`、`build`、`notes-editor.mjs` 通过。MCP 验证现有笔记覆盖保存、新建草稿、拒绝覆盖脏草稿、preparesave 批准前不落盘、approvesave 落盘后列表立即达到 3 篇且可选择新笔记、frontmatter/图片相对引用保留、重载恢复；MCP 截图 `note-editor.png` / `note-editor-restored.png` 已查看，报告 `note-editor.json`。
- 目录选择改由 notePanel 自有系统选择框明确授权写入，保留默认 MCP access 与既有目录约束；MCP setroot 不新增权限。按项目约定未自动操控系统对话框，原生目录选择授权需用户实际选择一次。
- 相对图片笔记重载时 `errors.mjs` 捕获 2 条现有 `out/renderer/assets/pic.png` 瞬时请求失败（随后代理为 data: 图片显示通过）；与笔记落盘无关，未在本次扩展处理。

### 2026-10-30 笔记插件功能扩展验收

- 隔离实例：`launch.mjs --profile artifacts/verify/profiles/notes-n6 --access full --write-root artifacts/verify/samples --mcp-port 9628 --port 9258 --unthrottled`。
- `npm run guard`、`npm run typecheck`、`npm run build`、`notes-editor.mjs` 通过。脚本覆盖保存审批、新建保护、统一资源 URI 图片、frontmatter 往返、全文搜索、大纲统计、草稿 Store 恢复/丢弃及原文不被覆盖；另经 MCP 按完整路径选择笔记、`note_query` 搜索/大纲和 `mcp.mjs smoke` 通过。
- 修复旧相对图片在编辑器创建前被 Chromium 当作应用包相对路径请求的问题；本轮 `errors.mjs --wait 1500` 返回 0 个错误/警告。MCP 截图 `note-editor.png` / `note-editor-restored.png` 已查看，报告 `note-editor.json`。
- Eagle 的原生 API 需要实际运行的 Eagle 才能端到端验证；本轮只确认 Eagle MCP 工具已注册。N7 对齐、N15 文件管理剩余项、N16、多项 N21 MCP 动作、N35 watcher、N38 文本差异、N39 PDF 与 N40 全面拆分仍按 `docs/NOTE_EDITOR.md` 记为未覆盖/部分实现。

### 2026-10-30 笔记插件扩展补充验收

- 对最终增强后的 `notes-editor.mjs` 在隔离 profile `artifacts/verify/profiles/notes-final` 重新验收，启动参数为 `--access full --write-root artifacts/verify/samples --mcp-port 9630 --port 9260 --unthrottled`。
- MCP 专项通过：编辑器结构及标题/表格/代码/列表/图片渲染、全文搜索和大纲统计、frontmatter 保真保存、新建审批及脏草稿保护、属性编辑、查找替换、源码/阅读模式切换、Lore 快照与版本查询、渲染重载后草稿恢复且原文件未覆盖。报告 `note-editor.json`；MCP 截图 `note-editor.png` / `note-editor-restored.png` 已查看。
- `errors.mjs --wait 1500` 返回 0 个渲染错误/警告。隔离实例已结束；脚本 PID 与 Electron 实际主进程不一致，按进程命令行确认后停止了该实例。

### 2026-10-30 笔记防抖自动保存

- 后续修复编辑器重建：`NoteEditor` 曾监听父层 `value`，每次正文回传会重新解析并重建 Crepe。现改为每次挂载只捕获初始文档，编辑器实例持续维护选区与撤销历史；保存仅记录持久化快照并更新单文件列表元数据，不再整目录重扫。隔离 `notes-stable-editor`（full，samples 写入根，MCP 9633 / CDP 9263）运行专项，通过保留 ProseMirror DOM 远程句柄确认编辑与保存前后仍是同一节点，同时保存状态下保持可编辑。guard/typecheck/build 与 MCP 专项通过，重载错误/警告 0，MCP 截图已查看，实例已停止。

- 将笔记文档保存改为 700ms 防抖自动写入，移除面板手动保存按钮、Ctrl+S 保存入口及 MCP 保存计划/批准动作。目录授权后沿用写入计划、打开基线冲突检查和执行指纹检查；相同 Markdown 不创建计划或更新文件时间戳。切换笔记会先等待当前文档自动保存，崩溃恢复草稿仍独立暂存。
- `guard`、`typecheck`、`build`、`node --check scripts/verify/notes-editor.mjs` 和 `notes-editor.mjs` 通过。隔离 profile 使用 full 权限与 `artifacts/verify/samples` 写入根；专项通过正文/frontmatter 自动落盘、新建自动写入、无内容变化时不写入、源码/阅读模式切换不改变文件时间戳，以及自动保存后重载读取最新正文。另在自动保存状态下只读检查 Milkdown `contenteditable=true`，确认写盘不会锁住编辑器。`errors.mjs --wait 1500` 返回 0 个错误/警告。报告 `note-editor.json`；MCP 截图 `note-editor.png` / `note-editor-restored.png` 已查看。验证实例已停止。

### 2026-10-30 Lore 历史切换恢复修复

- 修复把 branch tip 当作工作区当前版本导致的恢复误判，以及中断恢复重试被分支图保护拦截的问题；时间线当前标记统一读取工作区实际版本。
- `get_job_status` 提供后台任务真实 error/summary；`get_audit_logs` 可读取持久化失败原因。
- `lore-restore.mjs` 基于 Shot 007.png 和其 Lore 历史创建隔离现场，通过 full MCP 验证恢复及 01/03/02 连续切换，并校验分支图/列表当前标记、失败任务与审计错误一致。
- 原文件恢复至 02，245940 字节，状态 saved，无 pendingRestore。报告：`artifacts/verify/lore-restore.json`、`lore-restore-isolated.json`；MCP 截图：`lore-restore-original.png`。

### 2026-10-30 版本信息持久化查询与 Lore 操作分离

- 新增 version_snapshots 迁移，持久化完整状态、源文件元数据、全部历史 SHA-256 指纹、中断恢复、同步时间、操作标记和错误；已有实体、版本条目和分支图继续存储在同一 SQLite 库。
- list/state/branchGraph 全部只读数据库；启动与面板刷新不运行 Lore。后台目录监听依据已存指纹更新文件修改/匹配历史/失联状态并入库。实际创建、恢复、分支操作与显式 reconcile 调用 Lore，完成后用一个 SQLite 事务更新投影。
- `version-storage.mjs`：反复查询不增加 bridgeLaunches；创建版本、01/03/02 恢复、创建/切换分支后投影一致；同 profile 重启后完整投影保持一致且 Lore 启动数为 0。隔离复制历史时重写 `.lore/config.toml` 的绝对 shared_store_path，确保对象库也在隔离 profile 中。
- 显式同步实际库的已有历史，校验同步前后各源文件 SHA-256 相同。实际界面读取前后 Lore 调用计数保持 10（仅显式迁移产生）。截图 `version-storage.png` / `version-storage-original.png` 已查看，DOM 确认时间线与内容匹配状态正确。
- guard、typecheck、Lore release 构建与 electron-vite build 通过；报告 `artifacts/verify/version-storage.json`、`version-storage-restart.json`、`version-storage-migration.json`。
- 验证现场说明：早一轮复制 profile 未重写 Lore 的绝对 shared_store_path，一条“隔离验证起点”测试提交进入实际历史。已修复 lore-restore.mjs / version-storage.mjs 的对象库重定位，并在独立对象库中重跑全部操作与重启验证。原文件字节未改动，该测试提交保留在实际历史，未删除提交。最终独立对象库报告包含 200 次元数据读取，中位耗时约 12.4ms，反复读取及重启均不新增 Lore 进程。

### 2026-10-30 版本操作错误残留与保存入口修复

- 恢复被业务校验拒绝时，若读取模型同步成功，不再把业务错误写入 synchronizationError；真实错误仍保留在后台作业和 audit。同步本身失败才保留同步错误。
- 版本面板适配统一命令层的 requiresApproval 计划，批准并执行后再跟踪真实 jobId；恢复/解除阻塞复用已有确认。说明允许为空，实体锁内自动命名“版本 N”，保存按钮不再与“说明可选”矛盾；成功任务清除提交提示。
- 新鲜隔离仓库（version-action-recovery-final，full，samples 写入根）通过 MCP 创建 01/02；停机准备不同文件输入后复现匹配旧版本，验证恢复拒绝→同步错误为 null→空说明保存成功为“版本 3”；生产 UI 计划适配器的 approve/execute 协议通过，DOM 确认空说明可保存且无同步失败提示。源文件哈希未变。
- 原文件 Shot 007.png 通过 MCP 成功保存为“版本 6”，状态 saved，synchronizationError=null；最终实际实例已加载修复，DOM 确认保存按钮可用，截图 version-actions-original.png 已查看。
- guard、typecheck、Lore release 构建及 electron-vite build 通过。报告 version-action-recovery.json；截图 version-action-recovery.png / version-actions-original.png。

### 2026-10-30 笔记三栏主题与概念图对照

- 隔离 profile `artifacts/verify/profiles/notes-theme-layout` 使用 `--access full --write-root artifacts/verify/samples --mcp-port 9631 --port 9261 --unthrottled`。通过 `note_panel` MCP 建立 6 篇概念样例笔记，主文档含设计目标、核心交互、任务清单、视觉反馈、快捷键和说明；补齐 2 个反向链接、3 个标签和 8 个 Lore 历史版本。
- `npm run guard`、`npm run typecheck`、`npm run build` 通过。只读 DOM 确认常驻 TopBar 已关闭、选区工具栏已挂载，主标题字号为 28px，左右侧栏宽度分别为 290px / 350px。浅色与深色主题均经 MCP 截图检查；`errors.mjs --wait 1500` 为 0 错误/警告。
- 截图：`artifacts/verify/note-concept-light.png`、`artifacts/verify/note-concept-dark.png`；MCP 笔记样例位于 `artifacts/verify/samples/notes-concept`。

### 2026-10-30 笔记侧栏分区隔断

- 左侧“最近编辑 / 我的笔记 / 标签”和右侧“目录 / 反向链接 / 标签 / 版本历史”增加主题化底部分隔线与一致留白；隔断在分区折叠时仍保留。
- `npm run guard`、`npm run typecheck`、`npm run build` 通过。使用 `note_panel` MCP 打开概念样例，DOM 只读检查确认相关分区边框、内边距和外边距生效，`capture_window` 已查看。
- 截图：`artifacts/verify/note-concept-separators.png`；渲染错误/警告：0。


### 2026-10-30 资源管理器概念图样式优化

- 蓝色强调与紧凑 UI 原语、两行导航/工具栏、暖色文件夹卡片、文档预览装饰、固定 152px 分组卡片与文件大小/评分/收藏、驱动器容量卡片、扁平属性分区及整行主操作。移除单窗格持续紫色描边；保留多窗格活动提示。
- 分组视图增加 `getFavorite` 回调契约；MCP `quick_bookmarks_explorer` 增加 view 操作，复用活动窗格生产视图切换。
- 隔离 profile `artifacts/verify/profiles/explorer-concept`，full，write-root `artifacts/verify/samples`，MCP 9641 / CDP 9271。`guard`、`typecheck`、`build`、MCP smoke、`explorer-concept.mjs` 通过；导航、视图切换、选择、评分、收藏、书签均经自身 MCP 操作，CDP 仅只读检查。2048 / 1280 宽度无工具栏横向溢出；浅/深主题 MCP 截图已查看。`errors.mjs --wait 1500`：0 错误/警告。
- 截图 `explorer-concept-light.png`、`explorer-concept-dark.png`、`explorer-concept-compact.png`；几何报告 `explorer-concept.json`。构建保留现有 Leafer 动静态导入提示。


### 2026-10-30 顶部导航下工具栏补齐

- 工作区前缀合入下拉框；新建与活动窗格组合；窗格布局贡献移至顶栏 `top.actions`。类型/标签/评分/收藏常驻左侧，排序/视图/分组/文件范围靠右，分组说明合入下拉框。工具栏控件统一 28px、浅灰底和 4px 圆角，宽窗口视图行 40px，窄窗口显示控件整组换行。
- `guard`、`typecheck`、`build` 通过。隔离 profile `explorer-toolbar`（full、samples 可写根、MCP 9641 / CDP 9271）运行 `explorer-concept.mjs`，通过 MCP 导航、切换视图、选择与元数据操作；只读 DOM 确认工作区文案、所有筛选下拉 28px、2048 宽度视图行 40px、1280 宽度无横向溢出。浅/深主题截图生成，浅色及窄窗口已查看。`errors.mjs --wait 1500` 为 0 错误/警告。
- 截图 `artifacts/verify/explorer-concept-{light,dark,compact}.png`；报告 `explorer-concept.json`。初次启动过早发出 MCP 导航曾超时，脚本已增加渲染挂载等待，最终新启动验证通过。隔离实例已结束。


### 2026-10-30 地址面包屑边框

- 面包屑整组增加灰色边框（浅色 #cbd5e1 / 深色 #475569）、浅底色和 6px 圆角，保持 28px 高度；内部跳转按钮为 24px，避免碰到外框。
- guard/typecheck/build、隔离 full 实例 explorer-concept MCP 验收通过；只读 DOM 确认边框颜色、圆角和高度，MCP 浅色截图已查看，渲染错误/警告 0。截图：artifacts/verify/explorer-concept-light.png。验证实例已停止。


### 2026-10-30 分组与内容视图组合、画廊单文件布局

- 每窗格 `groupingEnabled` 与 list/grid/gallery 独立。分组插件负责区块、折叠及递归范围，经 `renderGroup` / 可选 `renderLayout` 回调由资源管理器提供内容；三种模式切换不卸载分组组件。统一 FileCard 归资源管理器所有，卡片和画廊导航共用 152px 样式、评分/收藏/原生拖出。递归选择快照涵盖子文件。
- 画廊为左侧约 20% 单列卡片导航、右侧约 80% 唯一文件查看区。左栏最小 192px，保留分组/折叠、独立滚动、吸顶组标题；右侧仅按当前 focusedPath 渲染一次预览，包含子目录条目也使用同一查看区。窄窗口保留卡片尺寸，查看区占剩余宽度。
- session/workspaces 增加分组开关字段；旧 grouped 记录迁移为 grid＋分组；无关局部会话更新不重置开关。MCP quick_bookmarks_explorer.view 增加 groupingEnabled/groupBy/includeChildren，复用生产 store 和插件服务。
- guard/typecheck/build、MCP smoke、explorer-concept 与 explorer-view-composition 专项通过。full 隔离实例 view-composition，samples 写入根，MCP 9641/CDP 9271。六种组合、卡片样式一致性、每区块列表虚拟化、递归条目选择、四种分组、旧 grouped 迁移、局部更新保留开关、画廊单列/纵向滚动/唯一预览/20:80 几何通过。浅色、深色及 1280 窄窗口截图已查看。最终 gallery＋分组在完整应用重启后恢复通过。errors --wait 1500：0 错误/警告。
- 报告：explorer-composition.json、explorer-composition-restart.json；截图：explorer-gallery-final.png、explorer-gallery-dark.png、explorer-gallery-compact.png、explorer-composition-grouped-list.png。实例已停止。
