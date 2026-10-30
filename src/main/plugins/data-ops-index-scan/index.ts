import { opendir, lstat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { randomUUID } from 'node:crypto'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { identity, isEqualOrInside, normalize } from '../../services/paths'
import { mcpError, mcpText } from '../../services/mcp'

const PLUGIN = 'data-ops-index-scan'
const BATCH_SIZE = 500
const DEFAULT_IGNORES = ['node_modules', '.git', '$RECYCLE.BIN', 'System Volume Information']
const scanSchema = z.object({ roots: z.array(z.string().min(1)).min(1).max(32), ignore: z.array(z.string().min(1)).max(256).optional() })
const indexSettingsSchema = z.object({
  roots: z.array(z.string().min(1)).max(32).default([]).describe('索引根目录；空列表时需在扫描时指定'),
  ignore: z.array(z.string().min(1)).max(256).default(DEFAULT_IGNORES).describe('忽略的目录名或通配符路径规则')
})
type Kind = 'code' | 'image' | 'document' | 'data' | 'archive' | 'video' | 'audio' | 'other'
type SqlOutputValue = null | number | bigint | string | NodeJS.NonSharedUint8Array
interface Row extends Record<string, SqlOutputValue> { path: string; path_key: string; parent_key: string | null; name: string; extension: string; kind: string; size: number; mtime_ms: number }

const KIND_EXT: Record<string, Kind> = {
  ts: 'code', tsx: 'code', js: 'code', jsx: 'code', mjs: 'code', cjs: 'code', css: 'code', html: 'code', py: 'code', rs: 'code',
  png: 'image', jpg: 'image', jpeg: 'image', gif: 'image', webp: 'image', bmp: 'image', svg: 'image',
  md: 'document', txt: 'document', pdf: 'document', doc: 'document', docx: 'document', log: 'document',
  json: 'data', yaml: 'data', yml: 'data', xml: 'data', csv: 'data', toml: 'data',
  zip: 'archive', rar: 'archive', '7z': 'archive', tar: 'archive', gz: 'archive',
  mp4: 'video', mkv: 'video', mov: 'video', webm: 'video', mp3: 'audio', wav: 'audio', flac: 'audio', ogg: 'audio'
}

function wildcard(pattern: string): RegExp {
  const source = pattern.split('').map((c) => c === '*' ? '.*' : c === '?' ? '.' : c.replace(/[|\\{}()[\]^$+?.]/g, '\\$&')).join('')
  return new RegExp(`^${source}$`, process.platform === 'win32' ? 'i' : '')
}
function ignored(name: string, relativePath: string, rules: RegExp[]): boolean {
  return rules.some((rule) => rule.test(name) || rule.test(relativePath))
}
function kindFor(path: string): Kind {
  return KIND_EXT[extname(path).slice(1).toLowerCase()] ?? 'other'
}
function nextTurn(): Promise<void> { return new Promise((resolve) => setImmediate(resolve)) }

const plugin: Plugin = {
  name: PLUGIN,
  inject: ['db', 'ipc', 'mcp', 'jobs', 'audit', 'settings', 'commands'],
  apply(ctx: Context): void {
    ctx.settings.register('indexing', indexSettingsSchema, { roots: [], ignore: DEFAULT_IGNORES }, { title: '文件索引', description: '配置索引根目录与扫描忽略规则', group: '文件管理' })
    ctx.db.migrate(PLUGIN, [{
      id: 'scan-staging', version: 3,
      sql: `CREATE TABLE IF NOT EXISTS index_scan_seen (run_id TEXT NOT NULL, kind TEXT NOT NULL, path_key TEXT NOT NULL, PRIMARY KEY(run_id, kind, path_key)) WITHOUT ROWID;
            CREATE INDEX IF NOT EXISTS index_scan_seen_run_idx ON index_scan_seen(run_id);`
    }])
    ctx.db.run('DELETE FROM index_scan_seen')
    let running: { id: string; root: string } | null = null

    async function scan(rootsValue?: unknown, ignoreValue?: unknown, origin: 'ui' | 'mcp' | 'command' = 'ui'): Promise<{ jobId: string }> {
      const configured = await ctx.settings.get('indexing')
      const args = scanSchema.parse({ roots: rootsValue ?? configured.roots, ignore: ignoreValue ?? configured.ignore })
      if (running) throw new Error(`已有索引扫描任务运行：${running.id}`)
      const requestedRoots = [...new Set(args.roots.map(normalize))]
      const roots = requestedRoots.filter((candidate) => !requestedRoots.some((other) =>
        other !== candidate && isEqualOrInside(other, candidate)
      ))
      const rules = [...new Set([...DEFAULT_IGNORES, ...(args.ignore ?? [])])].map(wildcard)
      const job = ctx.jobs.create({ label: `索引扫描 ${roots.length} 个目录`, cancelable: true })
      running = { id: job.id, root: roots.join(';') }
      const runId = randomUUID()
      void (async () => {
        let visited = 0
        let fileCount = 0
        let folderCount = 0
        let incomplete = false
        let unreadable = 0
        let pending: Row[] = []
        const flush = (): void => {
          if (!pending.length) return
          ctx.db.tx((db) => {
            for (const row of pending) {
              const isFolder = row.kind === 'folder'
              if (isFolder) {
                db.run(`INSERT INTO folders(path_key,path,parent_key,name,mtime_ms,indexed_at) VALUES(?,?,?,?,?,?)
                  ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,parent_key=excluded.parent_key,name=excluded.name,mtime_ms=excluded.mtime_ms,indexed_at=excluded.indexed_at`, row.path_key, row.path, row.parent_key, row.name, row.mtime_ms, Date.now())
                db.run('INSERT OR IGNORE INTO index_scan_seen(run_id,kind,path_key) VALUES(?,?,?)', runId, 'folder', row.path_key)
                folderCount++
              } else {
                db.run(`INSERT INTO files(path_key,path,parent_key,name,extension,kind,size,mtime_ms,indexed_at) VALUES(?,?,?,?,?,?,?,?,?)
                  ON CONFLICT(path_key) DO UPDATE SET path=excluded.path,parent_key=excluded.parent_key,name=excluded.name,extension=excluded.extension,kind=excluded.kind,size=excluded.size,mtime_ms=excluded.mtime_ms,indexed_at=excluded.indexed_at`, row.path_key, row.path, row.parent_key, row.name, row.extension, row.kind, row.size, row.mtime_ms, Date.now())
                db.run('INSERT OR IGNORE INTO index_scan_seen(run_id,kind,path_key) VALUES(?,?,?)', runId, 'file', row.path_key)
                fileCount++
              }
            }
          })
          visited += pending.length
          pending = []
          job.progress(visited, `${fileCount} 个文件，${folderCount} 个目录`)
        }
        try {
          for (const root of roots) {
            if (job.signal.aborted) break
            const rootStat = await lstat(root)
            if (!rootStat.isDirectory() || rootStat.isSymbolicLink()) throw new Error(`索引根目录无效：${root}`)
            const rootKey = identity(root)
            const rootDir: Row = { path: root, path_key: rootKey, parent_key: null, name: basename(root) || root, extension: '', kind: 'folder', size: 0, mtime_ms: rootStat.mtimeMs }
            pending.push(rootDir)
            const queue: Array<{ path: string; relative: string }> = [{ path: root, relative: '' }]
            let queueIndex = 0
            while (queueIndex < queue.length && !job.signal.aborted) {
              const current = queue[queueIndex++]
              let dir
              try { dir = await opendir(current.path) } catch { incomplete = true; unreadable += 1; continue }
              for await (const entry of dir) {
                if (job.signal.aborted) break
                const child = join(current.path, entry.name)
                const relativePath = current.relative ? `${current.relative}/${entry.name}` : entry.name
                if (ignored(entry.name, relativePath, rules)) continue
                if (entry.isSymbolicLink()) continue
                try {
                  const stat = await lstat(child)
                  if (stat.isSymbolicLink()) continue
                  const folder = stat.isDirectory()
                  const key = identity(child)
                  const parentKey = identity(dirname(child))
                  pending.push({ path: normalize(child), path_key: key, parent_key: parentKey, name: entry.name, extension: folder ? '' : extname(entry.name).slice(1).toLowerCase(), kind: folder ? 'folder' : kindFor(child), size: folder ? 0 : stat.size, mtime_ms: stat.mtimeMs })
                  if (folder) queue.push({ path: child, relative: relativePath })
                  if (pending.length >= BATCH_SIZE) { flush(); await nextTurn() }
                } catch { incomplete = true; unreadable += 1 }
              }
            }
            flush()
          }
          if (job.signal.aborted) {
            ctx.db.run('DELETE FROM index_scan_seen WHERE run_id=?', runId)
            job.finish({ canceled: true, visited, fileCount, folderCount })
            return
          }
          if (incomplete) {
            ctx.db.run('DELETE FROM index_scan_seen WHERE run_id=?', runId)
            job.finish({ roots, visited, fileCount, folderCount, incomplete: true, unreadable, staleRowsPreserved: true })
            ctx.audit.record({ origin, tool: 'index.scan', allowed: false, planId: job.id, error: `${unreadable} 个路径无法读取；保留旧索引行` })
            return
          }
          // Only a complete traversal may remove rows absent from this run. Scope is checked in JS to avoid SQL wildcard ambiguity.
          ctx.db.tx((db) => {
            const staleFiles = db.all<{ path_key: string; path: string }>('SELECT path_key,path FROM files')
              .filter((row) => roots.some((root) => isEqualOrInside(root, row.path)) && !db.get('SELECT 1 AS found FROM index_scan_seen WHERE run_id=? AND kind=? AND path_key=?', runId, 'file', row.path_key))
            const staleFolders = db.all<{ path_key: string; path: string }>('SELECT path_key,path FROM folders')
              .filter((row) => roots.some((root) => isEqualOrInside(root, row.path)) && !db.get('SELECT 1 AS found FROM index_scan_seen WHERE run_id=? AND kind=? AND path_key=?', runId, 'folder', row.path_key))
            for (const row of staleFiles) db.run('DELETE FROM files WHERE path_key=?', row.path_key)
            for (const row of staleFolders.sort((a, b) => b.path.length - a.path.length)) db.run('DELETE FROM folders WHERE path_key=?', row.path_key)
            db.run('DELETE FROM index_scan_seen WHERE run_id=?', runId)
          })
          job.finish({ roots, visited, fileCount, folderCount })
          ctx.audit.record({ origin, tool: 'index.scan', allowed: true, planId: job.id, items: visited })
        } catch (error) {
          ctx.db.run('DELETE FROM index_scan_seen WHERE run_id=?', runId)
          job.fail(error)
          ctx.audit.record({ origin, tool: 'index.scan', allowed: false, planId: job.id, error: error instanceof Error ? error.message : String(error) })
        }
      })().finally(() => { if (running?.id === job.id) running = null })
      return { jobId: job.id }
    }

    ctx.ipc.handle('indexScan', {
      start: (roots?: unknown, ignore?: unknown) => scan(roots, ignore),
      cancel: (jobId?: string) => !!jobId && ctx.jobs.cancel(jobId),
      status: () => ({ runningJobId: running?.id ?? null, roots: running?.root ?? null })
    })
    ctx.mcp.registerTool('index_scan', {
      description: '扫描指定目录并更新本地文件索引；返回后台作业 ID，可由 job:progress/job:done 观察进度',
      inputSchema: { roots: z.array(z.string().min(1)).min(1).max(32).optional(), ignore: z.array(z.string().min(1)).max(256).optional() },
      mutating: true, impact: 'low',
      execute: async (args) => { try { return mcpText(JSON.stringify(await scan(args.roots, args.ignore, 'mcp'))) } catch (e) { return mcpError(e instanceof Error ? e.message : String(e)) } }
    })

    ctx.commands.register({
      id: 'index.scan', title: '扫描配置目录', group: '文件索引',
      description: '按设置中的根目录与忽略规则更新文件索引',
      mutating: true, impact: 'low',
      plan: async () => {
        const configured = indexSettingsSchema.parse(await ctx.settings.get('indexing'))
        if (!configured.roots.length) throw new Error('请先在设置中添加索引根目录')
        return { roots: configured.roots, ignore: configured.ignore }
      },
      run: async (_args, approvedPlan, origin) => {
        const input = approvedPlan as { roots?: unknown; ignore?: unknown } | undefined
        return scan(input?.roots, input?.ignore, origin ?? 'ui')
      }
    })
  }
}
export default plugin
