# system-provider-ui-kit

## Metadata

- Domain: `system`
- Category: `provider`
- Name: `ui-kit`
- Entry: `index.tsx`
- Layer: renderer (slot UI plugin)

## Dependencies

- Imports `RendererPlugin` types and `definePlugin` from `workbench/sdk` only.
- Consumes no other plugin.

## Provided services

| Service | Type | Description |
| --- | --- | --- |
| `ui` | `UiKit` | Theme-aware React primitives shared by every renderer plugin |

`UiKit` members: `DesktopButton`, `DesktopIconButton`, `DesktopInput`, `DesktopTextarea`, `DesktopSelect`, `DesktopCard`, `DesktopCardButton`, `DesktopTagPill`, `DesktopTab`, `ActivityButton`, `ThemeSidebarPanel`, `ThemeWorkspacePanel`, `ThemeCollapsibleSection`, `ThemeFloatingPanel`.

- `DesktopTab`: tab button with `label`, `icon`, `badge`, `active`, and `tone` (`pill` / `solid`).
- `DesktopSelect`: themed dropdown; options are `{ value, label }` with optional `icon` and `ariaLabel`.
- `DesktopCardButton`: themed selectable card surface; plugins provide content, behavior, and layout without repeating its color, border, radius, hover, focus, or selected styles.
- `ThemeFloatingPanel`: restores its position, size, and maximized state through `workbench/sdk` layout state; stable persistence keys default to the panel title.

## Slots

None. This plugin only publishes a service; it contributes no slot content.

## Events

None.
