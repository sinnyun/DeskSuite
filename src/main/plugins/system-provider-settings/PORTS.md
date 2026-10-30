# system-provider-settings

- Domain / class / name: `system` / `provider` / `settings`
- Entry: `index.ts`
- Injects: `ipc`, `store`, and `config`.
- Provides Cordis service `settings` with `register(namespace, zodSchema, defaults, metadata?)`, `listSchemas()`, `list()`, `get(namespace)`, `set(namespace, value)`, and `subscribe(listener)` for live updates. Registration metadata accepts `title`, `description`, `category` (`program` or `plugin`, defaults to `plugin`), and optional `group` for the settings navigation.
- Built-in application settings use category `program`; plugin registrations appear under `插件设置` and can supply a group label.
- Settings schemas are validated and serialized in the main process. Plugin namespaces persist below `data/settings.json` through `store`; the built-in `mcp` namespace updates `config.json` so access control takes effect immediately.
- IPC: `settings.list`, `settings.get(namespace)`, `settings.set(namespace, value)`.
- Event: `settings:changed` with `{ namespace, value }` after a successful write.
- MCP tools: none.
