# system-basic-updater

- 域 / 子类 / 名称：`system` / `basic` / `updater`
- 入口：`index.ts`
- 依赖：Cordis `ipc`、`store`、`storage`、`mcp`；Electron `app`；`electron-updater`。
- IPC 服务 `updater`：`get()`、`setFeedUrl(url)`、`check()`、`download()`、`install()`。
- MCP 工具：`updater_get`（只读状态）、`updater_set_feed` / `updater_check` / `updater_download` / `updater_install`（mutating；install 会退出应用）。
- 事件：`updater:state` 推送状态、当前/可用版本、下载百分比、更新源与打包模式。
- 广播更新状态前，错误文案由主进程 error-text helper 限长并脱敏；事件字段与状态协议保持不变。
- 更新源保存在共享原子 store 的 `updater.settings`；可填写 HTTPS GitHub 仓库地址或 Releases 页面，插件会解析 owner/repo。
- 自动下载和退出安装均关闭；必须由用户明确点击下载和安装。开发版不能检查或安装更新。
- 使用 `electron-builder.config.cjs` 打包；CI（`.github/workflows/release.yml`，tag `v*` 且与 package.json 版本一致）通过 `DEKSUITE_GITHUB_OWNER` / `DESKSUITE_GITHUB_REPO` 环境变量发布 NSIS 安装包与 `latest.yml` 到 GitHub Releases（electron-updater 运行时按更新源 owner/repo 读取，无需内嵌 app-update.yml）。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
