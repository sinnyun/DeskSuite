import { app } from 'electron'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpText } from '../../services/mcp'
import { currentTraceId } from '../../services/trace-context'

type LogCategory = 'action' | 'transfer' | 'processing' | 'result' | 'system'

type LogLevel = 'info' | 'warn' | 'error' | 'event' | 'lifecycle'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
  category?: LogCategory
  traceId?: string
  phase?: string
  durationMs?: number
  status?: 'running' | 'ok' | 'error'
}

const MAX_ENTRIES = 3000
const MAX_PAYLOAD_CHARS = 48_000
const SECRET_KEY = /(password|passwd|token|secret|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i

function safePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[深度限制]'
  if (typeof value === 'string') {
    const dataUrl = value.match(/^data:([^;,]+);base64,/)
    if (dataUrl) return `[二进制数据 ${dataUrl[1]}，约 ${Math.floor((value.length - value.indexOf(',') - 1) * 0.75)} 字节]`
    return value.length > 12_000 ? `${value.slice(0, 12_000)}…[字符串已截断，共 ${value.length} 字符]` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => safePayload(item, depth + 1))
    if (value.length > 100) items.push(`[其余 ${value.length - 100} 项已省略]`)
    return items
  }
  const result: Record<string, unknown> = {}
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 200)
  for (const [key, item] of entries) result[key] = SECRET_KEY.test(key) ? '[已脱敏]' : safePayload(item, depth + 1)
  if (Object.keys(value).length > entries.length) result.__truncatedKeys = Object.keys(value).length - entries.length
  return result
}

function boundedPayload(value: unknown): LogEntry['payload'] {
  const safe = safePayload(value)
  try {
    const serialized = JSON.stringify(safe)
    if (serialized.length <= MAX_PAYLOAD_CHARS) return safe as LogEntry['payload']
    return {
      __truncated: true,
      preview: serialized.slice(0, MAX_PAYLOAD_CHARS),
      originalChars: serialized.length,
      hint: '载荷超过 48 KB；已保留预览以控制调试缓冲区占用'
    }
  } catch {
    return String(value)
  }
}

function stamp(): string {
  const now = new Date()
  const pad = (value: number, size = 2): string => String(value).padStart(size, '0')
  return `${pad(now.getHours())}:${pad(now.getMinutes())}:${pad(now.getSeconds())}.${pad(now.getMilliseconds(), 3)}`
}

