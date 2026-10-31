# PORTS — project-ops-workcrate-projects

Main-process WorkCrate project registry and portable project-data owner. New projects use the DeskSuite WorkCrate format; this plugin does not import FileAtlas or other legacy application data.

## Metadata

| Field | Value |
| --- | --- |
| Domain / class / name | `project` / `ops` / `workcrate-projects` |
| Entry | `index.ts` |
| Injects | `ipc`, `store`, `mcp` |
| Cordis service | `workcrateProjects` |

## Cordis service contract

Projects publishes the typed `workcrateProjects` service for other main-process plugins. Boards integrations must inject this service; cross-plugin file imports are not allowed.

- `list(includeArchived?) -> WorkCrateProject[]`
- `getPreferences() -> { projectSortOrder }` / `savePreferences({ projectSortOrder }) -> { projectSortOrder }`; the setting is stored in the WorkCrate index.
- `registerLifecycleHook({beforeDelete,beforeRelocate,beforeSetDocumentPath}) -> dispose` registers consumer callbacks to close sessions before project deletion, relocation/reopening a portable location, or document rebinding. Consumers must unregister on disposal; a rejected hook aborts its mutation.
- `get(projectId) -> { project, references, fieldPresets, documentPath, documentBinding }`
- `projectDirectory(projectId) -> absolute path`
- `create(name)`, `rename(projectId, name)`, `setArchived(projectId, archived)`, `reorder(projectIds)`, `duplicate(projectId, name?)`, `delete(projectId)`
- `addReferences(projectId, paths)`, `removeReference(projectId, referenceId)`, `relinkReference(projectId, referenceId, path)`, `updateReference(projectId, referenceId, { displayTitle?, order? })`
- `setCover(projectId, path)`, `removeCover(projectId)`, `setReferencePreview(projectId, referenceId, path)`, `removeReferencePreview(projectId, referenceId)`, `readPreview(projectId, relativePath)`
- `getDocumentPath(projectId)`, `documentBinding(projectId)`, `setDocumentPath(projectId, path)`, `clearDocumentPath(projectId, expectedPath)`
- `relocateProject(projectId, directory)`, `openProjectFolder(directory)`
- `getProjectPresets(projectId)`, `saveProjectPresets(projectId, presets)`, `getProgramPresets()`, `saveProgramPresets(presets)`, `effectivePresets(projectId?)`, `promoteProjectField(projectId, key)`

DTOs:

- `WorkCrateProject = { id, name, createdAt, archived, mainImage, order? }`; `createdAt` is Unix milliseconds and `order` controls project list order.
- `WorkCrateFileReference = { id, path, displayTitle, order, sizeBytes, modifiedAt, customPreview, available? }`; `get` computes `available` from source existence; add/relink never copies source files.
- `WorkCratePreview = { path, sha256, width, height }`; `path` is relative to the project directory and names a plugin-owned JPEG/PNG copy.
- `WorkCrateFieldPresets = { fields: Array<{ key, label, values: string[] }> }`.

## Renderer IPC service

Service name: `workcrateProjects`.

| Method | Arguments | Returns |
| --- | --- | --- |
| `list` | `includeArchived?: boolean` | `WorkCrateProject[]` |
| `getPreferences` / `savePreferences` | read / `{ projectSortOrder: manual\|name-asc\|name-desc\|created-newest\|created-oldest }` | `{ projectSortOrder }` |
| `get` | `projectId` | `{ project, references, fieldPresets, documentPath, documentBinding }` |
| `create` | `name` | `WorkCrateProject` |
| `rename` | `{ projectId, name }` | `WorkCrateProject` |
| `setArchived` | `{ projectId, archived }` | `WorkCrateProject` |
| `reorder` | `{ projectIds: string[] }` | `WorkCrateProject[]`; reorders the requested subset in their existing sort slots |
| `duplicate` | `{ projectId, name? }` | `WorkCrateProject`; copies project data, previews and any associated native document, while retaining external reference paths |
| `delete` | `projectId` | `void` |
| `addReferences` | `{ projectId, paths: string[] }` | `WorkCrateFileReference[]` |
| `removeReference` | `{ projectId, referenceId }` | `WorkCrateFileReference[]` |
| `relinkReference` | `{ projectId, referenceId, path }` | `WorkCrateFileReference[]` |
| `updateReference` | `{ projectId, referenceId, displayTitle?, order? }` | `WorkCrateFileReference[]`; `order` is the target position |
| `setCover` | `{ projectId, path }` | `WorkCratePreview` |
| `removeCover` | `projectId` | `void` |
| `setReferencePreview` | `{ projectId, referenceId, path }` | `WorkCratePreview` |
| `removeReferencePreview` | `{ projectId, referenceId }` | `void` |
| `readPreview` | `{ projectId, relativePath }` | `{ dataUrl, mimeType, width, height }` (resized JPEG, max 1200px edge / 8 MiB) |
| `getDocumentPath` | `projectId` | `string | null` |
| `setDocumentPath` | `{ projectId, path }` | `{ path, binding }` |
| `clearDocumentPath` | `{ projectId, expectedPath }` | `void` |
| `relocateProject` | `{ projectId, directory }` | new absolute project-data directory |
| `openProjectFolder` | `directory` | imported/reopened `WorkCrateProject[]` |
| `getProjectPresets` / `getProgramPresets` | `projectId` / none | `WorkCrateFieldPresets` |
| `saveProjectPresets` | `{ projectId, presets }` | normalized `WorkCrateFieldPresets` |
| `saveProgramPresets` | `presets` | normalized `WorkCrateFieldPresets` |
| `effectivePresets` | `projectId?` | project-first union with program defaults |
| `promoteProjectField` | `{ projectId, key }` | updated program `WorkCrateFieldPresets` |

