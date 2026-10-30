# DeskSuite Lore bridge

This standalone Rust executable wraps the pinned `lore-vm` API for the Electron main process. Requests and responses use one JSON object per line over standard input/output. It never accepts executable paths or shell command fragments from a request.

Build with Rust 1.96:

```powershell
npm run build:lore-bridge:debug
npm run build:lore-bridge
```

Development starts build the debug bridge automatically when no binary is present. `npm run build` builds the release bridge before electron-vite; electron-builder copies the resulting executable into `resources/lore-bridge/`.

## Prebuilt binary from CI

`.github/workflows/build-lore-bridge.yml` builds the Windows release executable on GitHub Actions so the local machine does not need a Rust toolchain.

- Pushing to `main` (except docs and the binary itself) or running the workflow manually builds the executable and commits it to `native/lore-bridge/bin/desksuite-lore-bridge.exe`.
- Locally, just `git pull`; `npm run dev` skips the local build while that file exists.
- Pushing a `lore-bridge-v*` tag also attaches the executable to a GitHub Release instead of committing it.

`npm run build` and packaging still compile the bridge locally, so release machines need Rust 1.96. Do not use a local build to refresh the tracked executable: it is owned by CI, and local outputs can differ. After running `npm run build` locally, restore the file with `git restore native/lore-bridge/bin/desksuite-lore-bridge.exe` instead of committing or pushing it.


Lore worktrees and shared object stores are isolated under DeskSuite's user data directory. The bridge does not migrate or open FileAtlas data.
