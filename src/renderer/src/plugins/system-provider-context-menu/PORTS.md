# System Provider: Context Menu

- Domain: `system`
- Class: `provider`
- Name: `context-menu`
- Entry: `index.tsx`

## Dependencies

- Renderer host slot `overlay.root` for the menu layer.
- Vanilla stores `layoutStore` / `themeStore` from the workbench for builtin desktop fallback actions.
- Main process broadcast `dev:context-menu` (from `system-basic-dev-lab`) for automated verification.

## Provided renderer service `contextMenu`

- `register(zoneId, handler, { order? }) => dispose`: register a menu builder for a zone. Handlers of the same zone run in `order` sequence (default 100); non-empty results are concatenated with separators between contributors. A throwing handler is skipped (logged) without breaking other contributors.
- `open(zoneId, x, y, context?) => boolean`: programmatically open a zone menu (used by verification and future in-app callers). Returns false when no handler produced entries.

## Contributions

- `context-menu.overlay` renders the global menu surface at `overlay.root` (z-120): viewport-clamped positioning, one-level-deep recursive submenus, separators, icons, shortcuts, checked and danger items, disabled items with reason tooltips, keyboard navigation (arrows / Enter / Space / Escape / Home / End), and dismiss on outside pointerdown, scroll, resize or window blur.

## Zone discovery contract

- Any element with `data-context-zone="<zoneId>"` routes right clicks to handlers registered for that zone; the deepest matching ancestor wins.
- Builtin zones: `__text` (extensible text-editing menu on editable targets) and `__desktop` (system fallback: command palette, settings, launcher, clipboard, theme, zen mode, reset layout).
- A zone that produces no entries falls back to `__text` / `__desktop`.

## MCP / debug channel

- Consumes broadcast `dev:context-menu` `{ zoneId, x?, y?, selector? }` to open a zone menu without a real right click (verification only). `selector` resolves a concrete element as the menu target to simulate right-clicking a card; otherwise the zone element is used.

## Data and settings

- No persisted data. Menu state is ephemeral.
