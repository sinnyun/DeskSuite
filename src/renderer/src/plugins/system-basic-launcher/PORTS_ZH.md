# PORTS — system-basic-launcher（渲染层）

通过固定尺寸悬浮面板搜索并启动已安装应用。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `system` / `basic` / `launcher` |
| 入口 | `index.tsx` |
| 主进程能力 | `system-basic-launcher` |

## 槽位贡献

- `sidebar.activity`：打开启动台面板。
- `floating.panels`：`launcher.panel`，初始尺寸 1240×760 px，可调整大小，包含分类导航、应用卡片网格和程序详情。

## 服务与 IPC

消费 `ui`，以及 `launcher.list(query?, offset?)`、`launcher.summary(query?)`、`launcher.refresh()`、`launcher.open(id)`、`launcher.icon(id)`、
`launcher.groups()`、`launcher.createGroup(name)`、`launcher.renameGroup(id, name)`、`launcher.deleteGroup(id)`、
`launcher.assignGroup(id, groupId?)`。面板支持用户分类、程序归类，以及按名称/路径/发布者搜索。

写入面板状态前，插件使用本地 Zod schema 对 IPC 结果进行运行时校验：分页条目（最多 250 项）、分类（最多 100 项）、汇总计数和可空图片 data URL。无效响应会进入面板已有的错误提示流程；图标校验失败时退回默认图标。

不消费 MCP 工具、事件或配置项。

## 右键菜单

面板内容区注册 `launcher.panel`（order 10）：启动项（`data-launcher-entry/-name/-path`）提供启动、在文件管理器中定位、复制路径、分配到分类子菜单（未分类 + 各分组，当前分组打勾）与重新扫描；分组行（`data-launcher-group/-name`）提供重命名与删除；空白处提供重新扫描。依赖 `contextMenu` 服务。
