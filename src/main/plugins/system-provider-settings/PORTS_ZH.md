# system-provider-settings

- 域 / 子类 / 名称：`system` / `provider` / `settings`
- 入口：`index.ts`
- 注入：`ipc`、`store`、`config`、`storage`、`mcp`。
- 提供 Cordis 服务 `settings`：`register(namespace, zodSchema, defaults, metadata?)`、`listSchemas()`、`list()`、`get(namespace)`、只校验不写入的 `validate(namespace, value)`、`set(namespace, value)`，以及用于实时更新的 `subscribe(listener)`。注册元数据支持 `title`、`description`、`category`（`program` 或 `plugin`，默认为 `plugin`）及可选的导航分组 `group`。
- 内置程序设置使用 `program` 分类；插件注册项显示在「插件设置」下，并可提供分组名称。
- 设置 schema 在主进程校验并生成 JSON Schema。插件命名空间通过 `store` 持久化到 `data/settings.json`；内置 `mcp` 命名空间写回 `config.json`，使访问权限立即生效。
- IPC：`settings.list`、`settings.get(namespace)`、`settings.validate(namespace, value)`、`settings.set(namespace, value)`。
- 事件：成功写入后广播 `settings:changed`，载荷为 `{ namespace, value }`。广播 `settings:open` 可请求渲染层打开设置面板，载荷可选 `{ page?: 'runtime' | 'storage' | 'mcp' | 'plugins', namespace?: string }`。
- MCP 工具：`open_settings_page`（界面操作）打开指定设置页（`page`）或直接打开某个命名空间页（`namespace`，如 `appearance`），两者至少提供一个；`settings_validate` 只校验草稿并返回规范化值或字段路径/错误信息，不写盘、不广播已保存事件；`set_appearance`（界面操作）按字段更新 `appearance` 命名空间（`theme` 与 `fontSize.pageTitle/panelTitle/title/sectionTitle/body/label/data`，字号为 10–32 px 整数），未提供的字段保持当前值。
- 内置 `appearance` 命名空间包含 `theme`（light/dark/system）与 `fontSize` 对象（各排版层级字号，默认 24/20/18/16/14/13/12 px），渲染层据此设置 `--ds-type-*` CSS 变量。
- 持久化命名空间值读取时按对应 schema 校验；非法值记录诊断并回退该命名空间默认值，不重写非法原始值。

## 存储登记

- 注入 `storage`，在 `apply` 中登记本插件的数据位置；程序设置 →「存储」分页会聚合这些路径与磁盘占用。
