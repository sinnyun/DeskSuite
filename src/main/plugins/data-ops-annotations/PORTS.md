# data-ops-annotations (main)

- Domain / class / name: `data` / `ops` / `annotations`
- Entry: `index.ts`
- Injects: `db`, `ipc`, `mcp`
- Owned data: `meta`, `tags`, `file_tags` in the catalog database; paths are keyed with `paths.identity()` and remain usable without an index.
- Migration: `tag-materialized-path` adds `tags.path` and its index through `db.migrate()`.

## IPC service

Service name: `annotations`.

- `forPaths(paths)` returns `{ [inputPath]: { path, favorite, rating, note, tags[] } }`.
- `pathsForTag(tagId)` returns every path assigned to the tag or any of its descendant tags, sorted by path.
- `counts()` returns `{ [tagId: string]: number }` with direct (non-recursive) assignment counts.
- `setFavorite({ path, favorite })`, `setRating({ path, rating })`, and `setNote({ path, note })` upsert path metadata.
- `assignTag({ paths, tagId })` and `unassignTag({ paths, tagId })` update file assignments.
- `tree()` returns nested tags ordered by sibling `sort` and id. Nodes include materialized `path`.
- `create({ name, parentId?, color? })`, `rename({ tagId, name })`, `merge({ sourceId, targetId })`, and `remove(tagId)` manage the tree.
- `importLegacy(map)` idempotently imports the former renderer metadata map; it returns `{ imported, skipped }`.

## MCP tools

- `tag_list` and `tag_files` (paths for a tag subtree) are read only.
- `tag_create`, `tag_assign`, `meta_rate`, and `meta_favorite` are mutating low impact tools and use the MCP service access gate.

## Events and limits

- Broadcasts `annotations:changed` after successful writes. Payload: `{ kind: 'tree'|'metadata', paths?, at }`.
- Ratings are integers from 0 to 5; notes are limited to 20,000 characters; bulk path inputs are limited to 1,000 items.
- Tag assignment rows do not depend on `files` or `folders` index rows.
- Recursive CTE traversal tracks visited ids to stop loops. Merges into descendants are rejected. Merge reparents source children beneath the destination and migrates assignments; remove promotes children to the removed tag's parent.
- No configuration keys are consumed.
