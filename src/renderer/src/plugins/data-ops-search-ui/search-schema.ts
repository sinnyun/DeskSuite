import { z } from 'zod'

export const searchItemSchema = z.object({
  path: z.string().min(1).max(32768),
  name: z.string().max(32768),
  kind: z.string().min(1).max(32),
  size: z.number().finite().nonnegative(),
  mtime_ms: z.number().finite().nonnegative(),
  favorite: z.union([z.literal(0), z.literal(1), z.null()]),
  rating: z.union([z.number().int().min(1).max(5), z.null()])
}).passthrough()

export const searchResultSchema = z.object({
  items: z.array(searchItemSchema).max(200),
  total: z.number().int().nonnegative(),
  limit: z.number().int().min(1).max(200),
  offset: z.number().int().min(0).max(10_000_000)
}).passthrough().refine((result) => result.items.length <= result.limit, '条目数不能超过分页上限')

export type SearchResult = z.infer<typeof searchResultSchema>
