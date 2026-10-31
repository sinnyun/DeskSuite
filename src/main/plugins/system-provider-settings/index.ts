import type { Context, Plugin } from 'cordis'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
import { errorMessage } from '../../services/error-text'
import { mcpText } from '../../services/mcp'
import { normalize } from '../../services/paths'

export interface SettingsDescriptor {
  namespace: string
  title: string
  description?: string
  schema: Record<string, unknown>
  value: Record<string, unknown>
}

export interface SettingsSchemaDescriptor extends Omit<SettingsDescriptor, 'value'> {}

export interface SettingsMetadata { title?: string; description?: string; category?: 'program' | 'plugin'; group?: string }

export interface SettingsService {
  register(namespace: string, schema: z.ZodType, defaultValue: Record<string, unknown>, metadata?: SettingsMetadata): void
  listSchemas(): SettingsSchemaDescriptor[]
  list(): Promise<SettingsDescriptor[]>
  get(namespace: string): Promise<Record<string, unknown>>
  validate(namespace: string, value: unknown): { success: true; value: Record<string, unknown> } | { success: false; errors: Array<{ path: Array<string | number>; code: string; message: string }> }
  set(namespace: string, value: unknown): Promise<Record<string, unknown>>
  subscribe(listener: (namespace: string, value: Record<string, unknown>) => void): () => void
}

declare module 'cordis' {
  interface Context {
    settings: SettingsService
  }
}

interface SettingsDocument {
  plugins: Record<string, Record<string, unknown>>
}

const documentSchema = z.object({ plugins: z.record(z.string(), z.record(z.string(), z.unknown())) })
const namespacePattern = /^[a-z0-9][a-z0-9._-]{0,63}$/

