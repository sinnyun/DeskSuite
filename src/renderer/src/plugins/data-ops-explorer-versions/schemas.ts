import { z } from 'zod'

export const versionEntrySchema = z.object({
  entityId: z.string().min(1).max(512),
  versionId: z.string().min(1).max(512),
  revisionNumber: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  parentRevisionIds: z.array(z.string().min(1).max(512)).max(10_000),
  title: z.string().trim().min(1).max(240),
  createdAt: z.string().min(1).max(128).refine((value) => Number.isFinite(Date.parse(value))),
  sizeBytes: z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER),
  contentType: z.string().max(256).nullable(),
  thumbnailPath: z.string().max(32_768).nullable(),
  isCurrent: z.boolean()
}).strict()
export const versionEntriesSchema = z.array(versionEntrySchema).max(10_000)

export const versionStateSchema = z.object({
  status: z.enum(['unversioned', 'saved', 'matches_saved_version', 'modified', 'interrupted_restore', 'unknown', 'unavailable']),
  currentVersionId: z.string().max(512).nullable(),
  currentTitle: z.string().max(240).nullable().optional(),
  matchingVersionId: z.string().max(512).nullable(),
  matchingTitle: z.string().max(240).nullable().optional(),
  operation: z.string().max(512).nullable().optional(),
  synchronizationError: z.string().max(10_000).nullable().optional(),
  diagnostic: z.string().max(10_000).optional(),
  pendingRestore: z.object({
    pending: z.boolean(),
    sourcePath: z.string().max(32_768).nullable(),
    versionId: z.string().max(512).nullable(),
    sourceAvailable: z.boolean(),
    sameSourceBytes: z.boolean(),
    sourceIsTarget: z.boolean(),
    diagnostic: z.string().max(10_000).optional()
  }).nullable().optional()
})

const branchPointSchema = z.object({ branchId: z.string().min(1).max(512), revisionId: z.string().min(1).max(512) }).strict()
const branchSchema = z.object({
  branchId: z.string().min(1).max(512),
  name: z.string().min(1).max(240),
  category: z.string().max(240),
  headRevisionId: z.string().min(1).max(512).nullable(),
  isCurrent: z.boolean(),
  isArchived: z.boolean(),
  createdAtUnix: z.number().int().nonnegative(),
  stack: z.array(branchPointSchema).max(10_000),
  revisions: z.array(versionEntrySchema).max(10_000)
}).strict()
const pendingMergeSchema = z.object({
  sourceBranch: z.string().min(1).max(512),
  targetBranch: z.string().min(1).max(512),
  conflictFiles: z.array(z.string().max(32_768)).max(10_000),
  targetBaseRevisionId: z.string().min(1).max(512)
}).strict()
export const versionGraphSchema = z.object({
  branches: z.array(branchSchema).max(1_000),
  graphState: z.string().max(100),
  pendingMerge: pendingMergeSchema.nullable()
}).strict()

export const versionPreviewSchema = z.string().max(700_000)
  .regex(/^data:image\/jpeg;base64,[A-Za-z0-9+/]+={0,2}$/)
  .nullable()

export const versionsChangedSchema = z.object({
  path: z.string().min(1).max(32_768),
  entityId: z.string().uuid(),
  kind: z.literal('source').optional(),
  at: z.number().int().nonnegative()
}).strict()

export const versionJobDoneSchema = z.object({
  id: z.string().min(1).max(256),
  state: z.enum(['done', 'failed', 'canceled']),
  error: z.string().optional()
}).transform(({ id, state, error }) => ({ id, state, error: error?.slice(0, 2_048) }))

export type VersionEntryData = z.infer<typeof versionEntrySchema>
export type VersionStateData = z.infer<typeof versionStateSchema>
export type VersionGraphData = z.infer<typeof versionGraphSchema>
export type VersionJobDone = z.infer<typeof versionJobDoneSchema>
