import { AsyncLocalStorage } from 'node:async_hooks'
import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { Service } from 'cordis'
import { z } from 'zod'
import type { McpToolDef, McpToolResult } from './mcp'
import { mcpError, mcpText } from './mcp'

export interface CommandDefinition {
  id: string
  title: string
  group: string
  description: string
  keybinding?: string
  mutating?: boolean
  impact?: 'low' | 'high'
  source?: 'command' | 'mcp-tool' | 'ipc'
  mcpName?: string
  mcpDefinition?: McpToolDef
  inputSchema?: z.ZodObject<z.ZodRawShape>
  approval?: 'confirm' | 'none'
  plan?: (args: Record<string, unknown>, origin?: 'ui' | 'mcp') => unknown | Promise<unknown>
  run: (args: Record<string, unknown>, approvedPlan?: unknown, origin?: 'ui' | 'mcp') => unknown | Promise<unknown>
}

export interface CommandDescriptor extends Omit<CommandDefinition, 'run' | 'plan' | 'inputSchema'> {
  hasParameters: boolean
  enabled: boolean
  inputSchema?: Record<string, unknown>
}

export interface CommandsService {
  register(command: CommandDefinition): () => void
  registerMcpTool(name: string, definition: McpToolDef): void
  registerIpcMethod(service: string, method: string, run: (...args: unknown[]) => unknown): void
  executeIpcMethod(service: string, method: string, args: unknown[]): Promise<unknown> | undefined
  list(filter?: string): CommandDescriptor[]
  runFromUi(id: string, args: unknown): Promise<unknown>
  executeApproved(planId: string): Promise<unknown>
  handleApproval(planId: string, accepted: boolean): boolean
  runFromMcp(id: string, args: unknown): Promise<McpToolResult>
}

declare module 'cordis' {
  interface Context { commands: CommandsService }
  interface Events { dispose(): void }
}

interface PendingCommand {
  id: string
  args: Record<string, unknown>
  plan: unknown
  createdAt: number
  origin: 'ui' | 'mcp'
  approved?: boolean
  resolve?: (approved: boolean) => void
  timer?: ReturnType<typeof setTimeout>
}

const ID_PATTERN = /^[a-z][a-z0-9]*(?:[._-][a-z0-9]+)*$/
const PLAN_TTL_MS = 5 * 60_000
const MCP_APPROVAL_TIMEOUT_MS = 60_000
const ACCESS_RANK = { off: 0, read: 1, standard: 2, full: 3 } as const

export class CommandsService extends Service {
  private executionContext = new AsyncLocalStorage<'ui' | 'mcp'>()

  get executionOrigin(): 'ui' | 'mcp' | undefined { return this.executionContext.getStore() }

  private registry = new Map<string, CommandDefinition>()
  private pending = new Map<string, PendingCommand>()

  constructor(ctx: Context) {
    super(ctx, 'commands')
    this.registerProtocol()
    this.registerIpcBridge()
    for (const { service, method, handler } of this.ctx.ipc.listMethods()) {
      this.registerIpcMethod(service, method, (...args) => handler.apply(undefined, args))
    }
  }

  register(command: CommandDefinition): () => void {
    if (!ID_PATTERN.test(command.id)) throw new TypeError(`命令 id 格式无效：${command.id}`)
    if (this.registry.has(command.id)) throw new Error(`命令 id 重复：${command.id}`)
    if (command.mutating && command.approval !== 'none' && !command.plan) throw new Error(`mutating 命令必须提供 plan：${command.id}`)
    if (command.impact === 'high' && !command.mutating) throw new Error(`高影响命令必须标记 mutating：${command.id}`)
    const definition = { ...command, source: command.source ?? 'command', impact: command.impact ?? 'low' }
    this.registry.set(command.id, definition)
    return () => {
      if (this.registry.get(command.id) === definition) this.registry.delete(command.id)
    }
  }

  registerMcpTool(name: string, definition: McpToolDef): void {
    const id = `mcp.${toId(name)}`
    if (this.registry.has(id)) throw new Error(`命令 id 重复：${id}`)
    this.register({
      id,
      title: name.replaceAll('_', ' '),
      group: 'MCP 操作',
      description: definition.description,
      source: 'mcp-tool',
      mcpName: name,
      mcpDefinition: definition,
      mutating: definition.mutating === true,
      impact: definition.impact ?? 'low',
      approval: 'none',
      inputSchema: z.object(definition.inputSchema ?? {}),
      run: async (args) => definition.execute(args)
    })
  }

  runRegisteredMcpTool(name: string, args: Record<string, unknown>): Promise<McpToolResult> | undefined {
    const command = this.registry.get(`mcp.${toId(name)}`)
    if (!command) return undefined
    return this.runFromMcp(command.id, args)
  }

  getMcpTool(name: string): McpToolDef | undefined {
    return [...this.registry.values()].find((command) => command.mcpName === name)?.mcpDefinition
  }

