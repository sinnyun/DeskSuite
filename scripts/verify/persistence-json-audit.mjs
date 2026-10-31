import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir, projectRoot } from './common.mjs'

const inventory = [
  {
    source: 'src/main/services/mcp.ts:handleRequest/readBody', kind: 'HTTP JSON-RPC request body',
    schema: 'JSON.parse followed by MCP SDK Streamable HTTP transport validation',
    budget: '16 MiB request bytes; streaming declared-length and actual-byte checks',
    failure: '413 for over-budget; 400 for malformed JSON; malformed protocol is rejected by SDK',
    mcp: 'All MCP tools; ingress only'
  },
  {
    source: 'src/main/plugins/canvas-ops-whiteboard-storage/scene.ts:validateScene', kind: 'Persisted/imported Leafer scene JSON',
    schema: 'Strict Zod scene schema; node/group/guide/bookmark limits and duplicate/cycle checks',
    budget: '4 MiB JavaScript characters per scene; 10,000 nodes and groups; 500 guides; 100 bookmarks; Store document budget also applies',
    failure: 'Invalid scene rejected before mutation; Store recovery validation rejects corrupt content',
    mcp: 'MCP whiteboard_set / whiteboard_get and whiteboard_panel replace/command paths; whiteboard scripts exercise service'
  },
  {
    source: 'src/main/plugins/canvas-ops-whiteboard-storage/storage.ts:load/set', kind: 'Legacy scenes and board summary index',
    schema: 'Legacy scenes revalidated by validateScene/Store; index is Zod array of {id,title}',
    budget: 'Per-scene 4 MiB chars; summary index max 10,000 rows, nonempty titles max 200 chars; Store document byte budget also applies',
    failure: 'Migration writes scenes before publishing index; on failure index is not published and legacy store remains; set rejects before queue',
    mcp: 'Indirect through whiteboard list/get/set/remove/panel tools',
    gap: 'No independent row/title gap remains after adding explicit limits; legacy migration has only static codec coverage in this audit'
  },
  {
    source: 'src/main/plugins/data-provider-thumbnails/index.ts:decodeBlob/loadCacheIndex/readCache', kind: 'Binary thumbnail cache header JSON',
    schema: 'Strict CacheHeaderSchema (sha1 key, edge, source size/mtime)',
    budget: '2 MiB per cache file and same-handle fstat + max 2 MiB + 1 read; 4 KiB header; 20,000 slots; 512 MiB default cache total',
    failure: 'Invalid/oversized cache slot becomes empty or cache miss; generation is bounded to 4 concurrent jobs',
    mcp: 'Read-only thumbnail_get MCP tool uses the same generator; thumbnail-mcp.mjs calls it and captures the window through capture_window'
  },
  {
    source: 'src/main/plugins/data-provider-eagle-links/eagle.ts:EagleClient.json/resolve', kind: 'Local Eagle HTTP API JSON responses',
    schema: 'Envelope schema limits external message to 2,000 chars, plus endpoint-specific item/folder schemas and source DTO schema',
    budget: '4 MiB streamed response; 5 s timeout; folder traversal capped at 20,000; item/folder/tag field caps',
    failure: 'Non-success status, invalid JSON/schema, timeout, or traversal overflow throws a contextual error bounded to 2,000 chars with credentials/local paths scrubbed',
    mcp: 'Eagle MCP tools call the same client; no network access outside the local API'
  },
  {
    source: 'src/main/plugins/data-ops-versions/index.ts:runBridge', kind: 'Lore native sidecar JSON response',
    schema: 'Strict {ok,result?,error?} envelope; result is unknown and decoded by downstream version-info schemas/limits',
    budget: '16 MiB stdout; 1 MiB retained stderr; 120 s timeout; version-info bounds graph/snapshot/rows before persistence',
    failure: 'Sidecar timeout/nonzero exit/malformed envelope rejects operation; database transaction rolls back invalid projection',
    mcp: 'versions_* tools invoke the same operation service; version-storage and version-decoder verification'
  },
  {
    source: 'src/main/plugins/data-ops-versions/index.ts:preview', kind: 'Persisted version image preview bytes',
    schema: 'Only the expected version-owned regular file is read; lstat identity is matched to the opened handle device/inode before decode',
    budget: '512 KiB per JPEG; same-handle fstat and at most 512 KiB + 1 bytes read',
    failure: 'Symlink/non-file/replaced path or oversized preview returns null; nativeImage rejects invalid JPEG bytes',
    mcp: 'versions preview path is consumed by the renderer; version-preview-file.mjs asserts the production helper boundary with fake handles'
  },
  {
    source: 'src/main/plugins/system-basic-launcher/index.ts:installedApplications', kind: 'PowerShell registry enumeration JSON stdout',
    schema: 'InstalledApplicationSchema per row; top-level array or singleton object; CacheSchema on stored catalogue',
    budget: '4 MiB execFile maxBuffer; 15 s timeout; first 5,000 array rows; cached entries max 5,000; shortcut walk max 2,500',
    failure: 'PowerShell/JSON errors are swallowed to continue with OS file-icon fallback; malformed rows are skipped',
    mcp: 'launcher_list and launcher_groups MCP tools; launcher verification script'
  },
  {
    source: 'src/main/plugins/data-provider-catalog/index.ts:CatalogDatabaseService', kind: 'Shared SQLite catalog persistence',
    schema: 'SQLite schema constraints and plugin-owned query-specific decoders; generic db provider does not decode arbitrary rows',
    budget: 'SQLite is page-backed; provider has no generic query-result row/byte cap. Selected consumers materialize full result sets; see explicit gaps below',
    failure: 'SQLite/query errors propagate to owning plugins; no generic import/recovery path in the provider',
    mcp: 'Covered through owning feature MCP tools, not a direct database MCP tool'
  },
  {
    source: 'src/main/plugins/data-provider-resources/transport.ts:resourceResponse', kind: 'Binary resource response stream',
    schema: 'ResourceRegistry validates registered resource identity/path/MIME/revision; transport accepts GET/HEAD and one RFC byte range',
    budget: 'No whole-file buffer; streamed from FileHandle. Range bounds selected bytes; full GET intentionally has no total byte ceiling',
    failure: 'Invalid range returns 416; open/read failure returns structured JSON status; request abort destroys stream',
    mcp: 'MCP resource tools register/resolve metadata; renderer consumes HTTP transport. resource-decoder-smoke.mjs covers normal resource flow'
  },
  {
    source: 'src/main/plugins/data-ops-filesystem/index.ts:readText/readImage/readMedia', kind: 'Filesystem binary/text preview reads',
    schema: 'Extension-to-MIME allowlists; text rejects NUL in first 8,000 bytes; one open FileHandle is fstat-checked and bounded-read',
    budget: 'Text 2 MiB, image 12 MiB, audio/video 64 MiB; each reader consumes at most limit + 1 bytes even if the file grows after open',
    failure: 'Directories/unsupported types/oversize files reject; text output truncates at 200,000 characters',
    mcp: 'read_text_file covers text; command_run invokes readImage/readMedia production IPC methods. filesystem-preview-budget.mjs covers normal and over-limit paths for all three previews'
  },
  {
    source: 'src/main/plugins/system-basic-clipboard/index.ts:historyImage/useHistory', kind: 'Clipboard image history binary restore',
    schema: 'PNG-only history slots; nativeImage.createFromBuffer validates decoded image',
    budget: '8 MiB fstat cap on a single open FileHandle; at most 8 MiB + 1 bytes are read. Stored history counts/text lengths are constrained by clipboard schema and Store budget',
    failure: 'Missing/oversized/corrupt image yields null or diagnostic error; shrink-during-read remains an incomplete-file error',
    mcp: 'clipboard_history_list/image are read-only MCP views of the same implementation; clipboard-image-file.mjs proves max + 1 rejection under simulated concurrent growth; nonempty app history path depends on an existing image item'
  },
  {
    source: 'src/main/plugins/data-ops-index-scan/index.ts:stale cleanup', kind: 'SQLite index row materialization after filesystem scan',
    schema: 'Catalog files/folders tables; scan staging set tracks seen keys',
    budget: 'Upserts and stale cleanup use 500-row batches; cleanup keyset-pages by path_key and materializes at most 500 paths per table iteration',
    failure: 'Only a complete scan cleans stale rows; canceled/incomplete scans preserve existing rows; all cleanup pages and staging deletion commit or roll back together',
    mcp: 'index_scan MCP starts the same job; index-scan-stale-budget.mjs verifies >1,000 stale file/folder rows across pages and root isolation'
  },
  {
    source: 'src/main/plugins/data-ops-file-operations/index.ts:version rebind', kind: 'SQLite version entity materialization during move/rename',
    schema: 'Version entity path rows are paged by path_key, then normalized and filtered by the existing JS path rules',
    budget: 'At most 500 candidate rows materialized per page; warning details retained for at most eight failures',
    failure: 'Filesystem operation stays completed if path rebinding fails; per-entity failure is counted and sampled in the warning/audit',
    mcp: 'fileOps MCP mutation path needs plan approval; version-rebind-pagination.mjs verifies the production helper with in-memory SQLite, not the approval flow'
  },
]

