# data-ops-explorer-grouped

- Domain / class / name: data / ops / explorer-grouped. Entry: index.tsx.
- Provides renderer service `explorerGroupedView`: `component`, `toolbarComponent`, `configure({ groupBy?, includeChildren? })`, `getOptions()`.
- Optional consumer service `panes`: active store `getState().groupingEnabled`, `subscribe`, `setGroupingEnabled(boolean)`. Missing panes gracefully disables grouping controls.
- Consumes `ui` for controls and filesystem.listDir/listMore for recursive enumeration. No direct MCP or IPC registrations.

The component is an outer layout, independent of list/grid/gallery. Its contract accepts entries/allEntries/path, filterEntries, prepareEntries, registerEntries, getRating, and `renderGroup(entries): ReactNode`. It creates and folds sections; the explorer owns all entry rendering, selection, thumbnails and native file drag. Switching inner display mode keeps the layout mounted and retains collapsed sections.

Group modes: kind, modification minute, rating, folder. Groups preserve sorted entries; kind order is fixed and folder order starts with the current folder. Recursive aggregation is bounded to 500 directories / 25,000 entries. Group options are shared in renderer memory; grouping enabled state belongs to each pane and is persisted by explorer/session. Enabling or disabling grouping never changes the pane display mode.

Group options use a plugin-owned Zustand vanilla store. The cross-plugin service returns a plain serializable `{ groupBy, includeChildren }` value and exposes only `configure()` for writes.

Toolbar: independent group toggle alongside the three display buttons, combined group caption/select, current-folder / include-children scope. Chinese UI, 28px controls, light/dark surfaces.

Optional `renderLayout(navigation): ReactElement` composes the grouped scroll area into a larger view without remounting the group component. Gallery uses it for the left single-column card rail and one global viewer on the right; `renderGroup` renders cards, never another gallery stage.
