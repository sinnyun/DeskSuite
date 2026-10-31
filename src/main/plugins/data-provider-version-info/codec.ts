import { z } from 'zod'

export const VERSION_JSON_LIMITS = {
  parentsBytes: 256 * 1024,
  snapshotBytes: 8 * 1024 * 1024,
  graphBytes: 16 * 1024 * 1024,
  pendingMergeBytes: 2 * 1024 * 1024,
  versionsPerEntity: 50_000,
  versionListTextBytes: 64 * 1024 * 1024,
  graphRevisions: 50_000,
  graphStackPoints: 100_000,
  snapshotStateEntries: 50_000,
  snapshotFingerprintEntries: 50_000
} as const

export const versionRecordSchema = z.object({
  entityId: z.string().min(1).max(512),
  versionId: z.string().min(1).max(512),
  revisionNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  parentRevisionIds: z.array(z.string().min(1).max(512)).max(10_000),
  title: z.string().trim().min(1).max(240).refine((value) => !/[\u0000-\u001f\u007f]/u.test(value)),
  createdAt: z.string().min(1).max(128).refine((value) => Number.isFinite(Date.parse(value))),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contentType: z.string().max(256).nullable(),
  thumbnailPath: z.string().max(32768).nullable(),
  isCurrent: z.boolean()
}).strict()
const branchPointSchema = z.object({ branchId: z.string().min(1).max(512), revisionId: z.string().min(1).max(512) }).strict()
const versionBranchSchema = z.object({
  branchId: z.string().min(1).max(512),
  name: z.string().min(1).max(240),
  category: z.string().max(240),
  headRevisionId: z.string().min(1).max(512).nullable(),
  isCurrent: z.boolean(),
  isArchived: z.boolean(),
  createdAtUnix: z.number().int().nonnegative(),
  stack: z.array(branchPointSchema).max(10_000),
  revisions: z.array(versionRecordSchema).max(10_000)
}).strict()
const pendingMergeSchema = z.object({
  sourceBranch: z.string().min(1).max(512),
  targetBranch: z.string().min(1).max(512),
  conflictFiles: z.array(z.string().max(32768)).max(10_000),
  targetBaseRevisionId: z.string().min(1).max(512)
}).strict()
const versionGraphSchema = z.object({
  branches: z.array(versionBranchSchema).max(1_000),
  graphState: z.string().max(100),
  pendingMerge: pendingMergeSchema.nullable()
}).strict().superRefine((graph, ctx) => {
  const revisions = graph.branches.reduce((sum, branch) => sum + branch.revisions.length, 0)
  const stackPoints = graph.branches.reduce((sum, branch) => sum + branch.stack.length, 0)
  if (revisions > VERSION_JSON_LIMITS.graphRevisions) ctx.addIssue({ code: 'custom', path: ['branches'], message: '分支图版本总数超限' })
  if (stackPoints > VERSION_JSON_LIMITS.graphStackPoints) ctx.addIssue({ code: 'custom', path: ['branches'], message: '分支图堆栈点总数超限' })
})
const versionSnapshotSchema = z.object({
  state: z.record(z.string().max(512), z.unknown()),
  fingerprints: z.record(z.string().max(32768), z.string().max(512)),
  synchronizedAt: z.number().int().nonnegative().nullable(),
  operation: z.string().max(512).nullable(),
  error: z.string().max(10_000).nullable()
}).strict().superRefine((snapshot, ctx) => {
  if (Object.keys(snapshot.state).length > VERSION_JSON_LIMITS.snapshotStateEntries) ctx.addIssue({ code: 'custom', path: ['state'], message: '版本快照状态条目超限' })
  if (Object.keys(snapshot.fingerprints).length > VERSION_JSON_LIMITS.snapshotFingerprintEntries) ctx.addIssue({ code: 'custom', path: ['fingerprints'], message: '版本指纹条目超限' })
})
const parentsSchema = z.array(z.string().min(1).max(512)).max(10_000)

