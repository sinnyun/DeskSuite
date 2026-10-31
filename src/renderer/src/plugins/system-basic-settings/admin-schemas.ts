import { z } from 'zod'

export const mcpAccessSchema = z.enum(['off', 'read', 'standard', 'full'])

export const mcpToolInfoSchema = z.object({
  name: z.string().min(1).max(256),
  mutating: z.boolean(),
  impact: z.enum(['low', 'high'])
}).passthrough()

export const runtimeInfoSchema = z.object({
  appName: z.string().max(256),
  appVersion: z.string().max(128),
  electron: z.string().max(128),
  chrome: z.string().max(128),
  node: z.string().max(128),
  platform: z.string().max(64),
  arch: z.string().max(64),
  mcpPort: z.number().int().min(1).max(65535),
  mcpTools: z.array(mcpToolInfoSchema).max(5_000),
  services: z.array(z.string().min(1).max(128)).max(5_000)
}).passthrough()
