import { z } from 'zod'

export const bookmarkItemSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  path: z.string().min(1).max(32768)
}).passthrough()

export const bookmarkGroupSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(120),
  items: z.array(bookmarkItemSchema).max(1000)
}).passthrough()

export const bookmarkGroupsSchema = z.array(bookmarkGroupSchema).max(100)
