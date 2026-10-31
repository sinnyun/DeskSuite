# system-basic-updater

- Domain / class / name: `system` / `basic` / `updater`
- Entry: `index.ts`
- Dependencies: Cordis `ipc` and `store`; Electron `app`; `electron-updater`.
- IPC service `updater`: `get()`, `setFeedUrl(url)`, `check()`, `download()`, `install()`.
- Events: `updater:state` publishes status, current/available version, download percentage, source URL, and packaged-mode state.
- Error messages in updater state are bounded and sanitized by the main-process error-text helper before broadcast; the event fields and status protocol are unchanged.
- Feed settings are stored as `updater.settings` in the shared atomic store. The URL accepts an HTTPS GitHub repository URL or its Releases page; the plugin derives the GitHub owner and repository.
- Automatic downloads and quit/install are disabled. The user must explicitly choose download and install. Development builds cannot check or install updates.
- Builds use `electron-builder.config.cjs`; set `DESKSUITE_GITHUB_OWNER` and `DESKSUITE_GITHUB_REPO` to emit GitHub update metadata. `npm run package:win` creates an NSIS installer; `npm run package:dir` creates an unpacked app directory.
- Publication is manual: upload generated `latest.yml` and the matching installer artifacts from `release/` to the configured GitHub Releases release. No release is created or uploaded by these scripts.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
