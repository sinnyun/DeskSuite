import { app, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import type { Context, Plugin } from 'cordis'
import { spawn } from 'node:child_process'
import { createReadStream, watch, type FSWatcher } from 'node:fs'
import { lstat, mkdir, open, rename, stat, writeFile } from 'node:fs/promises'
import { dirname, join, resolve, sep } from 'node:path'
import { assertWritable, identity, normalize } from '../../services/paths'
import { errorMessage } from '../../services/error-text'
import { mcpErrorFrom, mcpText } from '../../services/mcp'
import { assertUiWritable } from './write-access'
import { MAX_VERSION_PREVIEW_BYTES, readBoundedVersionPreviewHandle } from './preview-file'
import { z } from 'zod'

const PLUGIN_ID = 'data-ops-versions'
const HISTORY_ROOT = join(app.getPath('userData'), 'data', 'versions')
const RESTORE_CONFIRMATION = z.literal(true)
const branchActionSchema = z.object({
  action: z.enum(['create', 'switch', 'archive', 'merge', 'resolve', 'abort']),
  name: z.string().max(240).optional(), sourceBranch: z.string().max(240).optional(),
  strategy: z.enum(['ours', 'theirs']).optional(), overwrite: z.boolean().optional()
})
let bridgeLaunches = 0

interface BridgeRequest {
  operation: 'list' | 'state' | 'create' | 'restore' | 'abandonRestore' | 'restoreStatus' | 'branchGraph' | 'branchAction' | 'fingerprints'
  root: string
  entityId: string
  sourcePath?: string
  versionId?: string
  title?: string
  includeArchived?: boolean
  action?: string
  name?: string
  sourceBranch?: string
  strategy?: string
  overwrite?: boolean
  pendingMerge?: unknown
  versionIds?: string[]
  expectedSourceSha256?: string
}

interface RestoreStatus {
  pending: boolean
  sourcePath: string | null
  versionId: string | null
  sourceAvailable: boolean
  sameSourceBytes: boolean
  sourceIsTarget: boolean
  diagnostic?: string
}

interface BridgeEntry {
  versionId: string
  revisionNumber: number
  parentRevisionIds: string[]
  title: string
  createdAt: string
  sizeBytes: number
  contentType?: string | null
}

const BridgeResponseSchema = z.object({
  ok: z.boolean(),
  result: z.unknown().optional(),
  error: z.string().max(1024 * 1024).nullable().optional()
}).strict()

type VersionEntity = ReturnType<Context['versionInfo']['getOrCreateEntity']>
type VersionRecord = ReturnType<Context['versionInfo']['list']>[number]
type VersionGraph = ReturnType<Context['versionInfo']['graph']>

function bridgeExecutable(): string {
  const name = process.platform === 'win32' ? 'desksuite-lore-bridge.exe' : 'desksuite-lore-bridge'
  return app.isPackaged
    ? join(process.resourcesPath, 'lore-bridge', name)
    : join(process.cwd(), 'native', 'lore-bridge', 'bin', name)
}

function runBridge(request: BridgeRequest): Promise<unknown> {
  bridgeLaunches++
  return new Promise((resolve, reject) => {
    const child = spawn(bridgeExecutable(), [], { stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true })
    const stdout: Buffer[] = []
    const stderr: Buffer[] = []
    let stdoutBytes = 0
    let stderrBytes = 0
    let settled = false
    const finish = (error?: Error, result?: unknown): void => {
      if (settled) return
      settled = true
      clearTimeout(timer)
      if (error) reject(error)
      else resolve(result)
    }
    const timer = setTimeout(() => {
      child.kill()
      finish(new Error('Lore 版本引擎执行超时'))
    }, 120_000)
    timer.unref?.()
    child.stdout.on('data', (part: Buffer) => {
      stdoutBytes += part.length
      if (stdoutBytes > 16 * 1024 * 1024) {
        child.kill()
        finish(new Error('Lore sidecar 响应超过 16 MiB 上限'))
      } else stdout.push(part)
    })
    child.stderr.on('data', (part: Buffer) => {
      stderrBytes += part.length
      if (stderrBytes <= 1024 * 1024) stderr.push(part)
    })
    child.once('error', (error) => finish(new Error(`无法启动 Lore sidecar：${error.message}`)))
    child.once('close', (code) => {
      if (code !== 0) {
        const detail = Buffer.concat(stderr).toString('utf8').trim()
        finish(new Error(detail || `Lore sidecar 退出，代码 ${String(code)}`))
        return
      }
      try {
        const parsed: unknown = JSON.parse(Buffer.concat(stdout).toString('utf8'))
        const response = BridgeResponseSchema.parse(parsed)
        if (!response.ok) throw new Error(`Lore ${request.operation}: ${response.error || '操作失败'}`)
        finish(undefined, response.result)
      } catch (error) {
        finish(error instanceof Error ? error : new Error(String(error)))
      }
    })
    child.stdin.end(`${JSON.stringify(request)}\n`, 'utf8')
  })
}

function entityFor(ctx: Context, path: string): VersionEntity {
  return ctx.versionInfo.getOrCreateEntity(normalize(path))
}

function entityByPath(ctx: Context, path: string): VersionEntity | null {
  return ctx.versionInfo.getEntityByPath(normalize(path))
}

async function requireRegularFile(path: string): Promise<void> {
  const metadata = await lstat(path)
  if (!metadata.isFile() || metadata.isSymbolicLink()) throw new Error('版本操作只支持普通文件，不支持符号链接或目录')
}

function sha256File(path: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const hash = createHash('sha256')
    const stream = createReadStream(path)
    stream.on('data', (chunk) => hash.update(chunk))
    stream.once('error', reject)
    stream.once('end', () => resolve(hash.digest('hex')))
  })
}