const exclusions = [
  'src/main/services/store.ts', 'src/main/services/config.ts', 'src/main/services/audit.ts',
  'src/main/plugins/project-provider-workcrate-boards/', 'src/main/plugins/data-provider-version-info/',
  'src/main/plugins/project-ops-workcrate-projects/'
]
for (const row of inventory) {
  const file = row.source.split(':')[0]
  assert.ok(!exclusions.some((excluded) => file.startsWith(excluded)), `Excluded area leaked into inventory: ${file}`)
  assert.ok(readFileSync(join(projectRoot, file), 'utf8').length > 0, `Missing audited source: ${file}`)
}

const outDir = ensureOutDir()
const capturedAt = new Date().toISOString()
const jsonPath = join(outDir, 'persistence-json-audit.json')
const markdownPath = join(outDir, 'persistence-json-audit.md')
writeFileSync(jsonPath, `${JSON.stringify({ capturedAt, exclusions, entries: inventory }, null, 2)}\n`)
const escape = (value) => value.replaceAll('|', '\\|').replaceAll('\n', ' ')
const lines = [
  '# src/main persistence and import boundary audit', '',
  `Generated: ${capturedAt}`, '',
  `Excluded reviewed areas: ${exclusions.join(', ')}.`, '',
  '| Source and ingress | Existing schema | Byte/count bounds | Failure behavior | MCP coverage |',
  '| --- | --- | --- | --- | --- |',
  ...inventory.map((row) => `| ${escape(row.source)} — ${escape(row.kind)} | ${escape(row.schema)} | ${escape(row.budget)} | ${escape(row.failure)} | ${escape(row.mcp)} |`),
  '',
  '## Remaining explicit gaps', '',
  ...inventory.filter((row) => row.gap).map((row) => `- ${row.gap}`),
  '- Successful fileOps `file_move` / `file_rename` rebind still needs MCP runtime acceptance. Its plan waits for renderer approval, so the in-memory SQLite verifier intentionally does not claim an application-level operation.',
  '- Filesystem and clipboard image preview readers now keep growth bounded by reading at most limit + 1 from one open file handle. MCP fixtures cover normal/oversized inputs; the clipboard fake-handle verifier additionally simulates post-fstat growth, but live OS-level writer races are not orchestrated.',
  '- Full resource GET intentionally streams with no total response byte ceiling. It avoids whole-file buffering; callers needing bounded transfer must request a byte range.', '',
  'This is a targeted source inventory of selected JSON, SQLite, binary file, and third-party response boundaries found in `src/main`; it does not claim exhaustive coverage of all persistence, filesystem reads, generated JSON output, or excluded areas.'
]
writeFileSync(markdownPath, `${lines.join('\n')}\n`)
console.log(`Persistence/import boundary inventory: ${inventory.length} entries`)
console.log(`Report: ${markdownPath}`)
console.log(`Data: ${jsonPath}`)
