import { z } from 'zod'

export const basketItemSchema = z.object({
  path: z.string().min(1).max(32768),
  name: z.string().max(1024),
  isDirectory: z.boolean(),
  kind: z.string().max(64),
  size: z.number().finite().nonnegative(),
  modifiedAt: z.number().finite().nonnegative(),
  addedAt: z.number().finite().nonnegative()
}).strict()

export const basketItemsSchema = z.array(basketItemSchema).max(200)