const settingsPlugin: Plugin = {
  name: 'system-provider-settings',
  inject: ['ipc', 'store', 'config', 'storage', 'mcp'],
  apply(ctx: Context): void {
    ctx.store.register('settings', { schema: documentSchema, default: { plugins: {} }, version: 1 })
    ctx.storage.register('system-provider-settings', {
      title: '程序与插件设置',
      entries: [{ label: '设置数据', storeKey: 'settings', description: '所有非 MCP 设置命名空间的持久化值' }]
    })
    const schemas = new Map<string, { schema: z.ZodType; defaultValue: Record<string, unknown>; title: string; description?: string; category: 'program' | 'plugin'; group?: string }>()
    const listeners = new Set<(namespace: string, value: Record<string, unknown>) => void>()

    function readValue(namespace: string, rawValue: unknown): Record<string, unknown> {
      const entry = schemas.get(namespace)
      if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
      const parsed = entry.schema.safeParse(rawValue)
      if (!parsed.success || typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
        const issues = parsed.success ? '设置值必须是对象' : parsed.error.issues.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')
        console.error(`[settings] persisted value rejected for ${namespace}: ${issues}`)
        return entry.defaultValue
      }
      return parsed.data as Record<string, unknown>
    }

    function validateValue(namespace: string, rawValue: unknown): ReturnType<SettingsService['validate']> {
      const entry = schemas.get(namespace)
      if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
      const parsed = entry.schema.safeParse(rawValue)
      if (!parsed.success) return {
        success: false,
        errors: parsed.error.issues.map((issue) => ({
          path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'),
          code: issue.code,
          message: issue.code === 'invalid_type' ? '数据类型不正确' : issue.code === 'invalid_value' ? '请选择允许的值' : issue.code.startsWith('too_') ? '长度或数值超出允许范围' : '设置值不符合要求'
        }))
      }
      if (typeof parsed.data !== 'object' || parsed.data === null || Array.isArray(parsed.data)) {
        return { success: false, errors: [{ path: [], code: 'invalid_type', message: '设置值必须是对象' }] }
      }
      return { success: true, value: parsed.data as Record<string, unknown> }
    }

    const api: SettingsService = {
      register(namespace, schema, defaultValue, metadata = {}) {
        if (!namespacePattern.test(namespace)) throw new TypeError(`非法设置命名空间：${namespace}`)
        if (schemas.has(namespace)) throw new Error(`设置命名空间重复：${namespace}`)
        const parsedDefault = schema.parse(defaultValue)
        if (typeof parsedDefault !== 'object' || parsedDefault === null || Array.isArray(parsedDefault)) {
          throw new TypeError(`设置默认值必须是对象：${namespace}`)
        }
        schemas.set(namespace, { schema, defaultValue: parsedDefault as Record<string, unknown>, title: metadata.title ?? namespace, description: metadata.description, category: metadata.category ?? 'plugin', group: metadata.group })
      },
      listSchemas() {
        return [...schemas.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([namespace, entry]) => ({
          namespace,
          title: entry.title,
          description: entry.description,
          category: entry.category,
          group: entry.group,
          schema: z.toJSONSchema(entry.schema) as Record<string, unknown>
        }))
      },
      async list() {
        const document = await ctx.store.read<SettingsDocument>('settings')
        return await Promise.all(api.listSchemas().map(async (descriptor) => ({
          ...descriptor,
          value: descriptor.namespace === 'mcp'
            ? readValue('mcp', { access: ctx.config.get('mcp').access, writeRoots: ctx.config.get('mcp').writeRoots })
            : readValue(descriptor.namespace, document.plugins[descriptor.namespace] ?? schemas.get(descriptor.namespace)!.defaultValue)
        })))
      },
      async get(namespace) {
        const entry = schemas.get(namespace)
        if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
        if (namespace === 'mcp') return readValue('mcp', { access: ctx.config.get('mcp').access, writeRoots: ctx.config.get('mcp').writeRoots })
        const document = await ctx.store.read<SettingsDocument>('settings')
        return readValue(namespace, document.plugins[namespace] ?? entry.defaultValue)
      },
      validate(namespace, value) {
        return validateValue(namespace, value)
      },
      async set(namespace, rawValue) {
        const entry = schemas.get(namespace)
        if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
        const validation = validateValue(namespace, rawValue)
        if (!validation.success) throw new Error(JSON.stringify({ code: 'invalid_settings', namespace, errors: validation.errors }))
        const value = validation.value
        if (namespace === 'mcp') {
          const access = value.access
          const writeRoots = value.writeRoots
          if (access !== 'off' && access !== 'read' && access !== 'standard' && access !== 'full') {
            throw new TypeError('MCP 访问级别无效')
          }
          if (!Array.isArray(writeRoots) || writeRoots.some((root) => typeof root !== 'string')) {
            throw new TypeError('MCP 写入根目录必须是路径数组')
          }
          if (writeRoots.some((root) => !root.trim() || !isAbsolute(root))) {
            throw new TypeError('MCP 写入根目录必须是非空绝对路径')
          }
          const current = ctx.config.get('mcp')
          await ctx.config.set('mcp', { ...current, access, writeRoots: [...new Set(writeRoots.map((root) => normalize(root)))] })
        } else {
          await ctx.store.update<SettingsDocument>('settings', (document) => ({
            ...document,
            plugins: { ...document.plugins, [namespace]: value }
          }))
        }
        for (const listener of listeners) {
          try { listener(namespace, value) } catch (error) { console.error(`[settings] ${namespace} listener failed`, errorMessage(error, '设置变更监听失败')) }
        }
        ctx.ipc.broadcast('settings:changed', { namespace, value })
        return value
      },
      subscribe(listener) {
        listeners.add(listener)
        return () => listeners.delete(listener)
      }
    }

    api.register('mcp', z.object({
      access: z.enum(['off', 'read', 'standard', 'full']).describe('MCP 访问级别'),
      writeRoots: z.array(z.string()).describe('允许 MCP 文件操作的根目录')
    }), {
      access: ctx.config.get('mcp').access,
      writeRoots: ctx.config.get('mcp').writeRoots
    }, { title: 'AI 工具与文件权限', category: 'program' })
    api.register('appearance', z.object({
      theme: z.enum(['light', 'dark', 'system']).describe('应用主题')
    }), { theme: 'system' }, { title: '外观', description: '主题与界面显示偏好', category: 'program' })

    ctx.reflect.provide('settings', api)
    ctx.ipc.handle('settings', {
      list: () => api.list(),
      listSchemas: () => api.listSchemas(),
      get: (namespace: string) => api.get(namespace),
      validate: (namespace: string, value: unknown) => api.validate(namespace, value),
      set: (namespace: string, value: unknown) => api.set(namespace, value)
    }, {
      list: z.tuple([]),
      listSchemas: z.tuple([]),
      get: z.tuple([z.string().regex(namespacePattern)]),
      validate: z.tuple([z.string().regex(namespacePattern), z.unknown()]),
      set: z.tuple([z.string().regex(namespacePattern), z.unknown()])
    })
    ctx.mcp.registerTool('open_settings_page', {
      description: 'Open the DeskSuite settings panel at a page: runtime, storage, mcp, or plugins.',
      inputSchema: { page: z.enum(['runtime', 'storage', 'mcp', 'plugins']) },
      mutating: true,
      execute: async (args) => {
        ctx.ipc.broadcast('settings:open', { page: args.page })
        return mcpText(`已打开设置页：${String(args.page)}`)
      }
    })
    ctx.mcp.registerTool('settings_validate', {
      description: 'Validate a settings draft without saving it; returns normalized values or field-path errors.',
      inputSchema: {
        namespace: z.string().regex(namespacePattern),
        value: z.record(z.string(), z.unknown())
      },
      execute: async (args) => mcpText(JSON.stringify(api.validate(String(args.namespace), args.value)))
    })
  }
}

export default settingsPlugin
