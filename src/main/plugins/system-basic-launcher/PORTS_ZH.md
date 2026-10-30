# PORTS — system-basic-launcher

扫描 Windows 开始菜单快捷方式与已安装应用，向启动台提供查询和启动能力。

## 元数据

| 字段 | 值 |
| --- | --- |
| 域 / 子类 / 名称 | `system` / `basic` / `launcher` |
| 入口 | `index.ts` |

## 依赖（inject）

- `ipc`
- `store`

## IPC 服务

服务名：`launcher`

| 方法 | 参数 | 返回 |
| --- | --- | --- |
| `list` | `query?: string`、`offset?: number` | 下一页最多 250 个匹配缓存项 |
| `summary` | `query?: string` | 精确总数、快捷方式/应用数量和各分类数量 |
| `refresh` | — | 完整刷新后的项目列表 |
| `open` | `id: string` | 打开所选快捷方式/应用 |
| `icon` | `id: string` | 原生图标 data URL 或 `null` |
| `groups` | — | 用户自定义启动分类 |
| `createGroup` | `name: string` | 创建分类（名称唯一，最长 32 字符） |
| `renameGroup` | `id: string`、`name: string` | 重命名分类 |
| `deleteGroup` | `id: string` | 删除分类并清除对应程序归类 |
| `assignGroup` | `id: string`、`groupId: string \| null` | 设置或清除程序分类 |

缓存由版本化 store 文档持有，24 小时过期。用户分类与程序归类单独持久化，重新扫描后仍保留。Windows 数据源包括当前用户与公共开始菜单 `.lnk`，以及三个标准卸载注册表视图。PowerShell 使用固定脚本，不拼接用户输入。

## MCP 工具 / 事件 / 配置

无。

## MCP 工具 / 持久化

- `launcher_list`（只读）：分页读取程序及已保存的标题/说明。
- `launcher_groups`（只读）：读取分类、归类和信息覆盖项。
- `launcher_group_create`（写入，需 full 权限）：创建分类。
- `launcher_program_update`（写入，需 full 权限）：设置分类、显示标题和说明。

版本化 `launcher-library` store 持久保存分类、程序归类和每个程序的标题/说明覆盖项；扫描缓存持久保存 24 小时。
