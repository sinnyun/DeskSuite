import { z } from 'zod'

export const storageEntryInfoSchema = z.object({
  label: z.string().max(1024),
  description: z.string().max(4096).optional(),
  path: z.string().min(1).max(32768),
  kind: z.enum(['file', 'directory']),
  exists: z.boolean(),
  size: z.number().finite().nonnegative(),
  files: z.number().int().nonnegative()
}).passthrough()

export const storageGroupInfoSchema = z.object({
  plugin: z.string().min(1).max(64),
  title: z.string().max(1024),
  entries: z.array(storageEntryInfoSchema).max(10_000),
  size: z.number().finite().nonnegative(),
  files: z.number().int().nonnegative()
}).passthrough()

export const storageSnapshotSchema = z.object({
  userData: z.string().min(1).max(32768),
  groups: z.array(storageGroupInfoSchema).max(1_000),
  size: z.number().finite().nonnegative(),
  files: z.number().int().nonnegative(),
  measuredAt: z.number().finite().nonnegative()
}).passthrough()
