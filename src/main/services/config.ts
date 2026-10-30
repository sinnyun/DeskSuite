import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { app } from 'electron'
import type { Context } from 'cordis'
import { Service } from 'cordis'

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

function normalizeWindow(raw: unknown): ConfigData['window'] {
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ConfigData['window']>
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
  const input = (typeof raw === 'object' && raw !== null ? raw : {}) as Partial<ConfigData['mcp']>
  return {
    port:
      typeof input.port === 'number' && Number.isFinite(input.port) && input.port > 0
        ? input.port
        : 9600,
    access: isMcpAccess(input.access) ? input.access : 'read',
    writeRoots: Array.isArray(input.writeRoots)
      ? input.writeRoots.filter((root): root is string => typeof root === 'string')
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

  constructor(ctx: Context) {
    super(ctx, 'config')
  }

  async start(): Promise<void> {
    let loaded: Partial<ConfigData> = {}
    try {
      const raw = await readFile(this.file, 'utf8')
      loaded = JSON.parse(raw) as Partial<ConfigData>
    } catch {
      loaded = {}
    }
    this.data = { ...defaultConfig, ...loaded, window: normalizeWindow(loaded.window), mcp: normalizeMcp(loaded.mcp) }
  }

  get<K extends keyof ConfigData>(key: K): ConfigData[K] {
    return this.data[key]
  }

  async set<K extends keyof ConfigData>(key: K, value: ConfigData[K]): Promise<void> {
    this.data[key] = value
    await writeFile(this.file, JSON.stringify(this.data, null, 2), 'utf8')
  }
}
