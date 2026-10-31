# PORTS — data-provider-resources

- Domain/category/name: `data` / `provider` / `resources`; entry: `index.ts`.
- Injects `ipc`, `store`, `mcp`; provides the Cordis `resources` service with declaration merging in `types.ts`. Consumers inject `resources`; they must not import this plugin's files.
- Versioned Store document `resource-links` stores only `{id,path,name,extension,registeredAt}`. Source files are referenced, never copied, converted, modified or deleted. Re-registering a canonical path returns the same ID. Regular files on local drives, mapped drives and ordinary Windows UNC shares are accepted; mapped/UNC aliases deduplicate after realpath. Unknown formats use `application/octet-stream`. Device paths, alternate streams, relative paths and malformed shares are rejected. Share access uses existing OS credentials; no writes or additional network listeners. Unavailable shares follow the same missing-source behavior as local files.
- Durable `uri`: `desksuite-resource://local/<uuid>/content.<extension>` (no suffix for extensionless files). `url` adds `?v=<revision>` for loading. Store `uri`/ID in documents; resolve immediately before loading. Revision hashes filesystem identity, size, modification and change times; it is an invalidation token, not a content hash. MIME/kind are extension hints, not format or codec guarantees.
- `ResourceInfo`: registration fields plus `uri,url,mimeType,kind,available,size,modifiedAt,revision`. Missing/unreadable/rebound sources remain registered with `available:false`. `resolve`/list refresh metadata on demand; automatic watching/relinking are deferred.
- IPC `resources` and injected service: `register(path)`, `resolve(reference)`, `list()`, `forget(reference)`, `read(reference,offset?,length?)`, `readText(reference)`. `reference` accepts an ID, durable URI or version URL. `read` returns `{id,revision,offset,total,base64,eof}`, capped at 1 MiB per call. `readText` accepts text/Markdown, UTF-8, up to 1 MiB. Additional IPC: `choose()` native local-file picker and `complete(requestId,{value?,error?})` for renderer MCP replies.
- Custom Electron protocol, registered as standard/secure/fetch/CORS/stream at eager module evaluation before `app.ready`; handler installed in `apply`. No socket/server. The renderer CSP explicitly permits this scheme only for images, media and connections, never scripts or frames. No CSP bypass privilege. Default Electron session only.
- Protocol accepts GET/HEAD/OPTIONS. Supports single byte ranges (open/suffix), 206/416, ETag/304 and If-Range, streamed reads, abort/close cleanup and no-store caching. Stale version URLs return 409; durable URLs read the latest source. Invalid or revoked IDs cannot resolve arbitrary paths. Responses use nosniff and restrictive sandbox CSP. CORS only admits the application's file origin or configured development renderer origin.
- `forget` revokes new requests without deleting source files; already-open streams may finish. An ID is not a portable file package: removing/moving its original source makes it unavailable. Original format bytes do not imply every plugin can render that format.
- MCP read tools: `resource_list`, `resource_resolve({reference})`, `resource_read({reference,offset?,length?})`, `resource_read_text({reference})`.
- MCP registry mutations: `resource_register({path})`, `resource_forget({reference})` (both mutating, normal MCP permission/audit policy).
- MCP `resource_view({action,reference?,time?,url?,method?,range?,etag?,ifRange?})` delegates to the resource panel: open/preview/inspect/play/pause/seek/fetch/leafer. Mutating because it can control playback/UI. `fetch` reads at most 1 MiB from this scheme in the renderer; `leafer` acquires/releases an image lease and reports decoded dimensions. Reply timeout 20s. This is also the functional verification entry; no CDP mutation is required.
- Broadcasts: `resources:changed` `{id,action:'register'|'forget'}`; `resources:action` renderer command with `requestId`. Configuration: only reads `ELECTRON_RENDERER_URL` for the development CORS origin. No new user config keys.

## Consumer example

```ts
export default {
  inject: ['resources'],
  async apply(ctx) {
    // Never store a temporary blob URL in a document.
    const resource = await ctx.resources.register(absolutePath)
    const current = await ctx.resources.resolve(resource.uri)
    // current.url can be loaded by the renderer; current.uri is the durable reference.
  }
}
```

See `docs/research/LEAFER_BOARD_SCOPE.md` for approved feature choices and `scripts/verify/resources.mjs` for the live MCP verification contract.

## Storage registration

- Injects `storage` and registers this plugin's data locations during `apply`; the Settings → Storage page aggregates their paths and on-disk sizes.
