import { app, dialog, shell } from 'electron'
import type { Context, Plugin } from 'cordis'
import { randomUUID } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { basename, dirname, extname, join, relative, sep } from 'node:path'
import { z } from 'zod'
import { assertWritable, identity, isInside, normalize, samePath } from '../../services/paths'
import { mcpError, mcpText } from '../../services/mcp'

type Operation = 'copy' | 'move' | 'rename' | 'mkdir' | 'trash' | 'writeText'
type ConflictPolicy = 'skip' | 'overwrite' | 'rename' | 'cancel'
type ItemStatus = 'completed' | 'skipped' | 'conflict' | 'failed' | 'stale'

interface Fingerprint {
  size: number
  mtimeMs: number
  mode: number
  dev: number
  isDirectory: boolean
  isSymbolicLink: boolean
}

interface PlannedItem {
  source?: string
  target: string
  sourceFingerprint?: Fingerprint
  targetFingerprint: Fingerprint | null
  status?: ItemStatus
  message?: string
}

interface FilePlan {
  planId: string
  op: Operation
  sources: string[]
  target?: string
  conflictPolicy: ConflictPolicy
  createdAt: number
  expiresAt: number
  items: PlannedItem[]
  content?: string
  approved: boolean
  rejected: boolean
  origin: 'ui' | 'mcp'
  undoOf?: string
  sameVolumeOnly?: boolean
}

type UndoOperation = 'move' | 'rename' | 'mkdir'
interface UndoRecord {
  undoId: string
  op: UndoOperation
  source?: string
  target: string
  fingerprint: Fingerprint
  createdAt: number
}

interface ItemResult {
  source?: string
  target: string
  status: ItemStatus
  message?: string
}

interface SavedJobResult {
  jobId: string
  planId: string
  op: Operation
  results: ItemResult[]
  savedAt: number
}

interface AnnotationPathRow extends Record<string, string | number | null> {
  path_key: string
  path: string
  favorite: number
  rating: number
  note: string
  updated_at: number
}

interface FileIndexPathRow extends Record<string, string | number | null> {
  path_key: string
  path: string
  parent_key: string | null
  name: string
}

interface FileTagPathRow extends Record<string, string | number | null> {
  path_key: string
  tag_id: number
}

const RESULT_PREFIX = 'file-operations.job-'
const PLAN_TTL_MS = 5 * 60_000
const APPROVAL_TIMEOUT_MS = 60_000
const itemResultSchema = z.object({
  source: z.string().optional(), target: z.string(), status: z.enum(['completed', 'skipped', 'conflict', 'failed', 'stale']), message: z.string().optional()
})
const savedJobSchema = z.object({
  jobId: z.string(), planId: z.string(), op: z.enum(['copy', 'move', 'rename', 'mkdir', 'trash', 'writeText']),
  results: z.array(itemResultSchema), savedAt: z.number()
})

const planInput = z.object({
  op: z.enum(['copy', 'move', 'rename', 'mkdir', 'trash']),
  sources: z.array(z.string()).default([]),
  target: z.string().optional(),
  conflictPolicy: z.enum(['skip', 'overwrite', 'rename', 'cancel']).default('cancel')
})
const MAX_TEXT_WRITE_BYTES = 10 * 1024 * 1024

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function fingerprint(stat: Awaited<ReturnType<typeof fs.lstat>>): Fingerprint {
  return {
    size: Number(stat.size),
    mtimeMs: Number(stat.mtimeMs),
    mode: Number(stat.mode),
    dev: Number(stat.dev),
    isDirectory: stat.isDirectory(),
    isSymbolicLink: stat.isSymbolicLink()
  }
}

async function statFingerprint(path: string): Promise<Fingerprint | null> {
  try {
    return fingerprint(await fs.lstat(path))
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null
    throw error
  }
}

function sameFingerprint(a: Fingerprint | null, b: Fingerprint | null): boolean {
  if (a === null || b === null) return a === b
  return a.size === b.size && a.mtimeMs === b.mtimeMs && a.mode === b.mode && a.dev === b.dev &&
    a.isDirectory === b.isDirectory && a.isSymbolicLink === b.isSymbolicLink
}

function uniqueName(path: string, occupied: Set<string>): string {
  const ext = extname(path)
  const base = ext ? path.slice(0, -ext.length) : path
  let n = 1
  let candidate = `${base} (${n})${ext}`
  while (occupied.has(identity(candidate))) candidate = `${base} (${++n})${ext}`
  occupied.add(identity(candidate))
  return candidate
}

