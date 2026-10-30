# system-basic-shell

## Metadata

- Domain: `system`
- Category: `basic`
- Name: `shell`
- Entry: `index.tsx`
- Layer: renderer (slot UI plugin)

## Dependencies

- Imports `workbench/sdk` only (`definePlugin`, `SlotRenderer`, `useLayout`, `useTheme`, `useUiKit`, `useContributions`, `log`).
- Consumes the `ui` service provided by `system-provider-ui-kit`.
- Opens floating panels by id (`analytics`, `basket`, `clipboard`, `settings`) through the host layout store.
- Window dragging uses `.app-drag` / `.app-no-drag`; window buttons are contributed by `system-basic-window-controls`.

## Contributions

| Slot | Id | Description |
| --- | --- | --- |
| `app.root` | `shell.root` | Full workspace frame: top bar, activity rail, left/right sidebars, center workspace, bottom dock, status bar, splitters, floating host |

Internal slot containers rendered by the shell: `top.actions`, `top.window_controls`, `sidebar.activity`, `sidebar.activity.bottom` (fixed bottom group), `sidebar.left.tabs/content`, `workspace.toolbar/views`, `sidebar.right.tabs/content`, `bottom.tabs/toolbar/content`, `statusbar.left/right`, `floating.panels`.

## Splitter collapse

Left/right sidebar and bottom dock splitter handles reveal a collapse button on hover; collapse state lives in the host `useLayout` store. A contribution `label` (receives `{ active }`) renders dynamic tab text and badges.

## Keyboard shortcuts

`Ctrl+B` left panel, `Ctrl+Shift+B` / `Ctrl+I` right panel, `Ctrl+J` bottom dock, `Ctrl+Alt+R` reset layout, `F11` zen mode, `Alt+W` floating panel, `Alt+1/2/3` analytics/basket/clipboard panels.

## Events

None. All UI state is owned by the host `useLayout` store.
