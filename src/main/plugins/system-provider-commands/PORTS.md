# system-provider-commands

- Domain / class / name: `system` / `provider` / `commands`.
- Entry: `index.ts`.
- Injects: core `commands`, `ipc`.
- Registers built-in workbench actions in the core `CommandsService`; this plugin owns no registry or approval state.
- Commands include panel and tab navigation (including the `debug-console` floating diagnostics panel and `system.open-debug-console`), sidebar and layout controls, renderer log clearing/reload, theme, settings, launcher, clipboard, font-audit mode control (`system.toggle-font-audit`, `system.set-font-audit`), and renderer plugin enablement (`system.set-plugin-enabled`).
- UI and MCP invoke the same command definition. UI actions return an action descriptor; MCP actions broadcast `commands:action` for the renderer to apply.
- Mutation metadata and plans are registered with each command and enforced by the shared command service.
- Events: consumes `commands:action` in the renderer command palette; core service broadcasts `commands:approval` for UI command approvals.
- `system.set-plugin-enabled` passes the requested state to the renderer plugin catalog, which enforces the core-plugin restriction and runs setup/dispose lifecycle handlers.
- This plugin provides no MCP tools directly. The core MCP adapter exposes `command_list` and `command_run` over the shared command registry.
