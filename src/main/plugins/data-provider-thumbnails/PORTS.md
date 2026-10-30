# data-provider-thumbnails

- Domain / class / name: `data` / `provider` / `thumbnails`
- Entry: `index.ts`
- Dependencies: Cordis services `ipc` and `settings`; Electron `app` and `nativeImage`; internal `paths.identity` / `paths.normalize` helpers.
- IPC service: `thumbnails`
  - `get(path, edge?)` returns `{ dataUrl }`, a base64 JPEG whose longest edge is bounded to 240 pixels, preserving the source aspect ratio (proportional scaling, no stretching or cropping).
  - `edge` controls the source cache/render request and is clamped by validation to 64–1024; default is 320.
- Cache: JPEG quality 80 under `<userData>/thumbs`. The SHA-1 cache key combines normalized path identity, file size, mtime, and edge. It is stored in the header of a fixed 20,000-slot cache file. The fixed slots let LRU eviction truncate/reuse files without deleting arbitrary paths from this provider.
- Cache limits: LRU eviction targets the `thumbnails.cacheMiB` setting (32–2048 MiB, default 512) and 20,000 nonempty cache entries. Access time is refreshed on cache hits; the index is reconstructed from cache headers after restart.
- Settings changes adjust the active byte budget and immediately prune excess cache data.
- Generation: `nativeImage.createThumbnailFromPath` first; then `nativeImage.createFromPath` + resize; finally `app.getFileIcon`.
- Events / MCP: none.
- Consumed configuration: none.
- Known boundary: source images may be upscaled to the requested edge when the operating system returns a small or empty preview; the public result is always scaled proportionally to a 240-pixel longest edge. The cache format version is `DSSTHM02`; changing it invalidates the whole cache.