function assertOperationInput(input: z.infer<typeof planInput>): void {
  if (input.op === 'mkdir') {
    if (!input.target) throw new Error('新建目录必须提供目标路径')
    if (input.sources.length) throw new Error('新建目录不接受来源路径')
    return
  }
  if (input.op === 'trash') {
    if (!input.sources.length) throw new Error('回收站操作至少需要一个来源路径')
    if (input.target) throw new Error('回收站操作不接受目标路径')
    return
  }
  if (!input.sources.length) throw new Error('文件操作至少需要一个来源路径')
  if (!input.target) throw new Error('文件操作必须提供目标路径')
  if (input.op === 'rename' && input.sources.length !== 1) throw new Error('重命名只接受一个来源路径')
}

function broadcastChangedDirectories(
  ctx: Context,
  changed: Array<{ source?: string; target: string }>,
  planId: string,
  jobId: string
): void {
  const paths = [...new Set(changed.flatMap(({ source, target }) => [source, target].filter((path): path is string => Boolean(path))))]
  const dirs = [...new Set(paths.map((path) => dirname(path)))]
  ctx.ipc.broadcast('fs:changed', { dirs, paths, invalidate: paths.length > 200, planId, jobId, at: Date.now() })
}

const fileOperationsPlugin: Plugin = {
  name: 'data-ops-file-operations',
  inject: ['ipc', 'mcp', 'window', 'config', 'jobs', 'audit', 'store', 'db', 'commands', 'versionInfo'],
  apply(ctx: Context): void {
    const plans = new Map<string, FilePlan>()
    const undoStack: UndoRecord[] = []
    const approvals = new Map<string, { resolve: (approved: boolean | null) => void; timer: ReturnType<typeof setTimeout> }>()
    const jobByPlan = new Map<string, string>()
    const registeredResultKeys: string[] = []
    const allowedRoots = (): string[] => ctx.config.get('mcp').writeRoots

    const resultsReady = (async () => {
      const directory = join(app.getPath('userData'), 'data', 'jobs')
      let entries: string[]
      try {
        entries = (await fs.readdir(directory)).filter((name) => /^job_[a-zA-Z0-9_-]+\.json$/.test(name))
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === 'ENOENT') return
        throw error
      }
      const dated = await Promise.all(entries.map(async (name) => {
        const file = join(directory, name)
        try {
          const stat = await fs.lstat(file)
          return stat.isFile() && !stat.isSymbolicLink() ? { name, mtimeMs: stat.mtimeMs } : null
        } catch {
          return null
        }
      }))
      const recent = dated.filter((entry): entry is { name: string; mtimeMs: number } => entry !== null)
        .sort((a, b) => b.mtimeMs - a.mtimeMs).slice(0, 50)
      for (const { name } of recent) {
        const jobId = name.slice(0, -'.json'.length)
        registerResultDocument(jobId)
      }
    })()

    function registerResultDocument(jobId: string, fallback?: SavedJobResult): string {
      const key = `${RESULT_PREFIX}${jobId}`
      if (!ctx.store.has(key)) {
        ctx.store.registerDocument(key, `jobs/${jobId}.json`, {
          schema: savedJobSchema,
          default: fallback ?? { jobId, planId: '', op: 'copy', results: [], savedAt: 0 },
          version: 1
        })
        registeredResultKeys.push(key)
      }
      return key
    }

    async function assertMutationPath(path: string): Promise<string> {
      return assertWritable(path, { allowedRoots: allowedRoots(), forbidden: [app.getPath('userData')] })
    }

    function scopedSql(
      table: 'meta' | 'file_tags' | 'files' | 'folders',
      action: 'SELECT *' | 'DELETE',
      descendants: boolean
    ): string {
      return descendants
        ? `${action} FROM ${table} WHERE path_key = ? OR substr(path_key, 1, length(?)) = ?`
        : `${action} FROM ${table} WHERE path_key = ?`
    }

    function rebasePath(path: string, oldRoot: string, newRoot: string): string {
      const normalized = normalize(path)
      const root = normalize(oldRoot)
      const suffix = identity(normalized) === identity(root) ? '' : normalized.slice(root.length)
      return normalize(`${newRoot}${suffix}`)
    }

    function syncCatalogPaths(source: string, target: string, sourceIsDirectory: boolean, replaceTargetDirectory: boolean): void {
      const sourceKey = identity(source)
      const targetKey = identity(target)
      const sourcePrefix = sourceIsDirectory ? `${sourceKey}${sep}` : ''
      const targetIsDirectory = sourceIsDirectory || replaceTargetDirectory
      const targetPrefix = targetIsDirectory ? `${targetKey}${sep}` : ''

      ctx.db.tx((db) => {
        const selectScoped = <T extends Record<string, string | number | null>>(
          table: 'meta' | 'file_tags' | 'files' | 'folders', rootKey: string, prefix: string
        ): T[] => prefix
          ? db.all<T>(scopedSql(table, 'SELECT *', true), rootKey, prefix, prefix)
          : db.all<T>(scopedSql(table, 'SELECT *', false), rootKey)
        const sourceMeta = selectScoped<AnnotationPathRow>('meta', sourceKey, sourcePrefix)
        const sourceTags = selectScoped<FileTagPathRow>('file_tags', sourceKey, sourcePrefix)
        const sourceFiles = selectScoped<FileIndexPathRow>('files', sourceKey, sourcePrefix)
        const sourceFolders = selectScoped<FileIndexPathRow>('folders', sourceKey, sourcePrefix)

        if (targetKey !== sourceKey) {
          for (const table of ['file_tags', 'meta', 'files', 'folders'] as const) {
            if (targetPrefix) db.run(scopedSql(table, 'DELETE', true), targetKey, targetPrefix, targetPrefix)
            else db.run(scopedSql(table, 'DELETE', false), targetKey)
          }
        }

        const movedAt = Date.now()
        for (const row of sourceMeta) {
          const path = rebasePath(row.path, source, target)
          db.run('UPDATE meta SET path_key = ?, path = ?, updated_at = ? WHERE path_key = ?', identity(path), path, movedAt, row.path_key)
        }
        for (const row of sourceTags) {
          const path = rebasePath(row.path_key, source, target)
          db.run('UPDATE file_tags SET path_key = ? WHERE path_key = ?', identity(path), row.path_key)
        }
        const updateIndexRows = (table: 'files' | 'folders', rows: FileIndexPathRow[]) => {
          for (const row of rows) {
            const path = rebasePath(row.path, source, target)
            db.run(
              `UPDATE ${table} SET path_key = ?, path = ?, parent_key = ?, name = ? WHERE path_key = ?`,
              identity(path), path, identity(dirname(path)), basename(path), row.path_key
            )
          }
        }
        updateIndexRows('folders', sourceFolders)
        updateIndexRows('files', sourceFiles)
      })
    }

    async function buildPlan(inputValue: unknown, origin: 'ui' | 'mcp' = 'ui'): Promise<FilePlan> {
      pruneExpiredPlans()
      const input = planInput.parse(inputValue)
      assertOperationInput(input)
      const sources = input.sources.map((path) => normalize(path))
      const target = input.target ? normalize(input.target) : undefined
      const items: PlannedItem[] = []

      if (input.op === 'mkdir') {
        const targetPath = await assertMutationPath(target!)
        const targetFingerprint = await statFingerprint(targetPath)
        items.push({ target: targetPath, targetFingerprint })
      } else {
        for (const source of sources) {
          if (input.op !== 'copy') await assertMutationPath(source)
          const sourceFingerprint = await statFingerprint(source)
          if (!sourceFingerprint) throw new Error(`来源不存在：${source}`)
          if (input.op === 'trash') {
            items.push({ source, target: source, sourceFingerprint, targetFingerprint: sourceFingerprint })
            continue
          }
          const destination = input.op === 'rename'
            ? target!
            : join(target!, basename(source))
          const checkedTarget = await assertMutationPath(destination)
          if (samePath(source, checkedTarget)) throw new Error(`来源与目标相同：${source}`)
          if (sourceFingerprint.isDirectory && (isInside(source, checkedTarget) || isInside(checkedTarget, source))) {
            throw new Error(`不能将目录重命名或移动到自身层级内：${source}`)
          }
          const targetFingerprint = await statFingerprint(checkedTarget)
          items.push({ source, target: checkedTarget, sourceFingerprint, targetFingerprint })
        }
      }

      const plan: FilePlan = {
        planId: `plan_${randomUUID().slice(0, 10)}`,
        op: input.op,
        sources,
        target,
        conflictPolicy: input.conflictPolicy,
        createdAt: Date.now(),
        expiresAt: Date.now() + PLAN_TTL_MS,
        items,
        approved: false,
        rejected: false,
        origin
      }
      plans.set(plan.planId, plan)
      return plan
    }

    async function buildTextWritePlan(pathValue: unknown, contentValue: unknown, optionsValue?: unknown): Promise<FilePlan> {
      if (typeof contentValue !== 'string') throw new TypeError('写入内容必须是文本')
      if (Buffer.byteLength(contentValue, 'utf8') > MAX_TEXT_WRITE_BYTES) throw new Error('文本超过 10MB，已拒绝写入')
      if (typeof pathValue !== 'string' || !pathValue.trim()) throw new TypeError('目标路径不能为空')
      const options = z.object({ noOverwrite: z.boolean().optional() }).parse(optionsValue ?? {})
      const target = await assertMutationPath(normalize(pathValue))
      const targetFingerprint = await statFingerprint(target)
      if (targetFingerprint?.isDirectory) throw new Error('目标路径是文件夹')
      const plan: FilePlan = {
        planId: `plan_${randomUUID().slice(0, 10)}`,
        op: 'writeText',
        sources: [],
        target,
        content: contentValue,
        conflictPolicy: options.noOverwrite ? 'cancel' : 'overwrite',
        createdAt: Date.now(),
        expiresAt: Date.now() + PLAN_TTL_MS,
        items: [{ target, targetFingerprint }],
        approved: false,
        rejected: false,
        origin: 'ui'
      }
      plans.set(plan.planId, plan)
      return plan
    }

    function publicPlan(plan: FilePlan): Omit<FilePlan, 'approved' | 'rejected' | 'origin'> {
      return {
        planId: plan.planId,
        op: plan.op,
        sources: plan.sources,
        target: plan.target,
        conflictPolicy: plan.conflictPolicy,
        createdAt: plan.createdAt,
        expiresAt: plan.expiresAt,
        items: plan.items
      }
    }

    function releaseApproval(planId: string, result: boolean | null): void {
      const pending = approvals.get(planId)
      if (!pending) return
      clearTimeout(pending.timer)
      approvals.delete(planId)
      pending.resolve(result)
    }

    function pruneExpiredPlans(): void {
      const now = Date.now()
      for (const [planId, plan] of plans) {
        if (plan.expiresAt > now) continue
        plans.delete(planId)
        releaseApproval(planId, null)
      }
    }

    function expirePlan(planId: string): void {
      const plan = plans.get(planId)
      if (plan && plan.expiresAt <= Date.now()) {
        plans.delete(planId)
        releaseApproval(planId, null)
      }
    }

    function authorizeUi(planId: string, accepted: boolean): boolean {
      const plan = plans.get(planId)
      if (!plan || plan.expiresAt <= Date.now()) return false
      if (plan.origin === 'mcp') {
        const pending = approvals.get(planId)
        if (!pending) return false
        plan.approved = accepted
        plan.rejected = !accepted
        releaseApproval(planId, accepted)
        ctx.audit.record({ origin: 'mcp', tool: 'fileOps.approval', allowed: accepted, planId, error: accepted ? undefined : 'rejected' })
        if (!accepted) plans.delete(planId)
        return true
      }
      plan.approved = accepted
      plan.rejected = !accepted
      ctx.audit.record({ origin: 'ui', tool: 'fileOps.approval', allowed: accepted, planId, error: accepted ? undefined : 'rejected' })
      if (!accepted) plans.delete(planId)
      return true
    }

    async function planSummary(plan: FilePlan): Promise<Record<string, unknown>> {
      const conflictCount = plan.items.filter((item) => item.targetFingerprint !== null && plan.op !== 'trash').length
      const bytes = plan.op === 'writeText'
        ? Buffer.byteLength(plan.content ?? '', 'utf8')
        : plan.items.reduce((sum, item) => sum + (item.sourceFingerprint?.size ?? 0), 0)
      return { planId: plan.planId, op: plan.op, count: plan.items.length, conflictCount, bytes, target: plan.target, items: plan.items }
    }

    async function prepareMcpApproval(plan: FilePlan): Promise<'approved' | 'rejected' | 'pending'> {
      if (!ctx.window.getMainWindow()) {
        plans.delete(plan.planId)
        ctx.audit.record({ origin: 'mcp', tool: 'fileOps.approval', allowed: false, planId: plan.planId, error: 'headless' })
        return 'rejected'
      }
      const summary = await planSummary(plan)
      const response = await new Promise<boolean | null>((resolve) => {
        const timer = setTimeout(() => {
          approvals.delete(plan.planId)
          plans.delete(plan.planId)
          resolve(null)
        }, APPROVAL_TIMEOUT_MS)
        approvals.set(plan.planId, { resolve, timer })
        ctx.ipc.broadcast('fileOps:approval', summary)
      })
      if (response === null) {
        ctx.audit.record({ origin: 'mcp', tool: 'fileOps.approval', allowed: false, planId: plan.planId, error: 'timeout' })
        return 'pending'
      }
      return response ? 'approved' : 'rejected'
    }

    async function planAndAwaitMcp(input: z.infer<typeof planInput>): Promise<{ plan?: FilePlan; status?: string }> {
      const plan = await buildPlan(input, 'mcp')
      const status = await prepareMcpApproval(plan)
      return status === 'approved' ? { plan } : { status }
    }

    async function execute(planId: string, options: { bypassApproval?: boolean; recordUndo?: boolean; undoOf?: string } = {}): Promise<{ jobId: string }> {
      const plan = plans.get(planId)
      if (!plan) throw new Error(`计划不存在：${planId}`)
      if (plan.expiresAt <= Date.now()) throw new Error('操作计划已过期')
      if (plan.rejected) throw new Error('操作计划已被拒绝')
      if (!options.bypassApproval && !plan.approved) throw new Error('操作计划尚未获用户批准')
      plan.undoOf = options.undoOf

      const job = ctx.jobs.create({ label: `${plan.op} ${plan.items.length} 项`, total: plan.items.length, cancelable: true })
      jobByPlan.set(planId, job.id)
      const results: ItemResult[] = []
      ctx.audit.record({ origin: plan.origin, tool: 'fileOps.execute', planId, items: plan.items.length })
      void (async () => {
        try {
          let cancelConflict = false
          const preflight = new Map<PlannedItem, { stale?: ItemResult; conflict: boolean }>()
          if (plan.conflictPolicy === 'cancel') {
            for (const item of plan.items) {
              const currentSource = item.source ? await statFingerprint(item.source) : null
              const currentTarget = await statFingerprint(item.target)
              let stale: ItemResult | undefined
              if (item.source && !sameFingerprint(item.sourceFingerprint ?? null, currentSource)) {
                stale = { source: item.source, target: item.target, status: 'stale', message: '来源指纹已变化' }
              } else if (!sameFingerprint(item.targetFingerprint, currentTarget)) {
                stale = { source: item.source, target: item.target, status: 'stale', message: '目标指纹已变化' }
              }
              const conflict = plan.op !== 'trash' && plan.op !== 'mkdir' && currentTarget !== null
              preflight.set(item, { stale, conflict })
              if (!stale && conflict) cancelConflict = true
            }
          }
          if (cancelConflict) {
            for (const [index, item] of plan.items.entries()) {
              const checked = preflight.get(item)
              results.push(checked?.stale ?? {
                source: item.source,
                target: item.target,
                status: 'conflict',
                message: checked?.conflict ? '目标已存在，按取消策略停止整个计划' : '批次内存在冲突，按取消策略停止整个计划'
              })
              job.progress(index + 1, item.source ?? item.target)
            }
          } else {
            for (const [index, item] of plan.items.entries()) {
              if (job.signal.aborted) break
              try {
                const currentSource = item.source ? await statFingerprint(item.source) : null
                const currentTarget = await statFingerprint(item.target)
                if (item.source && !sameFingerprint(item.sourceFingerprint ?? null, currentSource)) {
                  results.push({ source: item.source, target: item.target, status: 'stale', message: '来源指纹已变化' })
                } else if (!sameFingerprint(item.targetFingerprint, currentTarget)) {
                  results.push({ source: item.source, target: item.target, status: 'stale', message: '目标指纹已变化' })
                } else if (plan.op === 'mkdir') {
                  if (currentTarget) results.push({ target: item.target, status: 'skipped', message: '目录已存在' })
                  else {
                    await fs.mkdir(item.target, { recursive: true })
                    results.push({ target: item.target, status: 'completed' })
                    if (options.recordUndo !== false) {
                      const after = await statFingerprint(item.target)
                      if (after) pushUndo({ undoId: `undo_${randomUUID().slice(0, 10)}`, op: 'mkdir', target: item.target, fingerprint: after, createdAt: Date.now() })
                    }
                  }
                } else if (plan.op === 'trash') {
                  await shell.trashItem(item.source!)
                  results.push({ source: item.source, target: item.target, status: 'completed' })
                } else if (plan.op === 'writeText') {
                  const tempPath = `${item.target}.desksuite-${job.id}.tmp`
                  const handle = await fs.open(tempPath, 'wx')
                  try {
                    await handle.writeFile(plan.content ?? '', 'utf8')
                    await handle.sync()
                  } finally {
                    await handle.close()
                  }
                  let writeConflict = false
                  try {
                    if (plan.conflictPolicy === 'cancel') {
                      await fs.link(tempPath, item.target)
                      await fs.rm(tempPath, { force: true }).catch(() => undefined)
                    } else {
                      await fs.rename(tempPath, item.target)
                    }
                  } catch (error) {
                    await fs.rm(tempPath, { force: true }).catch(() => undefined)
                    if (plan.conflictPolicy === 'cancel' && (error as NodeJS.ErrnoException).code === 'EEXIST') {
                      writeConflict = true
                    } else {
                      throw error
                    }
                  }
                  results.push(writeConflict
                    ? { target: item.target, status: 'conflict', message: '目标在写入时已存在，未覆盖' }
                    : { target: item.target, status: 'completed' })
                } else {
                  let destination = item.target
                  let targetExists = currentTarget !== null
                  if (targetExists && plan.conflictPolicy === 'skip') {
                    results.push({ source: item.source, target: destination, status: 'skipped', message: '目标已存在' })
                  } else {
                    if (targetExists && plan.conflictPolicy === 'rename') {
                      const occupied = new Set<string>()
                      do {
                        destination = uniqueName(destination, occupied)
                      } while (await statFingerprint(destination))
                    }
                    if (targetExists && plan.conflictPolicy === 'overwrite') await shell.trashItem(destination)
                    if (plan.op === 'copy') {
                      await fs.cp(item.source!, destination, { errorOnExist: true, force: false, recursive: true })
                    } else {
                      try {
                        await fs.rename(item.source!, destination)
                      } catch (error) {
                        if ((error as NodeJS.ErrnoException).code !== 'EXDEV' || plan.sameVolumeOnly) throw error
                        await fs.cp(item.source!, destination, { errorOnExist: true, force: false, recursive: true })
                        await fs.rm(item.source!, { recursive: true, force: false })
                      }
                    }
                    let syncWarning: string | undefined
                    if (plan.op === 'move' || plan.op === 'rename') {
                      try {
                        syncCatalogPaths(item.source!, destination, item.sourceFingerprint?.isDirectory === true,
                          targetExists && plan.conflictPolicy === 'overwrite' && item.targetFingerprint?.isDirectory === true)
                      } catch (error) {
                        syncWarning = `文件已操作，但标注或索引路径迁移失败：${toMessage(error)}`
                      }
                      try {
                        const source = normalize(item.source!)
                        const movedEntities = ctx.db.all<{ path: string }>('SELECT path FROM version_entities')
                          .filter(({ path }) => samePath(path, source) || (item.sourceFingerprint?.isDirectory === true && isInside(source, path)))
                        const versionWarnings: string[] = []
                        for (const entity of movedEntities) {
                          const targetPath = samePath(entity.path, source)
                            ? normalize(destination)
                            : normalize(join(destination, relative(source, entity.path)))
                          try {
                            ctx.versionInfo.rebindPath(entity.path, targetPath)
                          } catch (error) {
                            versionWarnings.push(`${entity.path}: ${toMessage(error)}`)
                          }
                        }
                        if (versionWarnings.length) {
                          const note = `文件已操作，但 ${versionWarnings.length} 条 Lore 历史路径关联未更新`
                          syncWarning = syncWarning ? `${syncWarning}；${note}` : note
                          ctx.audit.record({ origin: plan.origin, tool: 'fileOps.version-rebind', allowed: false, planId, error: versionWarnings.slice(0, 8).join('\n') })
                        }
                      } catch (error) {
                        const note = `文件已操作，但 Lore 历史路径关联查询失败：${toMessage(error)}`
                        syncWarning = syncWarning ? `${syncWarning}；${note}` : note
                        ctx.audit.record({ origin: plan.origin, tool: 'fileOps.version-rebind', allowed: false, planId, error: toMessage(error) })
                      }
                    }
                    results.push({ source: item.source, target: destination, status: 'completed', message: syncWarning })
                    if (options.recordUndo !== false && !(targetExists && plan.conflictPolicy === 'overwrite') &&
                      (plan.op === 'rename' || plan.op === 'move')) {
                      const after = await statFingerprint(destination)
                      const sameVolume = plan.op === 'rename' || (after !== null && item.sourceFingerprint?.dev === after.dev)
                      if (after && sameVolume) {
                        pushUndo({
                          undoId: `undo_${randomUUID().slice(0, 10)}`,
                          op: plan.op,
                          source: item.source,
                          target: destination,
                          fingerprint: after,
                          createdAt: Date.now()
                        })
                      }
                    }
                  }
                }
              } catch (error) {
                results.push({ source: item.source, target: item.target, status: 'failed', message: toMessage(error) })
              }
              job.progress(index + 1, item.source ?? item.target)
            }
          }
          const saved: SavedJobResult = { jobId: job.id, planId, op: plan.op, results, savedAt: Date.now() }
          const resultKey = registerResultDocument(job.id, saved)
          await ctx.store.write(resultKey, saved)
          const summary = { results: results.length, completed: results.filter((r) => r.status === 'completed').length, failed: results.filter((r) => r.status === 'failed').length }
          job.finish(summary)
          ctx.ipc.broadcast('fileOps:done', { planId, jobId: job.id, results })
          const changedPaths = results.filter((result) => result.status === 'completed')
            .map(({ source, target }) => ({ source, target }))
          setTimeout(() => {
            ctx.ipc.broadcast('fileOps:fs-changed', { planId, jobId: job.id, paths: changedPaths, at: Date.now() })
            broadcastChangedDirectories(ctx, changedPaths, planId, job.id)
          }, 200)
          ctx.audit.record({ origin: plan.origin, tool: 'fileOps.execute', planId, results })
          plans.delete(planId)
          jobByPlan.delete(planId)
          if (plan.undoOf && results.some((result) => result.status === 'completed')) {
            const index = undoStack.findIndex((record) => record.undoId === plan.undoOf)
            if (index >= 0) {
              undoStack.splice(index, 1)
              broadcastUndoStack()
            }
          }
        } catch (error) {
          job.fail(error)
          ctx.ipc.broadcast('fileOps:done', {
            planId,
            jobId: job.id,
            results,
            error: toMessage(error)
          })
          const changedPaths = results.filter((result) => result.status === 'completed')
            .map(({ source, target }) => ({ source, target }))
          if (changedPaths.length > 0) {
            setTimeout(() => {
              ctx.ipc.broadcast('fileOps:fs-changed', { planId, jobId: job.id, paths: changedPaths, at: Date.now() })
              broadcastChangedDirectories(ctx, changedPaths, planId, job.id)
            }, 200)
          }
          ctx.audit.record({ origin: plan.origin, tool: 'fileOps.execute', planId, error: toMessage(error) })
          plans.delete(planId)
          jobByPlan.delete(planId)
        }
      })()
      return { jobId: job.id }
    }

    function pushUndo(record: UndoRecord): void {
      undoStack.push(record)
      if (undoStack.length > 20) undoStack.splice(0, undoStack.length - 20)
      broadcastUndoStack()
    }

    function broadcastUndoStack(): void {
      const snapshot = undoStack
        .map(({ undoId, op, source, target, createdAt }) => ({ undoId, op, source, target, createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt)
      ctx.ipc.broadcast('fileOps:undo-stack', snapshot)
    }

    async function undo(undoId?: string): Promise<{ jobId?: string; undoId?: string; status?: 'stale' | 'conflict'; message?: string }> {
      const record = undoId
        ? undoStack.find((entry) => entry.undoId === undoId)
        : undoStack.at(-1)
      if (!record) throw new Error(undoId ? `撤销记录不存在：${undoId}` : '没有可撤销的操作')
      const current = await statFingerprint(record.target)
      if (!sameFingerprint(record.fingerprint, current)) {
        return { undoId: record.undoId, status: 'stale', message: '目标指纹已变化，未执行撤销' }
      }
      if (record.op === 'mkdir') {
        if (!current?.isDirectory) return { undoId: record.undoId, status: 'stale', message: '新建目录已不存在或类型变化' }
        const contents = await fs.readdir(record.target)
        if (contents.length > 0) return { undoId: record.undoId, status: 'conflict', message: '目录已包含内容，不能撤销新建目录' }
      }
      if (record.op === 'move') {
        const originalParent = await fs.stat(dirname(record.source!))
        if (originalParent.dev !== current?.dev) {
          return { undoId: record.undoId, status: 'conflict', message: '原目录已不可用或不在同一卷，不能安全撤销移动' }
        }
      }
      const reverseInput = record.op === 'mkdir'
        ? { op: 'trash', sources: [record.target], conflictPolicy: 'cancel' }
        : record.op === 'rename'
          ? { op: 'rename', sources: [record.target], target: record.source, conflictPolicy: 'cancel' }
          : { op: 'move', sources: [record.target], target: dirname(record.source!), conflictPolicy: 'cancel' }
      const reversePlan = await buildPlan(reverseInput, 'ui')
      if (!sameFingerprint(record.fingerprint, reversePlan.items[0]?.sourceFingerprint ?? null)) {
        return { undoId: record.undoId, status: 'stale', message: '计划期间目标指纹发生变化，未执行撤销' }
      }
      reversePlan.approved = true
      reversePlan.sameVolumeOnly = record.op === 'move'
      const result = await execute(reversePlan.planId, { bypassApproval: true, recordUndo: false, undoOf: record.undoId })
      ctx.audit.record({ origin: 'ui', tool: 'fileOps.undo', planId: reversePlan.planId, items: 1 })
      return { jobId: result.jobId, undoId: record.undoId }
    }

    async function runMcp(input: z.infer<typeof planInput>): Promise<unknown> {
      const { plan, status } = await planAndAwaitMcp(input)
      if (!plan) return { status }
      const result = await execute(plan.planId)
      return { status: 'started', planId: plan.planId, ...result }
    }

    const inputSchema = {
      sources: z.array(z.string()).min(1),
      target: z.string(),
      conflictPolicy: z.enum(['skip', 'overwrite', 'rename', 'cancel']).optional()
    }
    for (const [name, op, impact] of [
      ['file_copy', 'copy', 'low'], ['file_move', 'move', 'low'], ['file_rename', 'rename', 'low'],
      ['file_mkdir', 'mkdir', 'low'], ['file_trash', 'trash', 'high']
    ] as const) {
      const isTrash = op === 'trash'
      const isMkdir = op === 'mkdir'
      ctx.mcp.registerTool(name, {
        description: `按计划与人工批准执行文件${({ copy: '复制', move: '移动', rename: '重命名', mkdir: '新建目录', trash: '移入回收站' } as const)[op]}`,
        mutating: true,
        impact,
        inputSchema: isTrash ? { sources: inputSchema.sources } : isMkdir ? { target: z.string() } : op === 'rename' ? { sources: z.array(z.string()).length(1), target: z.string(), conflictPolicy: inputSchema.conflictPolicy } : inputSchema,
        execute: async (args) => {
          try {
            const parsed = planInput.parse({ ...args, op, sources: isMkdir ? [] : args.sources, target: isTrash ? undefined : args.target })
            const result = await runMcp(parsed)
            return mcpText(JSON.stringify(result))
          } catch (error) {
            return mcpError(toMessage(error))
          }
        }
      })
    }

    ctx.ipc.handle('fileOps', {
      plan: async (input: unknown) => publicPlan(await buildPlan(input)),
      writeText: async (path: unknown, content: unknown, options?: unknown) => publicPlan(await buildTextWritePlan(path, content, options)),
      saveText: async (defaultName: string, content: string, extension = 'txt') => {
        if (typeof defaultName !== 'string' || typeof content !== 'string') throw new TypeError('保存参数无效')
        const win = ctx.window.getMainWindow()
        const options = {
          defaultPath: join(app.getPath('documents'), defaultName),
          filters: [{ name: '文本文件', extensions: [String(extension).replace(/^\./, '')] }]
        }
        const result = win ? await dialog.showSaveDialog(win, options) : await dialog.showSaveDialog(options)
        return result.canceled || !result.filePath ? null : publicPlan(await buildTextWritePlan(result.filePath, content))
      },
      approve: (planId: string) => authorizeUi(planId, true),
      reject: (planId: string) => authorizeUi(planId, false),
      execute: (planId: string) => execute(planId),
      cancel: (planIdOrJobId: string) => {
        const plan = plans.get(planIdOrJobId)
        if (plan) {
          plan.rejected = true
          releaseApproval(planIdOrJobId, false)
          plans.delete(planIdOrJobId)
          if (plan.origin === 'mcp') {
            ctx.audit.record({ origin: 'mcp', tool: 'fileOps.approval', allowed: false, planId: plan.planId, error: 'canceled' })
          }
          const runningJobId = jobByPlan.get(planIdOrJobId)
          return runningJobId ? ctx.jobs.cancel(runningJobId) : true
        }
        return ctx.jobs.cancel(planIdOrJobId)
      },
      get: (planId: string) => {
        expirePlan(planId)
        const plan = plans.get(planId)
        return plan ? publicPlan(plan) : null
      },
      getResults: async () => {
        await resultsReady
        const results = await Promise.all(registeredResultKeys.map((key) => ctx.store.read<SavedJobResult>(key)))
        return results.sort((a, b) => b.savedAt - a.savedAt).slice(0, 50)
      },
      getWriteRoots: () => [...allowedRoots()],
      undo,
      getUndoStack: () => undoStack
        .map(({ undoId, op, source, target, createdAt }) => ({ undoId, op, source, target, createdAt }))
        .sort((a, b) => b.createdAt - a.createdAt),
      startDrag: async (paths: string[]) => {
        if (!Array.isArray(paths) || paths.length === 0) throw new Error('拖出至少需要一个文件')
        const checked = paths.map((path) => normalize(path))
        const win = ctx.window.getMainWindow()
        if (!win) throw new Error('没有可用的应用窗口')
        const icon = await app.getFileIcon(checked[0], { size: 'normal' })
        win.webContents.startDrag({ file: checked[0], files: checked, icon })
        return true
      }
    })

    const commandFields = {
      sources: z.array(z.string()).min(1),
      target: z.string(),
      conflictPolicy: z.enum(['skip', 'overwrite', 'rename', 'cancel']).optional()
    }
    const commandDefinitions = [
      { op: 'copy' as const, schema: z.object(commandFields) },
      { op: 'move' as const, schema: z.object(commandFields) },
      { op: 'rename' as const, schema: z.object({ ...commandFields, sources: z.array(z.string()).length(1) }) },
      { op: 'mkdir' as const, schema: z.object({ target: z.string() }) },
      { op: 'trash' as const, schema: z.object({ sources: z.array(z.string()).min(1) }) }
    ]
    for (const definition of commandDefinitions) {
      const { op, schema } = definition
      ctx.commands.register({
        id: `file.${op}`,
        title: ({ copy: '复制文件', move: '移动文件', rename: '重命名文件', mkdir: '新建目录', trash: '移入回收站' } as const)[op],
        group: '文件操作',
        description: '使用文件操作计划检查路径和冲突，批准后逐项执行',
        mutating: true,
        impact: op === 'trash' ? 'high' : 'low',
        inputSchema: schema,
        plan: async (args, origin) => publicPlan(await buildPlan({ op, ...args, sources: args.sources ?? [] }, origin ?? 'ui')),
        run: async (_args, approvedPlan) => {
          const planId = (approvedPlan as { planId?: string } | undefined)?.planId
          if (!planId) throw new Error('文件命令缺少已批准的计划')
          return execute(planId, { bypassApproval: true })
        }
      })
    }
  }
}

export default fileOperationsPlugin
