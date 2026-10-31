# data-provider-thumbnails

- Domain / class / name: `data` / `provider` / `thumbnails`
- Entry: `index.ts`
- Dependencies: Cordis services `ipc` and `settings`; Electron `app` and `nativeImage`; internal `paths.identity` / `paths.normalize` helpers.
- IPC service: `thumbnails`
  - `get(path, edge?)` returns `{ dataUrl }`, a base64 JPEG whose longest edge is bounded to 240 pixels, preserving the source aspect ratio (proportional scaling, no stretching or cropping).
  - `getMany(paths, edge?)` accepts up to 64 unique paths and returns `{ path, dataUrl }[]`; individual failures have `dataUrl: null`. Generation remains bounded by the provider's shared four-task limit and cache singleflight.
  - `edge` controls the source cache/render request and is clamped by validation to 64–1024; default is 320.
- IPC service: `fileIcons`
  - `get(path)` returns `{ dataUrl }`, the operating-system file icon as a lossless PNG (transparency preserved), used by cards when no thumbnail is available. Directory paths are accepted too.
  - Icons are cached in memory by extension (ordinary files share the icon of their extension; `.exe` / `.lnk` / `.ico` / `.msi` / `.url` and similar are cached per path), capped at 512 entries; concurrent requests for the same key are merged.
- MCP tool: read-only `thumbnail_get({ path, edge? })` uses the same absolute local file and 64–1024 edge validation as IPC `get`, returning a JPEG image block. The source file is not modified; a generated image may update the provider's internal cache. Like `read_text_file`, callers choose the local path, so MCP access level `read` permits returning pixels from any readable path supplied by the caller.
- Cache: JPEG quality 80 under `<userData>/thumbs`. The SHA-1 cache key combines normalized path identity, file size, mtime, and edge. It is stored in the header of a fixed 20,000-slot cache file. The fixed slots let LRU eviction truncate/reuse files without deleting arbitrary paths from this provider.
- Cache limits: LRU eviction targets the `thumbnails.cacheMiB` setting (32–2048 MiB, default 512) and 20,000 nonempty cache entries. Access time is refreshed on cache hits; the index is reconstructed from cache headers after restart. Each file is capped at 2 MiB and its JSON header at 4 KiB; headers use a strict Zod schema and oversized or corrupt entries are discarded. Reads use one open file handle, `fstat`, and consume at most 2 MiB + 1 bytes so concurrent growth cannot cause unbounded allocation.
- Settings changes adjust the active byte budget and immediately prune excess cache data.
- Generation: `nativeImage.createThumbnailFromPath` first; then `nativeImage.createFromPath` + resize; finally `app.getFileIcon`.
- System icons: `fileIcons.get` calls `app.getFileIcon(path, { size: 'large' })`; its cache is memory-only and never written to the thumbnail disk cache.
- Events: none.
- Consumed configuration: none.
- Known boundary: source images may be upscaled to the requested edge when the operating system returns a small or empty preview; the public result is always scaled proportionally to a 240-pixel longest edge. The cache format version is `DSSTHM02`; changing it invalidates the whole cache.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
