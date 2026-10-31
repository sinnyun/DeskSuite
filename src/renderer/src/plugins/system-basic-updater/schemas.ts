import { z } from 'zod'

export const updateStateSchema = z.object({
  status: z.enum(['idle', 'checking', 'available', 'unavailable', 'downloading', 'downloaded', 'error']),
  currentVersion: z.string().min(1).max(128),
  availableVersion: z.string().max(128).optional(),
  percent: z.number().finite().min(0).max(100).optional(),
  message: z.string().max(4096).optional(),
  feedUrl: z.string().max(2048),
  packaged: z.boolean()
}).strict()

export const updateOperationResultSchema = z.union([updateStateSchema, z.literal(true)])
export type UpdateState = z.infer<typeof updateStateSchema>
