# system-basic-command-palette

- Domain / class / name: `system` / `basic` / `command-palette`
- Entry: `index.tsx`
- Contribution: `commands.palette` in `floating.panels`, fixed at 640×480 px with internal scrolling.
- Uses `cmdk@1.1.1` for accessible search, keyboard selection, and command filtering.
- Reads command descriptors through `commands.list`; dispatches `commands.run` and uses `commands.approve` / `commands.execute` for mutating plans.
- Opens with Ctrl+K. Registered command keybindings dispatch the same command IDs.
- Subscribes to `commands:approval` for MCP-originated requests and `commands:action` for built-in panel/theme actions.
- Decodes command descriptors, MCP approval events, action events, UI approval plans, and MCP tool results with plugin-local Zod schemas before storing or applying them. Unsupported/malformed action strings and invalid events are ignored with a friendly panel error.
- Shows permission badges and a human approval dialog before mutating commands execute.
- UI strings are Chinese.
