# canvas-ops-editing

- group/ungroup delegate to engine nativeGroup/nativeUngroup. select({ids,deep:true}) opens native ancestors through deepSelect; default selection expands closed hierarchy. Clipboard remaps native group IDs/parents and offsets board-space group/leaf positions. Deletion prunes empty groups via the scene service. Plain text interaction delegates to textEdit; richText explicitly commits native input, escapes plain text to HTML and enters the compatible rich editor.

- Metadata: canvas / ops / editing; entry index.tsx; optional renderer plugin. Consumes `canvas` through SDK getService. No IPC/MCP/event/config/UI contribution of its own. Disposal unregisters every command. Missing canvas service is a no-op.
- Registers commands, invoked through canvas.command or whiteboard_panel(action=command):
  - add({type,name?,text?,x?,y?,width?,height?}) -> node ID; types rect/ellipse/line/arrow/text/note/frame. Resource creation belongs to the resources plugin.
  - select({ids}) -> expanded IDs; update({ids?,patch}) permits name/text/html/tags/x/y/width/height/rotation/fill/locked/collapsed/frame. Updates respect locking, except unlocking itself. Full scene validation happens before transaction commit. HTML is data and is sanitized by the renderer before display.
  - copy/paste/duplicate/delete; clipboard here is an internal session node clipboard. Native clipboard pixels use pasteImage in canvas-ops-resources.
  - undo/redo; rotate({angle=90}) and flip({axis:x|y}) delegate geometry to the active Leafer Editor through `transform`, then commit once through `canvas.edit`; group/ungroup; lock({value=true}); order({direction:top|bottom}).
  - frameSelection() -> new frame ID and member links; detachFrame(); frame selection moves members as one selection. Frames are organizational, not nested affine scene graphs.
  - arrange({mode:grid|horizontal|vertical,gap=24}); distribute({axis:x|y}) for equal edge spacing, minimum three items.
  - settings({title?,background?:dots|grid|none,snap?,rulers?}); guide({id?,axis:x|y,value?,remove?}); bookmark({name?}) or bookmark({go:id}).
  - search({query}) -> [{id,name,type}] across names/plain text/tags; collapse({value?}); interaction({value}).
- All domain mutations use canvas.edit and the same autosave/history path. Selection, search and interaction state are transient.
