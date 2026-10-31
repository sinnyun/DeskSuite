import { z } from 'zod'

const ParameterSchema = z.object({
  title: z.string().max(256).optional(),
  description: z.string().max(2048).optional(),
  type: z.string().max(64).optional(),
  enum: z.array(z.unknown()).max(256).optional(),
  default: z.unknown().optional()
}).passthrough()

const InputSchema = z.object({
  properties: z.record(z.string().max(128), ParameterSchema).optional(),
  required: z.array(z.string().max(128)).max(256).optional()
}).passthrough()

export const CommandItemSchema = z.object({
  id: z.string().min(1).max(256),
  title: z.string().min(1).max(256),
  group: z.string().min(1).max(128),
  description: z.string().max(2048),
  keybinding: z.string().max(128).optional(),
  mutating: z.boolean().optional(),
  impact: z.enum(['low', 'high']).optional(),
  hasParameters: z.boolean(),
  enabled: z.boolean(),
  source: z.enum(['command', 'mcp-tool', 'ipc']).optional(),
  inputSchema: InputSchema.optional()
}).passthrough()

export const CommandListSchema = z.array(CommandItemSchema).max(5000)
export const ApprovalEventSchema = z.object({
  planId: z.string().min(1).max(128),
  command: CommandItemSchema,
  plan: z.unknown(),
  expiresAt: z.number().finite().nonnegative()
}).strict()
export const ActionEventSchema = z.object({ action: z.string().min(1).max(512) }).strict()

export const McpResultSchema = z.object({
  content: z.array(z.object({
    type: z.string().min(1).max(64),
    text: z.string().max(2_000_000).optional(),
    data: z.string().max(32_000_000).optional(),
    mimeType: z.string().max(128).optional()
  }).passthrough()).max(1000),
  isError: z.boolean().optional()
}).passthrough()
export const UiPlanSchema = z.object({ requiresApproval: z.literal(true), planId: z.string().min(1).max(128), command: CommandItemSchema, plan: z.unknown() }).passthrough()

const panels = ['analytics', 'basket', 'clipboard', 'commands', 'debug-console', 'font-audit', 'global-search', 'launcher', 'notes', 'resources', 'settings', 'updater', 'whiteboard', 'workcrate']
const regions = ['left', 'right', 'bottom']
const staticActions = new Set([
  'panel.close', 'floating.toggle', 'layout.zen.toggle', 'layout.reset', 'logs.clear', 'system.reload-renderer',
  'settings.open', 'launcher.open', 'clipboard.open', 'debug-console.open', 'theme.toggle', 'font-audit.toggle'
])

export function isSupportedCommandAction(action: string): boolean {
  if (staticActions.has(action)) return true
  let match = /^(?:panel\.open|panel\.toggle|floating\.toggle):([a-z-]+)$/.exec(action)
  if (match) return panels.includes(match[1])
  match = /^layout\.sidebar\.toggle:(left|right|bottom)$/.exec(action)
  if (match) return regions.includes(match[1])
  match = /^tab\.open:(left|right|bottom):([^:]{1,128})$/.exec(action)
  if (match) return true
  if (/^font-audit\.set:(true|false)$/.test(action)) return true
  match = /^plugin\.set-enabled:([^:]{1,384}):(true|false)$/.exec(action)
  if (match) {
    try { return decodeURIComponent(match[1]).length > 0 && decodeURIComponent(match[1]).length <= 128 } catch { return false }
  }
  return false
}