function toRecord(entityId: string, item: BridgeEntry): VersionRecord {
  return {
    entityId,
    versionId: item.versionId,
    revisionNumber: item.revisionNumber,
    parentRevisionIds: item.parentRevisionIds,
    title: item.title,
    createdAt: item.createdAt,
    sizeBytes: item.sizeBytes,
    contentType: item.contentType ?? null,
    thumbnailPath: null,
    isCurrent: false
  }
}

async function makeVersionPreview(path: string, entityId: string, versionId: string): Promise<string | null> {
  const image = await nativeImage.createThumbnailFromPath(path, { width: 320, height: 320 })
  if (image.isEmpty()) return null
  const target = join(HISTORY_ROOT, 'previews', entityId, `${versionId}.jpg`)
  await mkdir(dirname(target), { recursive: true })
  const temporary = `${target}.${process.pid}.tmp`
  const jpeg = image.resize({ width: 240, height: 240, quality: 'better' }).toJPEG(80)
  await writeFile(temporary, jpeg, { flag: 'w' })
  try {
    await rename(temporary, target)
  } catch (error) {
    await import('node:fs/promises').then(({ rm }) => rm(temporary, { force: true })).catch(() => undefined)
    throw error
  }
  return `data/versions/previews/${entityId}/${versionId}.jpg`
}

async function withEntityLock<T>(locks: Map<string, Promise<void>>, entityId: string, work: () => Promise<T>): Promise<T> {
  const previous = locks.get(entityId) ?? Promise.resolve()
  let release!: () => void
  const current = new Promise<void>((resolve) => { release = resolve })
  locks.set(entityId, current)
  await previous
  try {
    return await work()
  } finally {
    release()
    if (locks.get(entityId) === current) locks.delete(entityId)
  }
}

