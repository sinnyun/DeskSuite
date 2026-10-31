import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { app } from 'electron'
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { StreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/streamableHttp.js'
import type { Context } from 'cordis'
import { Service } from 'cordis'
import type { z } from 'zod'
import { MCP_ACCESS_LEVELS, isMcpAccess, type McpAccess } from './config'
import { withTrace } from './trace-context'

export interface McpToolResult {
  content: Array<
    { type: 'text'; text: string } | { type: 'image'; data: string; mimeType: string }
  >
  isError?: boolean
}

export interface McpToolDef {
  description: string
  inputSchema?: Record<string, z.ZodType>
  // 会改变磁盘/系统状态，需要写权限；只读能力不要标记
  mutating?: boolean
  impact?: 'low' | 'high'
  execute: (args: Record<string, unknown>) => Promise<McpToolResult>
}

export interface McpToolInfo {
  name: string
  mutating: boolean
  impact: 'low' | 'high'
}

export interface McpToolDefinition extends McpToolInfo {
  description: string
  inputSchema?: Record<string, z.ZodType>
}

// 档位只升不降：allowed = 当前档位 >= 工具所需档位
const ACCESS_RANK: Record<McpAccess, number> = { off: 0, read: 1, standard: 2, full: 3 }

export const mcpText = (text: string): McpToolResult => ({ content: [{ type: 'text', text }] })

export const mcpError = (text: string): McpToolResult => ({
  content: [{ type: 'text', text }],
  isError: true
})

declare module 'cordis' {
  interface Context {
    mcp: McpService
  }

  interface Events {
    'mcp/tool-call'(payload: {
      name: string
      phase: 'start' | 'end'
      traceId?: string
      args?: Record<string, unknown>
      result?: McpToolResult
      ms?: number
      error?: string
    }): void
  }
}

export class McpService extends Service {
  private protocolTools = new Map<string, McpToolDef>()

  constructor(ctx: Context) {
    super(ctx, 'mcp')
  }

  registerTool(name: string, def: McpToolDef): void {
    if (this.listTools().includes(name)) {
      throw new Error(`MCP 工具重名：${name}`)
    }
    if (def.impact === 'high' && def.mutating !== true) {
      throw new Error(`MCP 工具 ${name} 标记为高影响，必须同时声明 mutating: true`)
    }
    if (name === 'command_list' || name === 'command_run') this.protocolTools.set(name, def)
    else this.ctx.commands.registerMcpTool(name, def)
  }

  listTools(): string[] {
    return [...this.protocolTools.keys(), ...this.ctx.commands.listMcpTools().map(({ name }) => name)].sort()
  }

  listToolDefinitions(): McpToolDefinition[] {
    return this.allTools()
      .map(([name, def]) => ({
        name,
        description: def.description,
        inputSchema: def.inputSchema,
        mutating: def.mutating === true,
        impact: def.impact ?? 'low'
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  private allTools(): Array<[string, McpToolDef]> {
    return [
      ...this.protocolTools.entries(),
      ...this.ctx.commands.listMcpTools().map(({ name, definition }) => [name, definition] as [string, McpToolDef])
    ]
  }

  private getTool(name: string): McpToolDef | undefined {
    return this.protocolTools.get(name) ?? this.ctx.commands.getMcpTool(name)
  }

  async executeLocalTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> {
    const definition = this.getTool(name)
    if (!definition) throw new Error(`未知 MCP 工具：${name}`)
    const sharedResult = this.ctx.commands.runRegisteredMcpTool(name, args)
    const result = sharedResult ? await sharedResult : await definition.execute(args)
    if (result.isError) {
      const message = result.content.filter((item) => item.type === 'text').map((item) => item.text).join('\n')
      throw new Error(message || `MCP 工具 ${name} 执行失败`)
    }
    return result
  }

  listToolInfo(): McpToolInfo[] {
    return this.allTools()
      .map(([name, def]) => ({
        name,
        mutating: def.mutating === true,
        impact: def.impact ?? 'low'
      }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  async setAccess(access: unknown): Promise<{ access: McpAccess; writeRoots: string[] }> {
    if (!isMcpAccess(access)) {
      throw new Error(
        `非法的 MCP 访问级别：${String(access)}（可选 ${MCP_ACCESS_LEVELS.join(' / ')}）`
      )
    }
    const next = { ...this.ctx.config.get('mcp'), access }
    await this.ctx.config.set('mcp', next)
    return { access: next.access, writeRoots: next.writeRoots }
  }

  async start(): Promise<void> {
    const { port } = this.ctx.config.get('mcp')
    const httpServer = createServer((req, res) => {
      void this.handleRequest(req, res)
    })
    await new Promise<void>((resolve, reject) => {
      httpServer.once('error', reject)
      httpServer.listen(port, '127.0.0.1', () => {
        httpServer.off('error', reject)
        resolve()
      })
    })
    this.ctx.ipc.handle('mcp', {
      tools: () => this.listToolInfo(),
      getAccess: (): McpAccess => this.ctx.config.get('mcp').access,
      setAccess: (access: unknown) => this.setAccess(access)
    })
  }

  // 工具所需的最低访问档位：纯读取=read，低影响写=standard，高影响写=full
  private requiredAccessOf(name: string): McpAccess {
    const def = this.getTool(name)
    if (!def || def.mutating !== true) return 'read'
    return def.impact === 'high' ? 'full' : 'standard'
  }

  private isAllowed(name: string): boolean {
    const { access } = this.ctx.config.get('mcp')
    return ACCESS_RANK[access] >= ACCESS_RANK[this.requiredAccessOf(name)]
  }

  private recordAudit(entry: {
    tool: string
    access: McpAccess
    allowed: boolean
    error?: string
  }): void {
    // audit 服务可能未安装（插件/服务裁剪场景），缺失时不能影响工具调用
    this.ctx.audit?.record({ origin: 'mcp', ...entry })
  }

  private async handleRequest(req: IncomingMessage, res: ServerResponse): Promise<void> {
    if (req.method !== 'POST' || req.url !== '/mcp') {
      res.writeHead(req.method === 'GET' ? 405 : 404).end()
      return
    }

    let parsed: unknown
    try {
      const body = await this.readBody(req)
      parsed = JSON.parse(body)
    } catch {
      res.writeHead(400).end()
      return
    }

    // 无状态模式：每个请求独立构建服务器实例，工具从注册表即时聚合
    const mcpServer = new McpServer({ name: 'desksuite', version: app.getVersion() })
    for (const [name, def] of this.allTools()) {
      const defForSdk = def as {
        description: string
        inputSchema?: Record<string, z.ZodType>
      }
      mcpServer.registerTool(
        name,
        {
          description: defForSdk.description,
          inputSchema: defForSdk.inputSchema as never
        },
        (async (args: Record<string, unknown>) => {
          const startedAt = performance.now()
          const traceId = `mcp-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
          return withTrace(traceId, async () => {
          this.ctx.emit('mcp/tool-call', { name, phase: 'start', traceId, args: args ?? {} })

          const { access } = this.ctx.config.get('mcp')
          if (!this.isAllowed(name)) {
            const requiredAccess = this.requiredAccessOf(name)
            this.recordAudit({ tool: name, access, allowed: false, error: 'forbidden' })
            this.ctx.emit('mcp/tool-call', {
              name,
              phase: 'end',
              traceId,
              ms: Math.round(performance.now() - startedAt),
              error: '权限不足'
            })
            return mcpError(
              JSON.stringify({
                code: 'forbidden',
                tool: name,
                requiredAccess,
                access,
                message: `当前 MCP 访问级别为「${access}」，调用 ${name} 需要「${requiredAccess}」`
              })
            )
          }

          if (def.mutating === true) {
            this.recordAudit({ tool: name, access, allowed: true })
          }

          try {
            const sharedResult = this.ctx.commands?.runRegisteredMcpTool(name, args ?? {})
            const result = sharedResult ? await sharedResult : await def.execute(args ?? {})
            this.ctx.emit('mcp/tool-call', {
              name,
              phase: 'end',
              traceId,
              ms: Math.round(performance.now() - startedAt),
              result,
              error: result.isError ? '工具返回错误' : undefined
            })
            return result
          } catch (err) {
            const message = err instanceof Error ? err.message : String(err)
            this.ctx.emit('mcp/tool-call', {
              name,
              phase: 'end',
              traceId,
              ms: Math.round(performance.now() - startedAt),
              error: message
            })
            return mcpError(message)
          }
          })
        }) as never
      )
    }

    const transport = new StreamableHTTPServerTransport({
      sessionIdGenerator: undefined,
      enableJsonResponse: true
    })
    res.on('close', () => {
      void transport.close()
      void mcpServer.close()
    })
    await mcpServer.connect(transport)
    await transport.handleRequest(req, res, parsed)
  }

  private readBody(req: IncomingMessage): Promise<string> {
    return new Promise((resolve, reject) => {
      const chunks: Buffer[] = []
      req.on('data', (chunk: Buffer) => chunks.push(chunk))
      req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')))
      req.on('error', reject)
    })
  }
}
