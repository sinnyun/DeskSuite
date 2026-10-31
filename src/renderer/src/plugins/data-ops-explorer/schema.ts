import { z } from 'zod'

const IMAGE_DATA_URL_MAX = Math.ceil((12 * 1024 * 1024) / 3) * 4 + 64
const MEDIA_DATA_URL_MAX = Math.ceil((64 * 1024 * 1024) / 3) * 4 + 64
const imageMimeSchema = z.enum(['image/png', 'image/jpeg', 'image/gif', 'image/webp', 'image/bmp', 'image/x-icon', 'image/svg+xml'])
const mediaMimeSchema = z.enum(['video/mp4', 'video/webm', 'video/quicktime', 'video/x-matroska', 'audio/mpeg', 'audio/wav', 'audio/ogg', 'audio/flac', 'audio/mp4', 'audio/aac'])
const base64DataUrl = /^data:[a-z0-9.+/-]+;base64,[A-Za-z0-9+/]*={0,2}$/i

export const fsEntrySchema = z.object({
  name: z.string(), path: z.string(), isDirectory: z.boolean(),
  kind: z.enum(['folder', 'code', 'image', 'document', 'data', 'archive', 'video', 'audio', 'other']),
  size: z.number().finite().nonnegative(), modifiedAt: z.number().finite()
}).passthrough()

export const drivesSchema = z.array(z.object({
  name: z.string(), path: z.string(), total: z.number().finite().nonnegative(),
  free: z.number().finite().nonnegative(), isNetwork: z.boolean()
}).passthrough())

export const quickItemsSchema = z.array(z.object({ id: z.string(), label: z.string(), path: z.string() }).passthrough())
export const directoryResultSchema = z.object({
  path: z.string(), parent: z.string().nullable(), entries: z.array(fsEntrySchema), truncated: z.boolean(),
  nextCursor: z.string().nullable().optional(), stale: z.boolean().optional()
}).passthrough()
export const directoryPageSchema = z.object({
  path: z.string().optional(), entries: z.array(fsEntrySchema), truncated: z.boolean(),
  nextCursor: z.string().nullable(), stale: z.boolean()
}).passthrough()
export const pathsForTagSchema = z.array(z.string())
export const pickedDirectorySchema = z.string().nullable()
export const fsChangedSchema = z.object({
  paths: z.array(z.string().min(1).max(32768)).max(2000),
  dirs: z.array(z.string().min(1).max(32768)).max(2000),
  invalidate: z.boolean(),
  at: z.number().finite().nonnegative().optional(),
  planId: z.string().min(1).max(128).optional(),
  jobId: z.string().min(1).max(128).optional()
}).passthrough()
export const textPreviewSchema = z.object({
  path: z.string().min(1).max(32768),
  content: z.string().max(200_000),
  truncated: z.boolean()
}).strict()
export const imagePreviewSchema = z.object({
  path: z.string().min(1).max(32768),
  dataUrl: z.string().max(IMAGE_DATA_URL_MAX).regex(base64DataUrl)
    .refine((value) => imageMimeSchema.safeParse(value.slice(5, value.indexOf(';'))).success)
}).strict()
export const mediaPreviewSchema = z.object({
  path: z.string().min(1).max(32768),
  mimeType: mediaMimeSchema,
  dataUrl: z.string().max(MEDIA_DATA_URL_MAX).regex(base64DataUrl)
}).strict().refine((value) => value.dataUrl.startsWith(`data:${value.mimeType};base64,`))
