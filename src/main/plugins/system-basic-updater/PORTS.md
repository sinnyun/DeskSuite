# system-basic-updater

- Domain / class / name: `system` / `basic` / `updater`
- Entry: `index.ts`
- Dependencies: Cordis `ipc`, `store`, `storage`, `mcp`; Electron `app`; `electron-updater`.
- IPC service `updater`: `get()`, `setFeedUrl(url)`, `check()`, `download()`, `install()`.
- MCP tools: `updater_get` (read-only state), `updater_set_feed` / `updater_check` / `updater_download` / `updater_install` (mutating; install quits the app).
- Events: `updater:state` publishes status, current/available version, download percentage, source URL, and packaged-mode state.
- Error messages in updater state are bounded and sanitized by the main-process error-text helper before broadcast; the event fields and status protocol are unchanged.
- Feed settings are stored as `updater.settings` in the shared atomic store. The URL accepts an HTTPS GitHub repository URL or its Releases page; the plugin derives the GitHub owner and repository.
- Automatic downloads and quit/install are disabled. The user must explicitly choose download and install. Development builds cannot check or install updates.
- Builds use `electron-builder.config.cjs`; CI (`.github/workflows/release.yml`, tag `v*` matching package.json version) publishes the NSIS installer and `latest.yml` to GitHub Releases using `DESKSUITE_GITHUB_OWNER` / `DESKSUITE_GITHUB_REPO` (electron-updater resolves owner/repo from the configured feed at runtime; no embedded app-update.yml needed).

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