  listMcpTools(): Array<{ name: string; definition: McpToolDef }> {
    return [...this.registry.values()]
      .filter((command) => command.mcpName && command.mcpDefinition)
      .map((command) => ({ name: command.mcpName!, definition: command.mcpDefinition! }))
      .sort((a, b) => a.name.localeCompare(b.name))
  }

  registerIpcMethod(service: string, method: string, run: (...args: unknown[]) => unknown): void {
    if (service === 'commands' || /^(approve|reject|complete|execute)$/i.test(method)) return
    const id = `ipc.${toId(service)}.${toId(method)}`
    const existing = this.registry.get(id)
    if (existing && existing.source !== 'ipc') throw new Error(`命令 id 重复：${id}`)
    const readOnly = /^(get|list|read|load|query|search|inspect|status|stat|count|resolve|preview|find|has|version|info|roots|tree|history|state|options|drives|metadata|children|summary|formats|exists|lookup|quick|groups|active|effective|icon|for|paths|branch|catalog)(?:_|$)/i.test(toId(method))
    const command: CommandDefinition = {
      id,
      title: `${service} · ${humanize(method)}`,
      group: `界面服务 · ${service}`,
      description: `调用工作台服务 ${service}.${method}；参数按原界面 IPC 位置顺序放入 args 数组。`,
      source: 'ipc',
      mutating: !readOnly,
      impact: readOnly ? 'low' : 'high',
      inputSchema: z.object({ args: z.array(z.unknown()).max(128).optional() }),
      plan: (args) => ({ source: 'MCP 命令', operation: `${service}.${method}`, args }),
      run: async (args) => run(...(Array.isArray(args.args) ? args.args : []))
    }
    if (existing) this.registry.set(id, { ...command, source: 'ipc' })
    else this.register(command)
  }

  executeIpcMethod(service: string, method: string, args: unknown[]): Promise<unknown> | undefined {
    const command = this.registry.get(`ipc.${toId(service)}.${toId(method)}`)
    if (!command) return undefined
    return this.runDefinition(command, { args }, undefined, 'ui')
  }

  list(filter?: string): CommandDescriptor[] {
    const query = filter?.trim().toLocaleLowerCase()
    return [...this.registry.values()]
      .filter((command) => !query || `${command.id} ${command.title} ${command.group} ${command.description}`.toLocaleLowerCase().includes(query))
      .map(descriptor)
      .sort((a, b) => a.group.localeCompare(b.group) || a.title.localeCompare(b.title) || a.id.localeCompare(b.id))
  }

  async runFromUi(id: string, rawArgs: unknown): Promise<unknown> {
    const command = this.getCommand(id)
    const args = parseArgs(command, rawArgs)
    if (command.mutating) {
      const plan = command.plan ? await command.plan(args, 'ui') : { operation: command.id, args }
      const planId = `command_${randomUUID().slice(0, 12)}`
      this.pending.set(planId, { id, args, plan, createdAt: Date.now(), origin: 'ui' })
      return { requiresApproval: true, planId, command: descriptor(command), plan }
    }
    return this.runDefinition(command, args, undefined, 'ui')
  }

  async executeApproved(planId: string): Promise<unknown> {
    this.cleanExpired()
    const request = this.pending.get(planId)
    if (!request || request.origin !== 'ui') throw new Error('命令计划不存在或已过期')
    if (!request.approved) throw new Error('命令尚未获得人工批准')
    this.pending.delete(planId)
    const command = this.getCommand(request.id)
    const result = await this.runDefinition(command, request.args, request.plan, 'ui')
    this.ctx.audit.record({ origin: 'command', tool: command.id, allowed: true, planId })
    return result
  }

  handleApproval(planId: string, accepted: boolean): boolean {
    const request = this.pending.get(planId)
    if (!request) return false
    if (request.origin === 'mcp') {
      if (request.timer) clearTimeout(request.timer)
      request.resolve?.(accepted)
      if (!accepted) this.pending.delete(planId)
      return true
    }
    if (!accepted) this.pending.delete(planId)
    else request.approved = true
    return true
  }

