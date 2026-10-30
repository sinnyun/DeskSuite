# system-basic-updater (renderer)

- Domain / class / name: `system` / `basic` / `updater`
- Entry: `index.tsx`
- Contributions: update action in `top.actions`; fixed 500×380 update panel in `floating.panels`.
- Uses `updater.get`, `updater.setFeedUrl`, `updater.check`, `updater.download`, `updater.install` IPC and `updater:state` events.
- The panel lets the user configure a GitHub repository, check for a release, download it, and explicitly quit/install.
- Release artifacts are packaged with the repository's electron-builder scripts; an operator must manually upload `latest.yml` and the matching installer to GitHub Releases.
- No renderer storage or settings are owned; the main plugin validates and persists the feed URL.
- Interface copy is Chinese.
