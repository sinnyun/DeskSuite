# system-basic-settings

- Domain / class / name: `system` / `basic` / `settings`
- Entry: `index.tsx`
- Contributions: `settings.open` in `sidebar.activity.bottom` (the single lower-left settings entry); `settings.panel` in `floating.panels`.
- Consumes `settings.list/get/set` IPC. The main-process provider owns all schema validation and persistence; this plugin renders JSON Schema fields and submits complete namespace values.
- Consumes `filesystem.pickDirectory` to add allowed MCP write roots.
- Appearance mode is applied through the workbench theme service. Theme preference uses the existing UI preference storage.
- Settings are split into `程序设置` and `插件设置`; each settings namespace is shown as a card with card-style field controls. Plugin group labels come from registration metadata.
- The program section also contains runtime diagnostics, a storage inventory, and the MCP server/tool inventory; the plugin section contains the renderer plugin registry and enable/disable controls. These sections replace the former standalone control center panel.
- The storage page consumes `storage.list` to aggregate each plugin's registered data locations with on-disk sizes, and `storage.open` to reveal a location in the file manager. Sizes refresh on demand.
- Fixed panel size: 640×500 px; content scrolls internally.
- UI strings are Chinese.
