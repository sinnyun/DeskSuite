import { readFile, stat, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Context } from 'cordis'
import { Service } from 'cordis'
import { z } from 'zod'
import { ConfigPersistencePolicy, type ConfigStartupState } from './config-persistence'

export type McpAccess = 'off' | 'read' | 'standard' | 'full'

export interface ConfigData {
  window: { width: number; height: number; x?: number; y?: number; maximized?: boolean }
  mcp: { port: number; access: McpAccess; writeRoots: string[] }
}

export const MCP_ACCESS_LEVELS: readonly McpAccess[] = ['off', 'read', 'standard', 'full'] as const

export const isMcpAccess = (value: unknown): value is McpAccess =>
  typeof value === 'string' && (MCP_ACCESS_LEVELS as readonly string[]).includes(value)

const defaultConfig: ConfigData = {
  window: { width: 3000, height: 2000 },
  mcp: { port: 9600, access: 'read', writeRoots: [] }
}

const MAX_CONFIG_BYTES = 4 * 1024 * 1024

const windowConfigSchema = z.object({
  width: z.number().int().min(960).max(10_000),
  height: z.number().int().min(620).max(10_000),
  x: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  y: z.number().int().min(-1_000_000).max(1_000_000).optional(),
  maximized: z.boolean().optional()
}).strict()
const mcpConfigSchema = z.object({
  port: z.number().int().min(1).max(65_535),
  access: z.enum(MCP_ACCESS_LEVELS),
  writeRoots: z.array(z.string().min(1).max(32_768)).max(10_000)
}).strict()
const configValueSchemas = { window: windowConfigSchema, mcp: mcpConfigSchema } as const

function normalizeWindow(raw: unknown): ConfigData['window'] {
  const input = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Partial<ConfigData['window']>
  const finite = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value)
  return {
    width: finite(input.width) ? Math.max(960, Math.min(10000, Math.round(input.width))) : defaultConfig.window.width,
    height: finite(input.height) ? Math.max(620, Math.min(10000, Math.round(input.height))) : defaultConfig.window.height,
    ...(finite(input.x) ? { x: Math.round(input.x) } : {}),
    ...(finite(input.y) ? { y: Math.round(input.y) } : {}),
    maximized: input.maximized === true
  }
}

// 旧配置只写了 mcp.port，浅合并会让 access/writeRoots 变成 undefined；这里逐字段兜底，避免脏配置把权限闸门打开
function normalizeMcp(raw: unknown): ConfigData['mcp'] {
  const input = (typeof raw === 'object' && raw !== null && !Array.isArray(raw) ? raw : {}) as Partial<ConfigData['mcp']>
  const port = z.number().int().min(1).max(65_535).safeParse(input.port)
  return {
    port: port.success ? port.data : defaultConfig.mcp.port,
    access: isMcpAccess(input.access) ? input.access : 'read',
    writeRoots: Array.isArray(input.writeRoots)
      ? input.writeRoots.filter((root): root is string => typeof root === 'string' && root.trim().length > 0 && root.length <= 32_768).slice(0, 10_000)
      : []
  }
}

declare module 'cordis' {
  interface Context {
    config: ConfigService
  }
}

export class ConfigService extends Service {
  private data: ConfigData = { ...defaultConfig }
  private file = join(app.getPath('userData'), 'config.json')
  private persistencePolicy = new ConfigPersistencePolicy()

  constructor(ctx: Context) {
    super(ctx, 'config')
  }

  async start(): Promise<void> {
    let loaded: Record<string, unknown> = {}
    try {
      const info = await stat(this.file)
      if (!info.isFile() || info.size > MAX_CONFIG_BYTES) {
        console.warn('[config] 配置文件超过 4 MiB 或不是普通文件，使用默认配置')
        this.persistencePolicy.markRecovered()
        this.data = { ...defaultConfig, window: { ...defaultConfig.window }, mcp: { ...defaultConfig.mcp, writeRoots: [] } }
        return
      }
      const bytes = await readFile(this.file)
      if (bytes.byteLength > MAX_CONFIG_BYTES) {
        console.warn('[config] 配置文件读取后超过 4 MiB，使用默认配置')
        this.persistencePolicy.markRecovered()
        this.data = { ...defaultConfig, window: { ...defaultConfig.window }, mcp: { ...defaultConfig.mcp, writeRoots: [] } }
        return
      }
      const raw = bytes.toString('utf8')
      const candidate: unknown = JSON.parse(raw)
      if (typeof candidate === 'object' && candidate !== null && !Array.isArray(candidate)) {
        loaded = candidate as Record<string, unknown>
        this.persistencePolicy.markLoaded()
      } else {
        console.warn('[config] 配置文件根值无效，使用默认配置')
        this.persistencePolicy.markRecovered()
      }
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === 'ENOENT') this.persistencePolicy.markMissing()
      else {
        console.warn('[config] 配置文件无法解析，使用默认配置')
        this.persistencePolicy.markRecovered()
      }
    }
    this.data = { ...defaultConfig, ...loaded, window: normalizeWindow(loaded.window), mcp: normalizeMcp(loaded.mcp) }
    this.data.window = windowConfigSchema.parse(this.data.window)
    this.data.mcp = mcpConfigSchema.parse(this.data.mcp)
  }

  get<K extends keyof ConfigData>(key: K): ConfigData[K] {
    return this.data[key]
  }

  canPersistWindowState(): boolean {
    return this.persistencePolicy.allowWindowAutoSave()
  }

  getStartupState(): ConfigStartupState {
    return this.persistencePolicy.state()
  }

  async set<K extends keyof ConfigData>(key: K, value: ConfigData[K]): Promise<void> {
    const parsed = configValueSchemas[key].parse(value) as ConfigData[K]
    const next = { ...this.data, [key]: parsed } as ConfigData
    const serialized = JSON.stringify(next, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_CONFIG_BYTES) throw new Error('配置文件超过 4 MiB 限额')
    await writeFile(this.file, serialized, 'utf8')
    this.data = next
    this.persistencePolicy.markExplicitWriteSucceeded()
  }
}
