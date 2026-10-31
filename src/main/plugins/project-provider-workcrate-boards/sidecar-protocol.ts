import { z } from 'zod'

export const MAX_PROTOCOL_LINE = 64 * 1024 * 1024
const RpcReplySchema = z.union([
  z.object({ jsonrpc: z.literal('2.0'), id: z.number().int().nonnegative(), result: z.unknown() }).strict().superRefine((reply, ctx) => {
    if (!Object.prototype.hasOwnProperty.call(reply, 'result')) ctx.addIssue({ code: 'custom', path: ['result'], message: '缺少 JSON-RPC result' })
  }),
  z.object({
    jsonrpc: z.literal('2.0'), id: z.number().int().nonnegative(),
    error: z.object({ code: z.number().int(), message: z.string().max(64 * 1024) }).passthrough()
  }).strict(),
  z.object({ jsonrpc: z.literal('2.0'), method: z.string().min(1).max(256), params: z.unknown().optional() }).strict()
])
const SidecarToolResultSchema = z.object({
  isError: z.boolean().optional(),
  content: z.array(z.object({
    type: z.string().min(1).max(32),
    text: z.string().max(MAX_PROTOCOL_LINE).optional()
  }).passthrough()).max(100)
}).passthrough()

export type RpcReply = z.infer<typeof RpcReplySchema>

export function decodeRpcLine(line: string): RpcReply {
  if (Buffer.byteLength(line, 'utf8') > MAX_PROTOCOL_LINE) throw new Error('VectorCraft MCP 回复超过 64 MiB')
  try { return RpcReplySchema.parse(JSON.parse(line) as unknown) } catch {
    throw new Error('VectorCraft MCP 回复不是有效 JSON-RPC 2.0 结构')
  }
}

export function encodeRpcRequest(id: number, method: string, params: unknown): string {
  const payload = `${JSON.stringify({ jsonrpc: '2.0', id, method, params })}\n`
  if (Buffer.byteLength(payload, 'utf8') > MAX_PROTOCOL_LINE) throw new Error('发送至 VectorCraft MCP 的请求超过 64 MiB')
  return payload
}

export function parseTextResult(result: unknown): unknown {
  const parsed = SidecarToolResultSchema.safeParse(result)
  if (!parsed.success) throw new Error('VectorCraft MCP 工具结果结构无效')
  const record = parsed.data
  if (record.isError) {
    const message = record.content.find((part) => part.type === 'text')?.text
    throw new Error(message?.slice(0, 2048) || 'VectorCraft MCP tool failed')
  }
  const text = record.content.find((part) => part.type === 'text')?.text
  if (text === undefined) throw new Error('VectorCraft MCP tool returned no text result')
  try { return JSON.parse(text) as unknown } catch { throw new Error('VectorCraft MCP tool returned invalid JSON') }
}
