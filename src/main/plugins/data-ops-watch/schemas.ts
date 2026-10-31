import { z } from 'zod'

export const watchedDirectoriesSchema = z.array(z.string().min(1).max(32768)).max(16)

export const watchedFsChangedSchema = z.object({
  paths: z.array(z.string().min(1).max(32768)).max(200),
  dirs: z.array(z.string().min(1).max(32768)).length(1),
  invalidate: z.boolean()
}).strict().refine((event) => event.invalidate ? event.paths.length === 0 : true, {
  message: 'Invalidated watcher batches must omit individual changed paths'
})

export const watchErrorSchema = z.object({ message: z.string() }).strict()
