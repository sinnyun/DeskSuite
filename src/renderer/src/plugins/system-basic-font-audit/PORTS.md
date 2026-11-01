# system-basic-font-audit

- Domain / class / name: `system` / `basic` / `font-audit`
- Entry: `index.tsx`
- Contributions: `font-audit.open` in `sidebar.activity.bottom`; `font-audit.panel` in `floating.panels`.
- Setup injects a global renderer stylesheet and toggles the `desksuite-font-audit` document class. It removes both when the plugin is disabled.
- The audit preference is UI-only and stored at `desksuite.workbench.font-audit.enabled`.
- Overrides the primary, secondary, muted, subtle, success, warning, and danger text semantic colors while enabled. The legend documents the fixed audit palette.
- Consumes the `commands:action` broadcast for `font-audit.toggle` and `font-audit.set:true|false`.
- No IPC handlers or renderer services are provided. The shared command provider registers `system.toggle-font-audit` and `system.set-font-audit`, exposed by MCP `command_list` / `command_run`.
- UI strings are Chinese. The panel has a fixed 420×500 px footprint with internal scrolling.
- Typography role sizes are read at runtime from the `--ds-type-*` CSS variables on `documentElement` (configured in Settings → Appearance); the role table and mismatch detection follow those live values instead of hard-coded pixels.
