# system-basic-updater（渲染层）

- 域 / 子类 / 名称：`system` / `basic` / `updater`
- 入口：`index.tsx`
- 贡献：`top.actions` 更新入口；`floating.panels` 固定 500×380 更新面板。
- 使用 `updater.get`、`updater.setFeedUrl`、`updater.check`、`updater.download`、`updater.install` IPC 与 `updater:state` 事件。
- 面板允许用户配置 GitHub 仓库、检查版本、下载更新，并明确点击退出安装。
- Release 产物由仓库的 electron-builder 脚本生成；操作者需手动将 `latest.yml` 和匹配的安装包上传到 GitHub Releases。
- 渲染插件不保存数据；主进程插件负责校验和持久化更新源。
- 界面文案使用中文。
