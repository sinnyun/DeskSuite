import { z } from 'zod'

export const LauncherGroupSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(32),
  createdAt: z.number().finite().nonnegative()
}).strict()

export const LauncherEntrySchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().min(1).max(512),
  title: z.string().max(100).optional(),
  path: z.string().min(1).max(32768),
  kind: z.enum(['shortcut', 'application']),
  target: z.string().max(32768).optional(),
  description: z.string().max(500).optional(),
  publisher: z.string().max(512).optional(),
  version: z.string().max(128).optional(),
  groupId: z.string().min(1).max(128).optional()
}).strict()

export const LauncherEntriesSchema = z.array(LauncherEntrySchema).max(250)
export const LauncherGroupsSchema = z.array(LauncherGroupSchema).max(100)
export const LauncherSummarySchema = z.object({
  total: z.number().int().nonnegative().max(5000),
  applications: z.number().int().nonnegative().max(5000),
  shortcuts: z.number().int().nonnegative().max(5000),
  groupCounts: z.record(z.string().max(128), z.number().int().nonnegative().max(5000))
}).strict()
export const LauncherIconSchema = z.string().max(8_000_000).regex(/^data:image\/[a-zA-Z0-9.+-]+(?:;[^,]*)?,/).nullable()
