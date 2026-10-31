# PORTS — system-basic-window-controls (renderer)

Renderer plugin that renders the frameless-window traffic controls in the top bar right corner.

## Metadata

| Field | Value |
| --- | --- |
| Kind | renderer plugin |
| Domain | `system` |
| Category | `basic` |
| Name | `window-controls` |
| Entry | `index.tsx` |
| Main capability | `system-basic-window-controls` |

## Slot contributions

| Slot | Contribution id | Content |
| --- | --- | --- |
| `top.window_controls` | `window.controls` | Minimize / maximize-restore / close buttons |

## Services

Provides: none.
Consumes: `ui` not required (buttons are local to this plugin).

## Main-process IPC used

| Service | Method | Purpose |
| --- | --- | --- |
| `windowControl` | `minimize` / `toggleMaximize` / `close` | Window actions |
| `windowControl` | `state` | Initial `{ maximized, fullscreen, focused }` |

## Events consumed

- `window:state` — window state broadcast from the main plugin; drives the maximize/restore icon.
- The initial `state` result and `window:state` event share a plugin-local strict Zod schema. Invalid events are ignored, preserving the most recent valid state.

## Behaviour notes

- Double-click on any `.app-drag` region toggles maximize (ignores `.app-no-drag` children).
- The top bar must remain draggable; this plugin never changes `-webkit-app-region` outside its own button group.
