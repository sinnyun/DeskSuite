# system-basic-dev-lab

- Domain / class / name: `system` / `basic` / `dev-lab`
- Entry: `index.ts`
- Dependencies: Cordis services `db`, `ipc`, `mcp`, `jobs`, and `audit`.
- Data ownership: virtual `files` rows only. Every synthetic `path_key` uses the reserved `devlab:<profile>:` prefix and every path uses the `devlab://synthetic/` URI. The plugin never creates or modifies filesystem entries.

## IPC

Service: `devLab`.

- `inject(count, profile?)` inserts or updates 1–200,000 synthetic image rows in batches of 500 and returns `{ jobId, count, profile }`.
- `clear(profile?)` removes only rows under that profile's reserved prefix in batches and returns `{ jobId, profile }`.
- `status(profile?)` returns `{ profile, rows, runningJobId, maxRows }`.
- The profile defaults to `default`; accepted profile characters are ASCII letters, digits, and hyphens, with a maximum length of 32. Only one job per profile may run at a time.
- Long operations use the shared `jobs` service, report progress, and can be canceled between 500-row transactions.

## MCP

- `dev_inject_data({ count, profile? })` starts a mutating low-impact job and returns its job ID.
- `dev_clear_data({ profile? })` starts a mutating low-impact job and removes only this plugin's virtual rows.
- `dev_status({ profile? })` is read-only.
- `dev_open_context_menu({ zoneId, x?, y?, selector? })` broadcasts `dev:context-menu` so the renderer opens the given `data-context-zone` menu without a real right click (verification only; falls back to the built-in menu when the zone has no contribution). `selector` resolves a specific element (e.g. `[data-entry-path]`) as the menu target to simulate right-clicking a card; without it the zone element is used.

## Events and settings

- Uses shared `job:progress` and `job:done` events.
- Records injection and cleanup outcomes through `audit`.
- Consumes no configuration keys and registers no additional event channels.