  async runFromMcp(id: string, rawArgs: unknown): Promise<McpToolResult> {
    const command = this.getCommand(id)
    const access = this.ctx.config.get('mcp').access
    const required = command.mutating ? (command.impact === 'high' ? 'full' : 'standard') : 'read'
    if (ACCESS_RANK[access] < ACCESS_RANK[required]) {
      this.ctx.audit.record({ origin: 'mcp', tool: `command.${id}`, access, allowed: false, error: 'forbidden' })
      return mcpError(JSON.stringify({ code: 'forbidden', tool: id, requiredAccess: required, access, message: `当前 MCP 访问级别为「${access}」，调用 ${id} 需要「${required}」` }))
    }
    const args = parseArgs(command, rawArgs)
    if (command.mutating && command.approval === 'confirm') {
      const plan = command.plan ? await command.plan(args, 'mcp') : { operation: command.id, args }
      const planId = `command_${randomUUID().slice(0, 12)}`
      const decision = await new Promise<boolean>((resolve) => {
        const request: PendingCommand = {
          id, args, plan, createdAt: Date.now(), origin: 'mcp', resolve,
          timer: setTimeout(() => { this.pending.delete(planId); resolve(false) }, MCP_APPROVAL_TIMEOUT_MS)
        }
        this.pending.set(planId, request)
        this.ctx.ipc.broadcast('commands:approval', { planId, command: descriptor(command), plan, expiresAt: Date.now() + MCP_APPROVAL_TIMEOUT_MS })
      })
      const request = this.pending.get(planId)
      if (request?.timer) clearTimeout(request.timer)
      this.pending.delete(planId)
      if (!decision) {
        this.ctx.audit.record({ origin: 'mcp', tool: `command.${id}`, access, allowed: false, planId, error: 'approval pending, rejected, or timed out' })
        return mcpText(JSON.stringify({ status: 'pending', reason: '等待人工批准超时或请求被拒绝' }))
      }
      const result = await this.runDefinition(command, args, plan, 'mcp')
      this.ctx.audit.record({ origin: 'mcp', tool: `command.${id}`, access, allowed: true, planId })
      return asMcpResult(result)
    }
    if (command.mutating) this.ctx.audit.record({ origin: 'mcp', tool: `command.${id}`, access, allowed: true })
    return asMcpResult(await this.runDefinition(command, args, undefined, 'mcp'))
  }

  private registerProtocol(): void {
    this.ctx.mcp.registerTool('command_list', {
      description: '列出 DeskSuite 界面和业务共用的操作命令；可按名称、分组或说明过滤。',
      inputSchema: { filter: z.string().optional() },
      execute: async ({ filter }) => mcpText(JSON.stringify(this.list(typeof filter === 'string' ? filter : undefined), null, 2))
    })
    this.ctx.mcp.registerTool('command_run', {
      description: '执行命令目录中的操作；使用 command_list 查询命令 id 和参数定义。',
      inputSchema: {
        id: z.string(),
        params: z.record(z.string(), z.unknown()).optional(),
        arguments: z.record(z.string(), z.unknown()).optional()
      },
      execute: async ({ id, params, arguments: legacyArgs }) => this.runFromMcp(String(id), params ?? legacyArgs ?? {})
    })
  }

  private registerIpcBridge(): void {
    this.ctx.ipc.handle('commands', {
      list: (filter?: string) => this.list(filter),
      run: (id: string, args: unknown) => this.runFromUi(id, args),
      approve: (planId: string, accepted = true) => this.handleApproval(planId, accepted),
      execute: (planId: string) => this.executeApproved(planId)
    })
  }

  private async runDefinition(command: CommandDefinition, args: Record<string, unknown>, plan: unknown, origin: 'ui' | 'mcp'): Promise<unknown> {
    return this.executionContext.run(origin, () => command.run(args, plan, origin))
  }

  private getCommand(id: string): CommandDefinition {
    const command = this.registry.get(id)
    if (!command) throw new Error(`未知命令：${id}`)
    return command
  }

  private cleanExpired(): void {
    const cutoff = Date.now() - PLAN_TTL_MS
    for (const [planId, request] of this.pending) {
      if (request.createdAt >= cutoff) continue
      if (request.timer) clearTimeout(request.timer)
      request.resolve?.(false)
      this.pending.delete(planId)
    }
  }
}

function parseArgs(command: CommandDefinition, rawArgs: unknown): Record<string, unknown> {
  return command.inputSchema?.parse(rawArgs ?? {}) as Record<string, unknown> | undefined ?? {}
}

function descriptor(command: CommandDefinition): CommandDescriptor {
  return {
    id: command.id,
    title: command.title,
    group: command.group,
    description: command.description,
    keybinding: command.keybinding,
    mutating: command.mutating,
    impact: command.impact,
    source: command.source ?? 'command',
    hasParameters: Boolean(command.inputSchema && Object.keys(command.inputSchema.shape).length),
    enabled: true,
    inputSchema: command.inputSchema ? z.toJSONSchema(command.inputSchema) as Record<string, unknown> : undefined
  }
}

function asMcpResult(result: unknown): McpToolResult {
  if (typeof result === 'object' && result !== null && 'content' in result && Array.isArray(result.content)) return result as McpToolResult
  try { return mcpText(JSON.stringify(result ?? null)) }
  catch { return mcpText(String(result)) }
}

function toId(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1.$2').replace(/[^a-zA-Z0-9]+/g, '.').replace(/^\.+|\.+$/g, '').toLowerCase()
}

function humanize(value: string): string {
  return value.replace(/([a-z0-9])([A-Z])/g, '$1 $2').replaceAll('_', ' ')
}
