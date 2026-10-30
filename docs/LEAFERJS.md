# LeaferJS development

## Knowledge source

For any task that adds, changes, reviews, or explains LeaferJS usage in DeskSuite, use the installed Codex `leafer-ai` skill first. Treat it as the preferred LeaferJS reference and follow its guidance to consult the `leaferjs/ai-docs` repository, starting with `examples`, then `guide`, `reference`, `plugin`, and `src` as needed. Check current package APIs against those sources before relying on remembered behavior.

Skill: `leafer-ai`  
Knowledge source: <https://github.com/leaferjs/ai-docs>

## DeskSuite boundaries

- LeaferJS runtime and UI code belong in renderer plugins. Put canvas features in `src/renderer/src/plugins/canvas-*`; keep each feature within its own plugin folder and expose cross-plugin capabilities through renderer services.
- Shared Leafer image/resource loading belongs in `data-provider-resources`. Consumers should use that service instead of creating unrelated global resource caches or importing another plugin's files.
- Use `leafer-x-easy-snap` for whiteboard element snapping and alignment guides. Keep `Snap` lifecycle/configuration in the whiteboard engine; represent persisted ruler guides as invisible Leafer snap targets instead of adding a parallel coordinate snapping algorithm.
- The resource library's `LeaferPreview` is an approved display-only integration. New shared resource integrations should extend the resource provider rather than adding arbitrary package imports to unrelated plugins.
- Keep Leafer instance creation, event subscriptions, timers, and observers tied to the owning component or plugin lifecycle. Dispose them on teardown, and release only resources owned by that integration.
- Persist board/domain data through main-process plugin services and expose operations through IPC/MCP as required by the feature. Renderer browser storage is for UI preferences only.
- Keep scene format validation, compatibility, and migration behavior in sync with the canvas storage plugin's contract. Update relevant plugin `PORTS.md` and `PORTS_ZH.md` when an exposed capability changes.
- Use the existing pinned Leafer package versions in `package.json`; coordinate package upgrades with a review of the skill's current guidance and the affected integrations.

## Whiteboard plugin coverage

- `@leafer-in/editor` owns element selection, transforms and inner-editor lifecycle; `@leafer-in/export` owns Leafer rendering exports.
- `@leafer-in/text-editor` is a direct pinned dependency. Plain text/notes use one native Text and its official TextEditor; a scoped capture listener keeps composing/229 key events from triggering the plugin's Enter/Escape shortcuts. HTML formatting remains an explicit rich-text mode, with sanitization and existing layout compatibility.
- Native Group containers own grouping, entering/leaving groups and group transforms. Scene `groups` stores optional parent IDs and board-space transforms; leaf geometry remains in board space for compatibility with resources, overlays and old scenes. Reparenting/decomposition uses Leafer dropTo/Matrix, never a second transform algorithm. Old flat group IDs synthesize identity containers. Group hierarchy is acyclic, depth limited to 64, and group scales must be nonzero.
- Scene edits structurally share unchanged node records/arrays. The engine skips node work on view/selection/save-only notifications, patches compatible instances, and rebuilds only on representation/type/resource changes. Rich-text subtrees reflow only when content or dimensions change.
- `leafer-x-easy-snap` owns alignment snapping and spacing guides. The whiteboard extends its documented `collectSnapElements()` hook so persisted ruler guides participate in that plugin's snap calculations.
- `leafer-x-clip-resize-inner-editor` owns image clipping. Whiteboard commands only open the inner editor, call its size/ratio/reset API, and save its native child-image transform. Do not add a second crop math path.
- LeaferJS GitHub documents additional packages such as `@leafer-in/viewport`, and community tools such as `leafer-x-ruler`, `leafer-x-path-editor`, and connector plugins. Their features must be checked against the whiteboard's React overlays and persisted scene model before integration; they do not replace DeskSuite history, scene validation, resources, shortcuts, minimap, or text presentation.
- The whiteboard's arrange/group/history/resource operations are scene-model transactions. Keep these in canvas plugins unless a Leafer plugin exposes an equivalent persistent-data contract; transient editor operations alone are not a replacement for saved scene state.

## Guard

`npm run guard` restricts Leafer package imports to renderer canvas plugins and the two documented shared resource integrations above. If a new shared integration is needed, update this guide and the allowlist in `scripts/guard.mjs` together, with its ownership explained here.
