# PORTS — system-basic-launcher

Enumerates Windows Start Menu shortcuts and installed applications for the launch panel.

## Metadata

| Field | Value |
| --- | --- |
| Domain / category / name | `system` / `basic` / `launcher` |
| Entry | `index.ts` |

## Dependencies

- `ipc`
- `store`

## IPC service

Service: `launcher`

| Method | Arguments | Returns |
| --- | --- | --- |
| `list` | `query?: string`, `offset?: number` | Next page of up to 250 matching cached entries |
| `summary` | `query?: string` | Exact total, shortcut/application counts and per-group counts |
| `refresh` | — | Full refreshed entry list |
| `open` | `id: string` | Opens the selected shortcut/application |
| `icon` | `id: string` | Native icon data URL or `null` |
| `groups` | — | User-defined launcher groups |
| `createGroup` | `name: string` | Creates a group (unique name, max 32 chars) |
| `renameGroup` | `id: string`, `name: string` | Renames a group |
| `deleteGroup` | `id: string` | Deletes a group and clears its assignments |
| `assignGroup` | `id: string`, `groupId: string \| null` | Assigns or clears a program's group |

The source cache is a versioned store document with a 24 hour lifetime. User groups and assignments are stored separately and survive rescans. On Windows, sources are
the per-user and common Start Menu `.lnk` trees plus the three standard Uninstall registry views.
PowerShell is invoked with a fixed script and no user-supplied command text.

## MCP tools / events / config

None.

## MCP tools

- `launcher_list` (read): paged program list, with saved title/description overrides.
- `launcher_groups` (read): saved groups, assignments, and metadata.
- `launcher_group_create` (write, full access): create a group.
- `launcher_program_update` (write, full access): set group, display title, and description.

The versioned `launcher-library` store persists groups, assignments, and per-program title/description overrides. Scanner cache entries persist for 24 hours.
