# system-provider-commands

- Domain / class / name: `system` / `provider` / `commands`.
- Entry: `index.ts`.
- Injects: core `commands`, `ipc`.
- Registers built-in workbench actions in the core `CommandsService`; this plugin owns no registry or approval state.
- Commands include panel and tab navigation (including the `debug-console` floating diagnostics panel and `system.open-debug-console`), sidebar and layout controls, renderer log clearing/reload, theme, settings, launcher, clipboard, font-audit mode control (`system.toggle-font-audit`, `system.set-font-audit`), renderer plugin enablement (`system.set-plugin-enabled`), and debug-console filter control (`system.set-debug-console-view`).
- UI and MCP invoke the same command definition. UI actions return an action descriptor; MCP actions broadcast `commands:action` for the renderer to apply.
- `system.set-debug-console-view` is the exception: it broadcasts the plugin-private `debug-console:view` channel with the validated patch (`{ search?, source?, levels?, categories?, expanded?, reset? }`, all optional, strict object) instead of a `commands:action` verb, because console filtering is owned by `system-basic-debug-console` and must not widen the shared action whitelist.
- Mutation metadata and plans are registered with each command and enforced by the shared command service.
- Events: consumes `commands:action` in the renderer command palette; broadcasts `debug-console:view` for the debug console plugin; core service broadcasts `commands:approval` for UI command approvals.
- `system.set-plugin-enabled` passes the requested state to the renderer plugin catalog, which enforces the core-plugin restriction and runs setup/dispose lifecycle handlers.
- This plugin provides no MCP tools directly. The core MCP adapter exposes `command_list` and `command_run` over the shared command registry.
