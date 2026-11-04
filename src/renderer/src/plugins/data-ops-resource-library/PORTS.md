# PORTS — data-ops-resource-library

- Metadata: data / ops / resource-library; entry `index.tsx`.
- Slots: sidebar.activity (`resources.activity`), floating.panels (`resources.panel`); Chinese fixed-initial-size 920×620 resource panel with internal scrolling.
- Consumes optional renderer `resources` service and required `ui` through SDK. Missing resource service shows an unavailable state.
- Registers local paths/file-picker selections, lists resource links and metadata, revokes registrations, refreshes availability. Images use actual Leafer Canvas + provider image leases; HTML video/audio load the same resource URL. Text has a bounded raw-text inspection view; PDF/Office readers and the new board are not implemented by this panel.
- Consumes resources:changed to refresh the list; resources:action to open/preview/inspect/play/pause/seek/fetch/leafer, with IPC resources.complete acknowledgements. Only the resource scheme can be fetched, and responses are capped at 1 MiB.
- Media stops when the panel closes/switches. Image engine is destroyed before releasing its lease. Main MCP resource_view is the automation entry; CDP is only used for read-only assertions.
- No persistent browser state, direct filesystem access, renderer services or user configuration keys.

## Context menus

The panel root carries `data-context-zone="resources.panel"`. The registration (order 10) offers preview, reveal in the system file manager, copy path, copy the `res://` resource link and forget registration (with confirm) on resource cards (`data-resource-path/-uri/-name/-available`); preview is disabled while the source is unavailable.
