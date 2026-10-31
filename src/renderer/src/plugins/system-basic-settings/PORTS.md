# system-basic-settings

- Domain / class / name: `system` / `basic` / `settings`
- Entry: `index.tsx`
- Contributions: `settings.open` in `sidebar.activity.bottom` (the single lower-left settings entry); `settings.panel` in `floating.panels`.
- Consumes `settings.list/get/validate/set` IPC. The main-process provider owns schema validation and persistence; this plugin validates drafts before saving, renders JSON Schema fields, and submits complete namespace values. `validate` is read-only and returns normalized values or structured field-path errors; `set` validates again before writing.
- Consumes `filesystem.pickDirectory` to add allowed MCP write roots.
- Appearance mode is applied through the workbench theme service. Theme preference uses the existing UI preference storage.
- Settings are split into `程序设置` and `插件设置`; each settings namespace is shown as a card with card-style field controls. Plugin group labels come from registration metadata.
- The program section also contains runtime diagnostics, a storage inventory, and the MCP server/tool inventory; the plugin section contains the renderer plugin registry and enable/disable controls. These sections replace the former standalone control center panel.
- The storage page consumes `storage.list` to aggregate each plugin's registered data locations with on-disk sizes, and `storage.open` to reveal a location in the file manager. The list response is decoded by a bounded plugin-local Zod schema before React state updates. Sizes refresh on demand.
- Runtime and MCP administration pages decode `runtime.info` and `mcp.getAccess` with plugin-local schemas before updating React state; runtime tool/service lists and string fields are bounded.
- Fixed panel size: 640×500 px; content scrolls internally.
- UI strings are Chinese.
