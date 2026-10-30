# system-provider-settings

- 域 / 子类 / 名称：`system` / `provider` / `settings`
- 入口：`index.ts`
- 注入：`ipc`、`store`、`config`。
- 提供 Cordis 服务 `settings`：`register(namespace, zodSchema, defaults, metadata?)`、`listSchemas()`、`list()`、`get(namespace)`、`set(namespace, value)`，以及用于实时更新的 `subscribe(listener)`。注册元数据支持 `title`、`description`、`category`（`program` 或 `plugin`，默认为 `plugin`）及可选的导航分组 `group`。
- 内置程序设置使用 `program` 分类；插件注册项显示在「插件设置」下，并可提供分组名称。
- 设置 schema 在主进程校验并生成 JSON Schema。插件命名空间通过 `store` 持久化到 `data/settings.json`；内置 `mcp` 命名空间写回 `config.json`，使访问权限立即生效。
- IPC：`settings.list`、`settings.get(namespace)`、`settings.set(namespace, value)`。
- 事件：成功写入后广播 `settings:changed`，载荷为 `{ namespace, value }`。
- MCP 工具：无。