const plugin: Plugin = {
  name: PLUGIN_ID,
  inject: ['ipc', 'mcp', 'jobs', 'audit', 'config', 'db', 'versionInfo', 'window', 'storage', 'commands'],
  apply(ctx: Context): void {
    ctx.storage.register(PLUGIN_ID, {
      title: '文件版本历史',
      entries: [{ label: '版本对象与预览', relativePath: 'data/versions', kind: 'directory' }]
    })
    const locks = new Map<string, Promise<void>>()

    function writeOptions(): { allowedRoots: string[]; forbidden: string[] } {
      return { allowedRoots: ctx.config.get('mcp').writeRoots, forbidden: [app.getPath('userData')] }
    }

    async function authorizeUiWrite(path: string): Promise<void> {
      await assertUiWritable(path, [app.getPath('userData')])
    }

    function syncCurrent(entityId: string, versionId: string | null): void {
      const records = ctx.versionInfo.list(entityId)
      if (versionId && records.some((record) => record.versionId === versionId)) {
        if (!records.some((record) => record.versionId === versionId && record.isCurrent)) {
          ctx.versionInfo.setCurrent(entityId, versionId)
        }
        return
      }
      for (const record of records) {
        if (record.isCurrent) ctx.versionInfo.save({ ...record, isCurrent: false })
      }
    }

    async function restoreStatusFor(entity: VersionEntity, path: string): Promise<RestoreStatus> {
      return await runBridge({
        operation: 'restoreStatus', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path
      }) as RestoreStatus
    }

    async function readCatalog(entity: VersionEntity): Promise<VersionRecord[]> {
      return ctx.versionInfo.list(entity.entityId)
    }

    async function list(pathValue: unknown): Promise<VersionRecord[]> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const entity = entityByPath(ctx, normalize(pathValue))
      return entity ? ctx.versionInfo.list(entity.entityId) : []
    }

    async function preview(pathValue: unknown, versionIdValue: unknown): Promise<string | null> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      if (typeof versionIdValue !== 'string' || !versionIdValue.trim()) throw new TypeError('versionId must be a nonempty string')
      const path = normalize(pathValue)
      const entity = entityByPath(ctx, path)
      if (!entity) return null
      const record = ctx.versionInfo.list(entity.entityId).find((item) => item.versionId === versionIdValue)
      if (!record?.thumbnailPath) return null
      const expectedRelative = `data/versions/previews/${entity.entityId}/${versionIdValue}.jpg`
      if (record.thumbnailPath !== expectedRelative) return null
      const previewRoot = resolve(HISTORY_ROOT, 'previews', entity.entityId)
      const previewPath = resolve(previewRoot, `${versionIdValue}.jpg`)
      if (!previewPath.startsWith(`${previewRoot}${sep}`)) return null
      const metadata = await lstat(previewPath)
      if (!metadata.isFile() || metadata.isSymbolicLink() || metadata.size > MAX_VERSION_PREVIEW_BYTES) return null
      const handle = await open(previewPath, 'r')
      let bytes: Buffer | null
      try {
        bytes = await readBoundedVersionPreviewHandle(handle, { dev: metadata.dev, ino: metadata.ino })
      } finally {
        await handle.close()
      }
      if (!bytes) return null
      return `data:image/jpeg;base64,${bytes.toString('base64')}`
    }

    async function state(pathValue: unknown): Promise<Record<string, unknown>> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const entity = entityByPath(ctx, normalize(pathValue))
      if (!entity) return { status: 'unversioned', currentVersionId: null, matchingVersionId: null }
      const snapshot = ctx.versionInfo.snapshot(entity.entityId)
      const rows = ctx.versionInfo.list(entity.entityId)
      const current = rows.find(row => row.isCurrent)
      const matching = rows.find(row => row.versionId === snapshot.state.matchingVersionId)
      return { ...snapshot.state, currentVersionId: current?.versionId ?? null, currentTitle: current?.title ?? null,
        matchingTitle: matching?.title ?? null, synchronizedAt: snapshot.synchronizedAt,
        operation: snapshot.operation, synchronizationError: snapshot.error }
    }

    async function observeSource(pathValue: unknown): Promise<Record<string, unknown>> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const path = normalize(pathValue)
      const entity = entityByPath(ctx, path)
      if (!entity) return { status: 'unversioned', currentVersionId: null, matchingVersionId: null }
      const snapshot = ctx.versionInfo.snapshot(entity.entityId)
      const versions = ctx.versionInfo.list(entity.entityId)
      const current = versions.find(item => item.isCurrent)
      const base: Record<string, unknown> = { ...snapshot.state, currentVersionId: current?.versionId ?? null, currentTitle: current?.title ?? null }
      // File bytes are checked locally against persisted SHA-256 fingerprints. No Lore process is started.
      try {
        const metadata = await stat(path)
        const digest = await sha256File(path)
        base.sourceMetadata = { sizeBytes: metadata.size, modifiedAt: metadata.mtimeMs }
        const matching = versions.find(item => snapshot.fingerprints[item.versionId] === digest && item.isCurrent)
          ?? versions.find(item => snapshot.fingerprints[item.versionId] === digest)
        const pending = snapshot.state.pendingRestore as (RestoreStatus & { expectedSourceSha256?: string }) | undefined
        if (pending?.pending) return { ...base, status: 'interrupted_restore', pendingRestore: { ...pending,
          sourceAvailable: true, sameSourceBytes: digest === pending.expectedSourceSha256,
          sourceIsTarget: Boolean(pending.versionId && snapshot.fingerprints[pending.versionId] === digest) } }
        return { ...base, status: matching ? (matching.isCurrent ? 'saved' : 'matches_saved_version')
          : snapshot.fingerprints[current?.versionId ?? ''] ? 'modified' : 'unknown',
          matchingVersionId: matching?.versionId ?? null, matchingTitle: matching?.title ?? null }
      } catch (error) {
        const pending = snapshot.state.pendingRestore as RestoreStatus | undefined
        return { ...base, status: pending?.pending ? 'interrupted_restore' : 'unavailable',
          pendingRestore: pending?.pending ? { ...pending, sourceAvailable: false } : null,
          diagnostic: errorMessage(error, '原文件不可访问') }
      }
    }

    // Only mutation/reconciliation paths call this function. Publish the complete read model in one SQLite transaction.
    async function synchronize(entity: VersionEntity, path: string, stagedVersion?: VersionRecord): Promise<VersionGraph> {
      const previous = ctx.versionInfo.snapshot(entity.entityId)
      const restoreStatus = await restoreStatusFor(entity, path)
      const catalog = await runBridge({ operation: 'list', root: HISTORY_ROOT, entityId: entity.entityId }) as {
        entries: BridgeEntry[]; headRevisionId: string | null
      }
      const rawGraph = restoreStatus.pending ? null : await runBridge({ operation: 'branchGraph', root: HISTORY_ROOT,
        entityId: entity.entityId, includeArchived: true }) as {
          branches: VersionGraph['branches']; graphState: string; pendingMerge: VersionGraph['pendingMerge']; currentRevisionId: string | null
        }
      const digestBefore = await sha256File(path).catch(() => null)
      const rawState: Record<string, unknown> = restoreStatus.pending ? { status: 'interrupted_restore', pendingRestore: restoreStatus }
        : await runBridge({ operation: 'state', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path,
          versionIds: [...new Set([...catalog.entries.map(item => item.versionId), ...(rawGraph?.branches ?? []).flatMap(b => b.revisions.map(r => r.versionId))])] }) as Record<string, unknown>
      const digest = await sha256File(path).catch(() => null)
      const sourceMetadata = await stat(path).catch(() => null)
      rawState.sourceMetadata = sourceMetadata ? { sizeBytes: sourceMetadata.size, modifiedAt: sourceMetadata.mtimeMs } : null
      const currentId = rawGraph?.currentRevisionId ?? catalog.headRevisionId
      const rows = new Map(ctx.versionInfo.list(entity.entityId).map(row => [row.versionId, row]))
      if (stagedVersion) rows.set(stagedVersion.versionId, stagedVersion)
      for (const item of [...catalog.entries, ...(rawGraph?.branches ?? []).flatMap(branch => branch.revisions)]) {
        if (!rows.has(item.versionId)) rows.set(item.versionId, toRecord(entity.entityId, item))
      }
      const graph: VersionGraph = rawGraph ? {
        branches: rawGraph.branches.map(branch => ({ ...branch, revisions: branch.revisions.map(item => ({
          ...rows.get(item.versionId)!, isCurrent: item.versionId === currentId
        })) })), graphState: rawGraph.graphState, pendingMerge: rawGraph.pendingMerge
      } : ctx.versionInfo.graph(entity.entityId)
      const fingerprints = { ...previous.fingerprints }
      const missing = [...rows.keys()].filter(id => !fingerprints[id])
      if (missing.length) Object.assign(fingerprints, await runBridge({ operation: 'fingerprints', root: HISTORY_ROOT,
        entityId: entity.entityId, versionIds: missing }))
      if (rawState.status === 'saved' && currentId && digest && digest === digestBefore) fingerprints[currentId] = digest
      ctx.db.tx(() => {
        for (const row of rows.values()) ctx.versionInfo.save({ ...row, isCurrent: false })
        syncCurrent(entity.entityId, currentId)
        ctx.versionInfo.putGraph(entity.entityId, graph)
        ctx.versionInfo.putSnapshot(entity.entityId, { state: rawState, fingerprints,
          synchronizedAt: Date.now(), operation: null, error: null })
      })
      watchEntities()
      return graph
    }

    const watched = new Map<string, { path: string; watcher: FSWatcher; timer?: ReturnType<typeof setTimeout> }>()
    const updateSource = async (entityId: string): Promise<void> => {
      await withEntityLock(locks, entityId, async () => {
        const entity = ctx.versionInfo.entities().find(item => item.entityId === entityId)
        if (!entity) return
        const previous = ctx.versionInfo.snapshot(entityId)
        const observed = await observeSource(entity.path)
        // Persist observation only; engine state and fingerprints are owned by operations.
        if (JSON.stringify(previous.state) === JSON.stringify(observed)) return
        ctx.versionInfo.putSnapshot(entityId, { ...previous, state: observed })
        ctx.ipc.broadcast('versions:changed', { path: entity.path, entityId, kind: 'source', at: Date.now() })
      })
    }
    const watchEntities = (): void => {
      for (const entity of ctx.versionInfo.entities()) {
        const existing = watched.get(entity.entityId)
        if (existing?.path === entity.path) continue
        existing?.watcher.close()
        if (existing?.timer) clearTimeout(existing.timer)
        const schedule = (): void => {
          const record = watched.get(entity.entityId)
          if (!record) return
          if (record.timer) clearTimeout(record.timer)
          record.timer = setTimeout(() => { record.timer = undefined; void updateSource(entity.entityId).catch(console.error) }, 150)
        }
        try {
          const watcher = watch(dirname(entity.path), (_event, filename) => {
            if (!filename || identity(join(dirname(entity.path), filename.toString())) === identity(entity.path)) schedule()
          })
          watcher.on('error', () => { watcher.close(); watched.delete(entity.entityId) })
          watched.set(entity.entityId, { path: entity.path, watcher })
        } catch { /* Missing parent directories are retried by discovery. */ }
        void updateSource(entity.entityId).catch(console.error)
      }
    }
    const discovery = setInterval(watchEntities, 5000)
    discovery.unref()
    watchEntities()
    ctx.effect(() => () => {
      clearInterval(discovery)
      for (const record of watched.values()) { record.watcher.close(); if (record.timer) clearTimeout(record.timer) }
    })

    function beginOperation(entity: VersionEntity, operation: string): void {
      ctx.versionInfo.putSnapshot(entity.entityId, { ...ctx.versionInfo.snapshot(entity.entityId), operation, error: null })
    }

    async function recordFailure(entity: VersionEntity, path: string, _error: unknown): Promise<void> {
      try { await synchronize(entity, path) }
      catch (syncError) {
        ctx.versionInfo.putSnapshot(entity.entityId, { ...ctx.versionInfo.snapshot(entity.entityId),
          error: syncError instanceof Error ? syncError.message : String(syncError) })
      }
      ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
    }

    async function branchGraph(pathValue: unknown, includeArchived = false): Promise<VersionGraph> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const entity = entityByPath(ctx, normalize(pathValue))
      if (!entity) return { branches: [], graphState: 'empty', pendingMerge: null }
      const graph = ctx.versionInfo.graph(entity.entityId)
      return { ...graph, branches: graph.branches.filter(branch => includeArchived || !branch.isArchived) }
    }

    async function reconcile(pathValue: string, confirmed: boolean): Promise<VersionGraph> {
      RESTORE_CONFIRMATION.parse(confirmed)
      const path = normalize(pathValue)
      const entity = entityByPath(ctx, path)
      if (!entity) throw new Error('该文件尚无版本实体')
      return withEntityLock(locks, entity.entityId, async () => {
        beginOperation(entity, 'reconcile')
        try {
          const graph = await synchronize(entity, path)
          ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
          return graph
        } catch (error) { await recordFailure(entity, path, error); throw error }
      })
    }

    async function branchAction(pathValue: unknown, inputValue: unknown, confirmed: unknown, origin: 'ui' | 'mcp' = 'ui'): Promise<{ jobId: string }> {
      const input = branchActionSchema.parse(inputValue)
      RESTORE_CONFIRMATION.parse(confirmed)
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const path = normalize(pathValue)
      await requireRegularFile(path)
      const writesSource = ['switch', 'merge', 'resolve'].includes(input.action)
      if (writesSource && origin === 'mcp') await assertWritable(path, writeOptions())
      const entity = entityByPath(ctx, path)
      if (!entity) throw new Error('该文件尚无 Lore 历史')
      const expectedSourceSha256 = await sha256File(path)
      const job = ctx.jobs.create({ label: `Lore 分支操作：${input.action}`, cancelable: false })
      void withEntityLock(locks, entity.entityId, async () => {
        try {
          beginOperation(entity, `branch:${input.action}`)
          const previous = await synchronize(entity, path)
          beginOperation(entity, `branch:${input.action}`)
          if (previous.pendingMerge && !['resolve', 'abort'].includes(input.action)) {
            throw new Error('请先解决或中止当前待处理的分支合并')
          }
          if (writesSource && origin === 'ui') await authorizeUiWrite(path)
          const result = await runBridge({
            operation: 'branchAction', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path,
            action: input.action, name: input.name, sourceBranch: input.sourceBranch, strategy: input.strategy,
            overwrite: input.overwrite, pendingMerge: previous.pendingMerge, expectedSourceSha256
          }) as { completed?: boolean; hasConflicts?: boolean; sourceBranch?: string; targetBranch?: string; targetBaseRevisionId?: string; conflictFiles?: string[]; fileChanged?: boolean }
          if (result.hasConflicts) {
            ctx.versionInfo.putGraph(entity.entityId, {
              ...previous,
              pendingMerge: {
                sourceBranch: result.sourceBranch ?? '', targetBranch: result.targetBranch ?? '',
                conflictFiles: result.conflictFiles ?? [], targetBaseRevisionId: result.targetBaseRevisionId ?? ''
              }
            })
          } else if (input.action === 'resolve' || input.action === 'abort') {
            ctx.versionInfo.putGraph(entity.entityId, { ...previous, pendingMerge: null })
          }
          await synchronize(entity, path)
          if (result.fileChanged) {
            const after = await stat(path)
            ctx.db.run('UPDATE files SET size=?,mtime_ms=?,indexed_at=? WHERE path_key=?', after.size, after.mtimeMs, Date.now(), identity(path))
            ctx.ipc.broadcast('fs:changed', { paths: [path], dirs: [dirname(path)], invalidate: false, at: Date.now() })
          }
          ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
          ctx.audit.record({ origin, tool: 'versions.branchAction', allowed: true, planId: job.id, items: 1 })
          job.finish(result)
        } catch (error) {
          ctx.audit.record({ origin, tool: 'versions.branchAction', allowed: false, planId: job.id, error: error instanceof Error ? error.message : String(error) })
          await recordFailure(entity, path, error)
          job.fail(error)
        }
      })
      return { jobId: job.id }
    }

    async function create(pathValue: unknown, titleValue: unknown, origin: 'ui' | 'mcp' = 'ui'): Promise<{ jobId: string }> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      const path = normalize(pathValue)
      if (typeof titleValue !== 'string') throw new TypeError('title must be a string')
      await requireRegularFile(path)
      const entity = entityFor(ctx, path)
      const expectedSourceSha256 = await sha256File(path)
      if (ctx.versionInfo.graph(entity.entityId).pendingMerge) throw new Error('请先解决或中止当前待处理的分支合并')
      const job = ctx.jobs.create({ label: `保存文件版本：${titleValue.trim()}`, cancelable: false })
      void withEntityLock(locks, entity.entityId, async () => {
        try {
          beginOperation(entity, 'create')
          job.progress(0, '正在创建 Lore 快照')
          const value = await runBridge({
            operation: 'create', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path,
            title: titleValue.trim() || `版本 ${Math.max(0, ...ctx.versionInfo.list(entity.entityId).map(row => row.revisionNumber)) + 1}`, expectedSourceSha256
          }) as BridgeEntry
          const version = toRecord(entity.entityId, value)
          version.isCurrent = false
          try {
            if (await sha256File(path) === expectedSourceSha256) {
              version.thumbnailPath = await makeVersionPreview(path, entity.entityId, version.versionId)
            }
          } catch (error) {
            ctx.audit.record({ origin, tool: 'versions.preview', allowed: false, planId: job.id, error: error instanceof Error ? error.message : String(error) })
          }
          await synchronize(entity, path, version)
          ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_create' : 'versions.create', allowed: true, planId: job.id, items: 1 })
          job.finish({ version })
        } catch (error) {
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_create' : 'versions.create', allowed: false, planId: job.id, error: error instanceof Error ? error.message : String(error) })
          await recordFailure(entity, path, error)
          job.fail(error)
        }
      })
      return { jobId: job.id }
    }

    async function restore(pathValue: unknown, versionIdValue: unknown, confirmed: unknown, origin: 'ui' | 'mcp' = 'ui'): Promise<{ jobId: string }> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      if (typeof versionIdValue !== 'string' || !versionIdValue.trim()) throw new TypeError('versionId must be a nonempty string')
      RESTORE_CONFIRMATION.parse(confirmed)
      const path = normalize(pathValue)
      await requireRegularFile(path)
      if (origin === 'mcp') await assertWritable(path, writeOptions())
      const entity = entityByPath(ctx, path)
      if (!entity) throw new Error('该文件尚无 Lore 历史')
      const expectedSourceSha256 = await sha256File(path)
      const job = ctx.jobs.create({ label: '恢复文件历史版本', cancelable: false })
      void withEntityLock(locks, entity.entityId, async () => {
        try {
          beginOperation(entity, 'restore')
          const restoreStatus = await restoreStatusFor(entity, path)
          if (!restoreStatus.pending && ctx.versionInfo.graph(entity.entityId).pendingMerge) throw new Error('请先解决或中止当前待处理的分支合并')
          const versions = await readCatalog(entity)
          const selected = versions.find((item) => item.versionId === versionIdValue)
          if (!selected) throw new Error('指定版本不属于此文件或已不存在')
          job.progress(0, '正在检查文件与版本状态')
          if (restoreStatus.pending) {
            if (restoreStatus.versionId !== versionIdValue) throw new Error('另一个版本恢复仍未完成；请先处理该恢复状态')
            if (!restoreStatus.sourceAvailable) throw new Error(restoreStatus.diagnostic || '中断恢复的原文件当前不可访问')
            if (!restoreStatus.sameSourceBytes && !restoreStatus.sourceIsTarget) {
              throw new Error('检测到恢复期间原文件被外部修改。请先确认是否解除恢复阻塞并保留当前文件')
            }
          } else {
            const currentState = await runBridge({
              operation: 'state', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path,
              versionIds: versions.map((item) => item.versionId)
            }) as { status?: string }
            if (currentState.status !== 'saved') throw new Error('文件含有未保存修改；请先保存新版本，再恢复历史版本')
          }
          if (origin === 'ui') await authorizeUiWrite(path)
          if (await sha256File(path) !== expectedSourceSha256) throw new Error('选择恢复版本后文件字节已变化，未覆盖文件')
          const before = await stat(path)
          await runBridge({
            operation: 'restore', root: HISTORY_ROOT, entityId: entity.entityId, sourcePath: path, versionId: versionIdValue,
            expectedSourceSha256
          })
          const after = await stat(path)
          await synchronize(entity, path)
          ctx.db.run('UPDATE files SET size=?,mtime_ms=?,indexed_at=? WHERE path_key=?', after.size, after.mtimeMs, Date.now(), identity(path))
          ctx.ipc.broadcast('fs:changed', { paths: [path], dirs: [dirname(path)], invalidate: false, at: Date.now() })
          ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_restore' : 'versions.restore', allowed: true, planId: job.id, items: 1, results: { previousSize: before.size, restoredSize: after.size } })
          job.finish({ path, versionId: versionIdValue, size: after.size })
        } catch (error) {
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_restore' : 'versions.restore', allowed: false, planId: job.id, error: error instanceof Error ? error.message : String(error) })
          await recordFailure(entity, path, error)
          job.fail(error)
        }
      })
      return { jobId: job.id }
    }

    async function abandonInterruptedRestore(pathValue: unknown, versionIdValue: unknown, confirmed: unknown, origin: 'ui' | 'mcp' = 'ui'): Promise<unknown> {
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('path must be a nonempty string')
      if (typeof versionIdValue !== 'string' || !versionIdValue.trim()) throw new TypeError('versionId must be a nonempty string')
      RESTORE_CONFIRMATION.parse(confirmed)
      const path = normalize(pathValue)
      await requireRegularFile(path)
      const entity = entityByPath(ctx, path)
      if (!entity) throw new Error('该文件尚无 Lore 历史')
      return withEntityLock(locks, entity.entityId, async () => {
        try {
          const restoreStatus = await restoreStatusFor(entity, path)
          if (!restoreStatus.pending) throw new Error('没有待解除的中断恢复')
          if (restoreStatus.versionId !== versionIdValue) throw new Error('中断恢复目标与请求版本不一致')
          if (!restoreStatus.sourceAvailable) throw new Error(restoreStatus.diagnostic || '中断恢复的原文件当前不可访问')
          if (restoreStatus.sameSourceBytes) throw new Error('原文件仍保持恢复前字节；请继续恢复，不要解除阻塞')
          if (restoreStatus.sourceIsTarget) throw new Error('原文件已匹配目标版本；请继续恢复以完成状态清理')
          const expectedSourceSha256 = await sha256File(path)
          beginOperation(entity, 'abandonRestore')
          const result = await runBridge({
            operation: 'abandonRestore', root: HISTORY_ROOT, entityId: entity.entityId,
            sourcePath: path, versionId: versionIdValue, expectedSourceSha256
          })
          await synchronize(entity, path)
          ctx.ipc.broadcast('versions:changed', { path, entityId: entity.entityId, at: Date.now() })
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_restore_abandon' : 'versions.restore.abandon', allowed: true, items: 1, results: { versionId: versionIdValue } })
          return result
        } catch (error) {
          ctx.audit.record({ origin, tool: origin === 'mcp' ? 'versions_restore_abandon' : 'versions.restore.abandon', allowed: false, error: error instanceof Error ? error.message : String(error) })
          await recordFailure(entity, path, error)
          throw error
        }
      })
    }

    ctx.ipc.handle('versions', {
      reconcile,
      list,
      preview,
      state,
      create,
      branchGraph,
      branchAction: (path: unknown, input: unknown, confirm: unknown) => branchAction(path, input, confirm, ctx.commands.executionOrigin ?? 'ui'),
      restore: (path: unknown, versionId: unknown, confirm: unknown) => restore(path, versionId, confirm, ctx.commands.executionOrigin ?? 'ui'),
      abandonInterruptedRestore: (path: unknown, versionId: unknown, confirm: unknown) => abandonInterruptedRestore(path, versionId, confirm, 'ui'),
    }, {
      reconcile: z.tuple([z.string().min(1).max(32768), z.literal(true)]),
      list: z.tuple([z.string().min(1).max(32768)]),
      preview: z.tuple([z.string().min(1).max(32768), z.string().min(1).max(256)]),
      state: z.tuple([z.string().min(1).max(32768)]),
      create: z.tuple([z.string().min(1).max(32768), z.string().max(240)]),
      branchGraph: z.tuple([z.string().min(1).max(32768), z.boolean().optional()]),
      branchAction: z.tuple([z.string().min(1).max(32768), branchActionSchema, z.literal(true)]),
      restore: z.tuple([z.string().min(1).max(32768), z.string().min(1).max(256), z.literal(true)]),
      abandonInterruptedRestore: z.tuple([z.string().min(1).max(32768), z.string().min(1).max(256), z.literal(true)])
    })

    ctx.mcp.registerTool('versions_reconcile', {
      description: 'Explicitly rebuild persisted version metadata from Lore after an interrupted operation or for existing history. UI reads never invoke this tool.',
      inputSchema: { path: z.string().min(1), confirm: z.literal(true) }, mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await reconcile(args.path as string, args.confirm as boolean))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_storage_info', {
      description: 'Inspect persistent version metadata synchronization and the number of Lore process launches. This tool reads SQLite only.',
      inputSchema: { path: z.string().min(1) },
      execute: async (args) => {
        const entity = entityByPath(ctx, normalize(args.path as string))
        const snapshot = entity ? ctx.versionInfo.snapshot(entity.entityId) : null
        return mcpText(JSON.stringify({ storage: 'sqlite', bridgeLaunches, entity,
          synchronizedAt: snapshot?.synchronizedAt ?? null, operation: snapshot?.operation ?? null,
          error: snapshot?.error ?? null, fingerprintCount: Object.keys(snapshot?.fingerprints ?? {}).length }))
      }
    })
    ctx.mcp.registerTool('versions_list', {
      description: 'List Lore versions saved for a file path.',
      inputSchema: { path: z.string().min(1) },
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await list(args.path))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_state', {
      description: 'Read persisted file version state and metadata from SQLite. Never starts Lore or reads source bytes.',
      inputSchema: { path: z.string().min(1) },
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await state(args.path))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_branch_graph', {
      description: 'Read a file branch graph and revision history from SQLite only. Never starts Lore.',
      inputSchema: { path: z.string().min(1), includeArchived: z.boolean().optional() },
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await branchGraph(args.path, args.includeArchived === true))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_create', {
      description: 'Create an immutable Lore snapshot for a file. Requires Full MCP access and explicit confirm=true.',
      inputSchema: { path: z.string().min(1), title: z.string().max(240).default(''), confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await create(args.path, args.title, 'mcp'))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_restore', {
      description: 'Restore one saved Lore version to its original file. Requires Full MCP access and explicit confirm=true.',
      inputSchema: { path: z.string().min(1), versionId: z.string().min(1), confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await restore(args.path, args.versionId, args.confirm, 'mcp'))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_restore_abandon', {
      description: 'Clear an interrupted Lore restore after confirming the source file was externally changed. Preserves current source bytes and Lore content. Requires Full MCP access and explicit confirm=true.',
      inputSchema: { path: z.string().min(1), versionId: z.string().min(1), confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await abandonInterruptedRestore(args.path, args.versionId, args.confirm, 'mcp'))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('versions_branch_action', {
      description: 'Create, switch, archive, merge, resolve, or abort a Lore branch operation. Requires Full MCP access and confirm=true.',
      inputSchema: {
        path: z.string().min(1), confirm: z.literal(true),
        action: z.enum(['create', 'switch', 'archive', 'merge', 'resolve', 'abort']),
        name: z.string().optional(), sourceBranch: z.string().optional(), strategy: z.enum(['ours', 'theirs']).optional(), overwrite: z.boolean().optional()
      },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await branchAction(args.path, args, args.confirm, 'mcp'))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
  }
}

export default plugin
