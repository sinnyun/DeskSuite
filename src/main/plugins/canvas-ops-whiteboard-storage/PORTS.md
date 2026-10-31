# canvas-ops-whiteboard-storage

- Scene v1 extensions: optional node skewX/skewY and optional groups:{id,parent?,x?,y?,rotation?,scaleX?,scaleY?,skewX?,skewY?}[]. Leaves and group transforms are stored in board space; the renderer uses native reparenting APIs. Old absent group records are compatible. Group IDs must be unique and distinct from node IDs; ancestors must exist, be acyclic, and not exceed 64 levels. Optional group scales must be nonzero (abs >=1e-8); all numeric values remain finite/bounded.

- Metadata: domain `canvas`, category `ops`, name `whiteboard-storage`, entry `index.ts`.
- Injects `ipc`, `store`, `mcp`, `window`; provides no Cordis service. No configuration keys.
- Owns Store v1 documents under `<userData>/data/leafer-boards/`: index.json stores IDs/titles and each hex-encoded UTF8 ID has its own scene JSON file (case-distinct IDs stay distinct on Windows). Without an index, migrates leafer-board-scenes.json by writing every scene before publishing the index. Legacy files remain untouched. An existing index, including empty, prevents repeated migration and resurrection of removed boards. Excalidraw whiteboard-scenes.json is untouched.
- Operations are serialized; an eight-entry scene cache avoids repeated reads. Identical canonical JSON skips disk writes; geometry changes write only the affected board. Only membership/title changes write the index. Store retains fsync, atomic rename, schema validation and backups. Remove unlists the board, retaining its unlisted document for recovery without auto-importing it.
- IPC whiteboard.summaries() returns {id,title}[] in one lightweight call. Existing list/get/set/remove remain compatible.
- MCP whiteboard_panel accepts optional deferSave:boolean for commands: default false preserves flush-before-reply; true uses the UI debounce path. Explicit flush confirms durability. Opening loads the board before revealing the panel to avoid duplicate initialization navigation.
- Main-window close broadcasts whiteboard:flush and waits for whiteboard.complete after renderer persistence. Failure/15s timeout keeps the window open. No new window is created.
- Schema: `{format:"desksuite-leafer",version:1,title,nodes,view,background,snap,rulers,guides,bookmarks}`. `scene.ts` is authoritative. Whitelisted node types: rect/ellipse/line/arrow/text/note/frame/image/video/file. Resource nodes persist stable `resource` URIs and optional `resourceKind`, never runtime URLs or original bytes. Node geometry must be finite, IDs unique, resources registered-URI shaped. Up to 10,000 nodes and 4 MiB JSON characters per board. Invalid input is rejected before Store mutation; the Store validates contained scenes on recovery too.
- IPC `whiteboard`: `list(): string[]`, `get(id): string|null`, `set(id,sceneJson): true`, `remove(id): boolean`, `complete(requestId,{value?,error?})`.
- MCP: `whiteboard_list`, `whiteboard_get({id})`, `whiteboard_set({id,sceneJson})`, `whiteboard_remove({id})`. The last two mutate domain data. Board IDs match `[a-zA-Z0-9-]{1,64}`. Metadata/title is inside each scene.
- MCP `whiteboard_panel({action,boardId?,sceneJson?,command?,args?})`: actions `open`, `replace`, `flush`, `inspect`, `command`. Commands are supplied by renderer plugins. `new({title?})` and `removeBoard` are panel commands; `inspect` returns the complete renderer snapshot plus engine name. `replace` validates through main storage before loading. Caller must open the panel before viewport-only commands such as media/export/transform.
- Broadcast `whiteboard:action` with the above arguments and `requestId`; renderer acknowledges `whiteboard.complete`. Timeout 15 seconds; pending calls fail on plugin disposal.
- No filesystem listener, new window, host modification, or browser domain storage.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
