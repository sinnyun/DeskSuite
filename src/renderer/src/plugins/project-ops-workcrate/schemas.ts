import { z } from 'zod'

const previewRecordSchema = z.object({
  path: z.string().min(1).max(32768),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive().max(1_000_000),
  height: z.number().int().positive().max(1_000_000)
}).strict()

export const workCrateProjectSchema = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  createdAt: z.number().int().nonnegative(),
  archived: z.boolean(),
  mainImage: previewRecordSchema.nullable(),
  order: z.number().int().nonnegative().optional()
}).strict()

export const workCrateReferenceSchema = z.object({
  id: z.string().uuid(),
  path: z.string().min(1).max(32768),
  displayTitle: z.string().min(1).max(240),
  order: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative().nullable(),
  customPreview: previewRecordSchema.nullable(),
  available: z.boolean().optional()
}).strict()

export const fieldPresetSchema = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  values: z.array(z.string().trim().min(1).max(240)).max(200)
}).strict()

export const fieldPresetsSchema = z.object({ fields: z.array(fieldPresetSchema).max(100) }).strict()

export const workCrateProjectListSchema = z.array(workCrateProjectSchema).max(1000)

export const projectSnapshotSchema = z.object({
  project: workCrateProjectSchema,
  references: z.array(workCrateReferenceSchema).max(5000),
  fieldPresets: fieldPresetsSchema,
  documentPath: z.string().min(1).max(32768).nullable(),
  documentBinding: z.string().uuid()
}).strict()

export const boardInfoSchema = z.object({
  materialCategory: z.string().max(1024),
  material: z.string().max(1024),
  size: z.string().max(1024),
  sizeLabel: z.string().max(1024),
  quantity: z.string().max(1024),
  extra: z.record(z.string().max(256), z.string().max(1024))
}).strict()

export const workCrateBoardSchema = z.object({
  id: z.string().min(1).max(512),
  projectId: z.string().uuid(),
  binding: z.string().uuid(),
  nativeId: z.string().regex(/^\d{1,20}$/),
  index: z.number().int().nonnegative().max(9999),
  title: z.string().min(1).max(512),
  widthPt: z.number().finite().positive().max(1_000_000),
  heightPt: z.number().finite().positive().max(1_000_000),
  info: boardInfoSchema
}).strict()

export const boardCatalogSchema = z.array(workCrateBoardSchema).max(10_000)

// VectorCraft previews are PNG bytes encoded as a base64 data URL. The main
// process caps source images at 32 MiB; this bound allows the base64 expansion.
export const boardPreviewSchema = z.string().max(45_000_000).regex(/^data:image\/png;base64,[A-Za-z0-9+/=]+$/)

export const vectorCraftConfigSchema = z.object({
  cliExecutable: z.string().max(2048),
  guiExecutable: z.string().max(2048),
  defaultImageFormat: z.enum(['png', 'jpg']),
  port: z.number().int().min(1).max(65535)
}).strict()

export const quickTableSchema = z.object({
  columns: z.array(z.string().max(80)).min(1).max(30),
  rows: z.array(z.array(z.string().max(1024)).max(30)).max(200)
}).strict().superRefine((table, ctx) => {
  if (table.rows.some((row) => row.length !== table.columns.length)) {
    ctx.addIssue({ code: 'custom', path: ['rows'], message: '快速创建表格列数不一致' })
  }
})

export const quickCreateResultSchema = z.object({
  count: z.number().int().min(1).max(200),
  reusedInitial: z.boolean(),
  boards: boardCatalogSchema
}).strict()

export const createDocumentResultSchema = z.object({
  path: z.string().min(1).max(32768),
  boards: boardCatalogSchema
}).strict()

export const exportResultSchema = z.object({
  directory: z.string().min(1).max(32768),
  files: z.array(z.string().min(1).max(32768)).max(10_000),
  warnings: z.array(z.string().max(4096)).max(10_000)
}).strict()

export const documentPathSchema = z.string().min(1).max(32768).nullable()
export const pickedDirectorySchema = z.string().min(1).max(32768).nullable()
export const openFolderResultSchema = z.object({ path: z.string().min(1).max(32768) }).strict()

export const panelOpenEventSchema = z.object({
  projectId: z.string().uuid().optional(),
  boardId: z.string().min(1).max(512).optional(),
  section: z.enum(['connection', 'basic']).optional(),
  quickCreate: z.boolean().optional(),
  table: quickTableSchema.nullable().optional(),
  at: z.number().finite().nonnegative().optional()
}).strict()

export const boardsChangedEventSchema = z.object({
  projectId: z.string().uuid(),
  copiedFrom: z.string().uuid().optional(),
  at: z.number().int().nonnegative()
}).strict()

export const syncErrorEventSchema = z.object({
  projectId: z.string().uuid(),
  message: z.string().min(1).max(4096)
}).strict()

export const syncRecoveredEventSchema = z.object({ projectId: z.string().uuid() }).strict()

export const projectsChangedEventSchema = z.object({
  projectId: z.string().uuid().nullable(),
  revision: z.number().int().positive(),
  at: z.number().int().nonnegative()
}).strict()

export type WorkCrateProject = z.infer<typeof workCrateProjectSchema>
export type WorkCrateBoard = z.infer<typeof workCrateBoardSchema>
export type ProjectSnapshot = z.infer<typeof projectSnapshotSchema>
export type VectorCraftConfig = z.infer<typeof vectorCraftConfigSchema>
export type QuickTable = z.infer<typeof quickTableSchema>
export type FieldPresets = z.infer<typeof fieldPresetsSchema>
export type BoardInfo = z.infer<typeof boardInfoSchema>