The renderer must use `readPreview`; it cannot read files under `userData`. Successful mutations broadcast `workcrateProjects:changed` with `{ projectId, revision, at }`.

## Persistence and path policy

- Recent-project index: `<userData>/data/workcrate/recent.json`, registered with the main-process `store` service and its atomic/versioned envelope.
- New project data starts at `<userData>/data/workcrate/projects/<uuid>/`. After a native document is explicitly created or associated, the caller may relocate the owned dataset to `<chosen folder>/.workcrate/<uuid>/`; the index records its absolute location.
- Project data is a versioned `project.json`; previews are stored under `previews/` with SHA-256 and dimensions. JSON writes use a same-directory temporary file and backup rollback. Relocation copies into a temporary sibling directory, validates identity, atomically publishes, updates the locator and only then removes the old owned copy.
- Duplicate, relocation, portable-folder reopening and deletion verify the copied project document and every registered preview digest before publishing/retiring data. Recursive copies reject symlinks and junctions rather than silently omitting project-owned entries.
- `openProjectFolder` validates the complete candidate directory and IDs before updating the recent index. It does not scan arbitrary disks.
- Project deletion copies plugin-owned metadata and previews into `<userData>/data/workcrate/trash/` before removing the registered project data. Referenced source files and associated native documents are never deleted or moved by this plugin.
- `clearDocumentPath` compares the expected absolute path against the stored canonical path and can clear a stale association even after its native document has been removed from disk.
- Preview read paths must match a currently registered cover/custom preview, remain inside the canonical project directory after symlink resolution, and point under `previews/`; the stored SHA-256 is rechecked before returning bytes. Only JPEG/PNG previews are accepted; input file size is capped at 32 MiB and renderer output at 8 MiB.
- References require existing regular files and canonical absolute paths; duplicate paths are ignored. Relinking updates only the reference record.
- Field presets cap field/value counts and lengths; duplicate keys are rejected and duplicate values are normalized.
- Removing a cover deletes only its plugin-owned preview copy. `duplicate` copies its JSON, previews, and associated native document, generates new project/reference/binding IDs, and retains external reference paths. Copying a native document to a user-selected folder is owned by the Boards format-aware adapter.
- Portable locations are restricted to the app-owned project root/UUID or `<chosen folder>/.workcrate/<same UUID>`. Registered project and `.workcrate` directories reject symlinks/junctions so a corrupted locator cannot cause arbitrary copies or removals.
- `get` computes live source availability; missing references remain registered and can be relinked.

## MCP tools

| Tool | Access | Confirmation |
| --- | --- | --- |
| `workcrate_projects_list`, `workcrate_project_get`, `workcrate_project_references`, `workcrate_project_presets_get`, `workcrate_program_presets_get`, `workcrate_project_presets_effective`, `workcrate_project_document_get` | Read-only | None |
| `workcrate_project_create` | Mutating, standard | None; writes only a new project below app `userData` |
| `workcrate_project_rename`, `workcrate_project_archive`, `workcrate_project_duplicate`, `workcrate_projects_reorder`, `workcrate_project_add_references`, `workcrate_project_remove_reference`, `workcrate_project_relink_reference`, `workcrate_project_reference_update`, `workcrate_project_set_cover`, `workcrate_project_remove_cover`, `workcrate_project_set_reference_preview`, `workcrate_project_remove_reference_preview`, `workcrate_project_presets_save`, `workcrate_program_presets_save`, `workcrate_project_presets_promote`, `workcrate_project_document_set`, `workcrate_project_document_clear`, `workcrate_project_open_folder` | Mutating, standard | Every tool requires `confirm: true`; omitted/false is rejected by the handler. This covers writes to a portable project directory. |
| `workcrate_project_delete`, `workcrate_project_relocate` | Mutating, high impact | Both require `confirm: true`; omitted/false is rejected. They can remove or publish plugin-owned data in an external portable directory. |

All mutating tools also obey the configured MCP access gate (`standard` or `full`; high impact requires `full`). `confirm: true` is an additional per-call requirement. Source files and associated native documents are never written by reference, preview, association, delete, or relocation tools; relocation only moves WorkCrate-owned project data.

The Boards plugin owns native document/board data and any official VectorCraft CLI calls; Projects only records the explicit document association and binding UUID.

## Material basic information

The `workcrateProjects` IPC exposes `getProgramPresets()`, `saveProgramPresets(presets)`, and `effectivePresets(projectId?)`. MCP exposes `workcrate_program_presets_get()` and `workcrate_program_presets_save({ presets, confirm: true })`; saves require mutation access and replace the complete list after validation/normalization, then emit `workcrateProjects:changed`.

On first initialization of material defaults, `materialDefaultsVersion` in recent.json advances to 1. Nine missing fields are seeded with 83 suggestions: materialCategory, material, sizeLabel, size, quantity, stock, craft, color, installation. Existing field keys/values are preserved. Later user deletions and empty option lists are not reseeded, including after restart. No project material value is automatically overwritten by suggestions.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