function parseJson<T>(raw: string, label: string, maxBytes: number, schema: z.ZodType<T>): T {
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new Error(`${label}超过 ${maxBytes} 字节限额`)
  let value: unknown
  try { value = JSON.parse(raw) as unknown } catch { throw new Error(`${label}不是有效 JSON`) }
  return schema.parse(value)
}

function serializeJson<T>(value: unknown, label: string, maxBytes: number, schema: z.ZodType<T>): string {
  const parsed = schema.parse(value)
  const raw = JSON.stringify(parsed)
  if (Buffer.byteLength(raw, 'utf8') > maxBytes) throw new Error(`${label}超过 ${maxBytes} 字节限额`)
  return raw
}

export function parseParentsJson(raw: string): string[] {
  return parseJson(raw, '父版本元数据', VERSION_JSON_LIMITS.parentsBytes, parentsSchema)
}

export function serializeParentsJson(value: unknown): string {
  return serializeJson(value, '父版本元数据', VERSION_JSON_LIMITS.parentsBytes, parentsSchema)
}

export function assertVersionListBudget(count: number, textBytes: number, entityId: string): void {
  if (count > VERSION_JSON_LIMITS.versionsPerEntity) {
    throw new Error(`版本实体 ${entityId} 超过 ${VERSION_JSON_LIMITS.versionsPerEntity} 条记录的 list 上限`)
  }
  if (textBytes > VERSION_JSON_LIMITS.versionListTextBytes) {
    throw new Error(`版本实体 ${entityId} 的 list 文本数据超过 64 MiB 总量上限`)
  }
}

export function parseSnapshotJson(raw: string): z.infer<typeof versionSnapshotSchema> {
  return parseJson(raw, '版本读取快照', VERSION_JSON_LIMITS.snapshotBytes, versionSnapshotSchema)
}

export function serializeSnapshot(value: unknown): string {
  return serializeJson(value, '版本读取快照', VERSION_JSON_LIMITS.snapshotBytes, versionSnapshotSchema)
}

export function parseGraphJson(graphState: string, branchesJson: string, pendingMergeJson: string | null): z.infer<typeof versionGraphSchema> {
  if (Buffer.byteLength(branchesJson, 'utf8') > VERSION_JSON_LIMITS.graphBytes) throw new Error('版本分支图超过 16 MiB 限额')
  if (pendingMergeJson !== null && Buffer.byteLength(pendingMergeJson, 'utf8') > VERSION_JSON_LIMITS.pendingMergeBytes) throw new Error('待解决合并数据超过 2 MiB 限额')
  let branches: unknown
  let pendingMerge: unknown = null
  try { branches = JSON.parse(branchesJson) as unknown } catch { throw new Error('版本分支数据不是有效 JSON') }
  if (pendingMergeJson !== null) {
    try { pendingMerge = JSON.parse(pendingMergeJson) as unknown } catch { throw new Error('待解决合并数据不是有效 JSON') }
  }
  return versionGraphSchema.parse({ branches, graphState, pendingMerge })
}

export function serializeGraph(value: unknown): { graphState: string; branchesJson: string; pendingMergeJson: string | null } {
  const graph = versionGraphSchema.parse(value)
  const branchesJson = JSON.stringify(graph.branches)
  const pendingMergeJson = graph.pendingMerge === null ? null : JSON.stringify(graph.pendingMerge)
  if (Buffer.byteLength(branchesJson, 'utf8') > VERSION_JSON_LIMITS.graphBytes) throw new Error('版本分支图超过 16 MiB 限额')
  if (pendingMergeJson !== null && Buffer.byteLength(pendingMergeJson, 'utf8') > VERSION_JSON_LIMITS.pendingMergeBytes) throw new Error('待解决合并数据超过 2 MiB 限额')
  return { graphState: graph.graphState, branchesJson, pendingMergeJson }
}
