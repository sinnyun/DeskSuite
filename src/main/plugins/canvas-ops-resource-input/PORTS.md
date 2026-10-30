# canvas-ops-resource-input

- Metadata: canvas / ops / resource-input; entry index.ts. Injects resources/ipc/mcp. No provided service, events or configuration.
- IPC canvasInput.clipboardImage() and mutating MCP canvas_paste_image({}) return ResourceInfo for current native clipboard pixels. They register the resource; canvas insertion is the renderer pasteImage command.
- Rejects empty/nonimage clipboard and PNG over 32 MiB. Clipboard has no original file: writes an immutable SHA256-addressed PNG under <userData>/data/canvas-paste, exclusive create and dedup; never overwrites an original. Generated clipboard sources persist for restart, not a rotating clipboard history slot. Uses injected resources.register; no cross-plugin imports, new listeners or host changes.
