import { app } from 'electron'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpText } from '../../services/mcp'

type LogLevel = 'info' | 'warn' | 'error' | 'event' | 'lifecycle'

interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
}

const MAX_ENTRIES = 500

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
      tags?: string[]
    ): LogEntry => {
      const entry: LogEntry = {
        id: `main-${Date.now()}-${seq++}`,
        timestamp: stamp(),
        level,
        source,
        message,
        payload,
        tags
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
        push('event', 'MCP', `调用工具 ${payload.name}`, { tool: payload.name }, ['mcp'])
      } else {
        push(
          payload.error ? 'error' : 'info',
          'MCP',
          payload.error
            ? `工具 ${payload.name} 失败：${payload.error}`
            : `工具 ${payload.name} 完成（${payload.ms ?? 0}ms）`,
          { tool: payload.name, ms: payload.ms },
          ['mcp']
        )
      }
    })

    push('lifecycle', 'Runtime', '主进程服务已就绪', {
      app: app.getName(),
      version: app.getVersion(),
      mcpPort: ctx.config.get('mcp').port
    })
  }
}

export default runtimeLogPlugin
