import { z } from 'zod'

export const annotationTagSchema: z.ZodType<{
  id: number
  name: string
  parentId: number | null
  path: string
  color: string | null
  sort: number
  children: AnnotationTag[]
}> = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(128),
  parentId: z.number().int().positive().nullable(),
  path: z.string().min(1).max(4096),
  color: z.string().max(32).nullable(),
  sort: z.number().int().nonnegative(),
  children: z.array(z.lazy(() => annotationTagSchema))
})

interface AnnotationTag {
  id: number
  name: string
  parentId: number | null
  path: string
  color: string | null
  sort: number
  children: AnnotationTag[]
}

export const annotationTagListSchema = z.array(annotationTagSchema)
export const annotationTagRefSchema = z.object({
  id: z.number().int().positive(),
  name: z.string().min(1).max(128),
  parentId: z.number().int().positive().nullable(),
  path: z.string().min(1).max(4096),
  color: z.string().max(32).nullable()
})
export const annotationEntrySchema = z.object({
  path: z.string().min(1).max(32768),
  favorite: z.boolean(),
  rating: z.number().int().min(0).max(5),
  note: z.string().max(20_000),
  tags: z.array(annotationTagRefSchema)
})
export const entriesByPathSchema = z.record(z.string().min(1).max(32768), annotationEntrySchema)
export const annotationPathsSchema = z.array(z.string().min(1).max(32768))
export const tagCountsSchema = z.record(z.string().regex(/^\d+$/), z.number().int().nonnegative())
export const annotationsChangedSchema = z.object({
  kind: z.enum(['tree', 'metadata']),
  paths: annotationPathsSchema.max(1000).optional(),
  at: z.number().finite().nonnegative()
})
export const importLegacyResultSchema = z.object({ imported: z.number().int().nonnegative(), skipped: z.number().int().nonnegative() })
export const changedCountSchema = z.number().int().nonnegative()
export const ratingResultSchema = z.number().int().min(0).max(5)
export const noteResultSchema = z.string().max(20_000)
export const favoriteResultSchema = z.boolean()