const runtimeLogPlugin: Plugin = {
  inject: ['ipc', 'mcp', 'config', 'jobs', 'audit'],
  apply(ctx: Context): void {
    let entries: LogEntry[] = []
    let seq = 0

    ctx.mcp.registerTool('get_job_status', {
      description: 'Read background job status, including the actual failure error and summary. Omit jobId to list retained jobs.',
      inputSchema: { jobId: z.string().optional() },
      execute: async (args) => mcpText(JSON.stringify(args.jobId ? ctx.jobs.get(args.jobId as string)?.snapshot() ?? { error: 'Job not found or expired' } : ctx.jobs.list()))
    })
    ctx.mcp.registerTool('get_audit_logs', {
      description: 'Read persistent audit records, including background operation failures.',
      inputSchema: { limit: z.number().int().min(1).max(500).optional() },
      execute: async (args) => mcpText(JSON.stringify(await ctx.audit.tail((args.limit as number | undefined) ?? 100)))
    })

    const push = (
      level: LogLevel,
      source: string,
      message: string,
      payload?: LogEntry['payload'],
      tags?: string[],
      metadata: Pick<LogEntry, 'category' | 'traceId' | 'phase' | 'durationMs' | 'status'> = {}
    ): LogEntry => {
      const entry: LogEntry = {
        id: `main-${Date.now()}-${seq++}`,
        timestamp: stamp(),
        level,
        source,
        message,
        payload: payload === undefined ? undefined : boundedPayload(payload),
        tags,
        ...metadata,
        category: metadata.category ?? (level === 'event' ? 'action' : level === 'error' || level === 'warn' ? 'result' : 'system')
      }
      entries = [entry, ...entries].slice(0, MAX_ENTRIES)
      ctx.ipc.broadcast('runtime:log', entry)
      return entry
    }

    ctx.ipc.handle('runtime', {
      history: () => entries,
      clear: () => {
        entries = []
        return true
      },
      info: () => ({
        appName: app.getName(),
        appVersion: app.getVersion(),
        electron: process.versions.electron ?? '',
        chrome: process.versions.chrome ?? '',
        node: process.versions.node,
        platform: process.platform,
        arch: process.arch,
        mcpPort: ctx.config.get('mcp').port,
        mcpTools: ctx.mcp.listToolInfo(),
        services: ctx.ipc.listServices()
      })
    })

    ctx.mcp.registerTool('get_runtime_logs', {
      description: '获取主进程运行时日志（最新的在前）',
      inputSchema: {
        limit: z.number().int().min(1).max(MAX_ENTRIES).optional()
      },
      execute: async (args) => {
        const limit = (args.limit as number | undefined) ?? 50
        return mcpText(JSON.stringify(entries.slice(0, limit), null, 2))
      }
    })

    ctx.mcp.registerTool('clear_runtime_logs', {
      description: '清空主进程运行时日志缓冲',
      execute: async () => {
        entries = []
        return mcpText('运行时日志已清空')
      }
    })

    ctx.on('mcp/tool-call', (payload) => {
      if (payload.phase === 'start') {
        push('event', 'MCP', `调用工具 ${payload.name}`, { tool: payload.name, args: payload.args }, ['mcp'], {
          category: 'action', traceId: payload.traceId, phase: '请求', status: 'running'
        })
      } else {
        push(
          payload.error ? 'error' : 'info',
          'MCP',
          payload.error
            ? `工具 ${payload.name} 失败：${payload.error}`
            : `工具 ${payload.name} 完成（${payload.ms ?? 0}ms）`,
          { tool: payload.name, ms: payload.ms, error: payload.error, result: payload.result },
          ['mcp'],
          { category: 'result', traceId: payload.traceId, phase: '响应', durationMs: payload.ms, status: payload.error ? 'error' : 'ok' }
        )
      }
    })

    ctx.on('ipc/invoke', (payload) => {
      if (payload.phase === 'start') {
        push('event', 'IPC', `${payload.service}.${payload.method} 请求`, {
          service: payload.service, method: payload.method, args: payload.args
        }, ['ipc', payload.service], {
          category: 'transfer', traceId: payload.requestId, phase: '请求', status: 'running'
        })
      } else {
        push(payload.error ? 'error' : 'info', 'IPC', `${payload.service}.${payload.method} ${payload.error ? '失败' : '返回'}`, {
          service: payload.service, method: payload.method, result: payload.result, error: payload.error
        }, ['ipc', payload.service], {
          category: 'result', traceId: payload.requestId, phase: '响应', durationMs: payload.durationMs, status: payload.error ? 'error' : 'ok'
        })
      }
    })

    ctx.on('ipc/broadcast', ({ channel, payload }) => {
      if (channel === 'runtime:log') return
      const record = payload && typeof payload === 'object' ? payload as Record<string, unknown> : undefined
      // Request-local IDs (for example quickBookmarks' completion ID) identify
      // a sub-operation. Keep the active IPC/MCP trace as the parent so event
      // broadcasts stay grouped with the operation that caused them.
      const traceId = currentTraceId() ?? (typeof record?.requestId === 'string' ? record.requestId : `event-${Date.now()}-${seq}`)
      const jobId = typeof record?.id === 'string' ? record.id : undefined
      const isJobProgress = channel === 'job:progress'
      const isJobDone = channel === 'job:done'
      const isAction = channel === 'commands:action'
      const state = typeof record?.state === 'string' ? record.state : undefined
      const category: LogCategory = isJobProgress ? 'processing' : isJobDone ? 'result' : isAction ? 'action' : 'transfer'
      push('event', 'Event', `广播 ${channel}`, { channel, data: payload }, ['event', channel], {
        category,
        traceId: isJobProgress || isJobDone ? jobId ?? traceId : traceId,
        phase: isJobProgress ? '任务进度' : isJobDone ? '任务完成' : isAction ? '动作' : '广播',
        status: isJobDone && (state === 'failed' || state === 'canceled') ? 'error' : 'ok'
      })
    })

    push('lifecycle', 'Runtime', '主进程服务已就绪', {
      app: app.getName(),
      version: app.getVersion(),
      mcpPort: ctx.config.get('mcp').port
    })
  }
}

export default runtimeLogPlugin
