# system-basic-updater

- 域 / 子类 / 名称：`system` / `basic` / `updater`
- 入口：`index.ts`
- 依赖：Cordis `ipc`、`store`；Electron `app`；`electron-updater`。
- IPC 服务 `updater`：`get()`、`setFeedUrl(url)`、`check()`、`download()`、`install()`。
- 事件：`updater:state` 推送状态、当前/可用版本、下载百分比、更新源与打包模式。
- 更新源保存在共享原子 store 的 `updater.settings`；可填写 HTTPS GitHub 仓库地址或 Releases 页面，插件会解析 owner/repo。
- 自动下载和退出安装均关闭；必须由用户明确点击下载和安装。开发版不能检查或安装更新。
- 使用 `electron-builder.config.cjs` 打包；设置 `DESKSUITE_GITHUB_OWNER` 与 `DESKSUITE_GITHUB_REPO` 后会生成 GitHub 更新元数据。`npm run package:win` 生成 NSIS 安装包，`npm run package:dir` 生成解包目录。
- 发布需手动完成：将 `release/` 下的 `latest.yml` 和对应安装包上传到配置的 GitHub Releases release。脚本不会创建或上传 Release。
