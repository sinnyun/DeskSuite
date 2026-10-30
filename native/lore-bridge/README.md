# DeskSuite Lore bridge

This standalone Rust executable wraps the pinned `lore-vm` API for the Electron main process. Requests and responses use one JSON object per line over standard input/output. It never accepts executable paths or shell command fragments from a request.

Build with Rust 1.96:

```powershell
npm run build:lore-bridge:debug
npm run build:lore-bridge
```

Development starts build the debug bridge automatically. `npm run build` builds the release bridge before electron-vite; electron-builder copies the resulting executable into `resources/lore-bridge/`.

Lore worktrees and shared object stores are isolated under DeskSuite's user data directory. The bridge does not migrate or open FileAtlas data.
