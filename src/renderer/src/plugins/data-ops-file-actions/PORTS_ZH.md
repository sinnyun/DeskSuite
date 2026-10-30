# 数据操作：文件操作界面

- 域：`data`
- 子类：`ops`
- 名称：`file-actions`
- 入口：`index.tsx`

## 依赖

- `data-ops-explorer` 提供的渲染服务 `selection`（可选；服务缺失时界面保持空闲）。
- 主进程命令注册表 `commands`；右键文件操作通过共享命令与批准流程派发 `file.*` 命令。
- 主进程 IPC 服务 `fileOps`。
- 主进程事件 `fileOps:approval`、`fileOps:done`、`job:progress`、`job:done`、`fs:changed`。
- 通过 `fileOps.getUndoStack()` 读取撤销记录，并由 `fileOps:undo-stack` 事件更新。
- 宿主槽位 `overlay.root`。

## 贡献

- `file-actions.overlay` 提供全局操作菜单、人工批准弹窗和固定尺寸进度面板。

## 使用的 IPC

- `fileOps.plan({ op, sources, target?, conflictPolicy? })`
- `fileOps.approve(planId)`、`fileOps.reject(planId)`、`fileOps.execute(planId)`、`fileOps.get(planId)`、`fileOps.cancel(planIdOrJobId)`、`fileOps.startDrag(paths)`。
- `fileOps.getUndoStack()` 与 `fileOps.undo(undoId?)`；成功撤销返回 `jobId`，stale/conflict 则返回状态和说明。

## 数据与设置

- 撤销栈非空时，进度面板显示最近一项可逆操作；任务完成后可展开查看逐项状态与说明。
- 本渲染插件不拥有持久化数据或配置项。
- 界面文案使用中文。
