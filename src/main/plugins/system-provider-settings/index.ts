import type { Context, Plugin } from 'cordis'
import { isAbsolute } from 'node:path'
import { z } from 'zod'
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
  inject: ['ipc', 'store', 'config'],
  apply(ctx: Context): void {
    ctx.store.register('settings', { schema: documentSchema, default: { plugins: {} }, version: 1 })
    const schemas = new Map<string, { schema: z.ZodType; defaultValue: Record<string, unknown>; title: string; description?: string; category: 'program' | 'plugin'; group?: string }>()
    const listeners = new Set<(namespace: string, value: Record<string, unknown>) => void>()

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
            ? { access: ctx.config.get('mcp').access, writeRoots: ctx.config.get('mcp').writeRoots }
            : document.plugins[descriptor.namespace] ?? schemas.get(descriptor.namespace)!.defaultValue
        })))
      },
      async get(namespace) {
        const entry = schemas.get(namespace)
        if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
        if (namespace === 'mcp') return { access: ctx.config.get('mcp').access, writeRoots: ctx.config.get('mcp').writeRoots }
        const document = await ctx.store.read<SettingsDocument>('settings')
        return document.plugins[namespace] ?? entry.defaultValue
      },
      async set(namespace, rawValue) {
        const entry = schemas.get(namespace)
        if (!entry) throw new Error(`未知设置命名空间：${namespace}`)
        const parsed = entry.schema.parse(rawValue)
        if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
          throw new TypeError(`设置值必须是对象：${namespace}`)
        }
        const value = parsed as Record<string, unknown>
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
          try { listener(namespace, value) } catch (error) { console.error(`[settings] ${namespace} listener failed`, error) }
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
      set: (namespace: string, value: unknown) => api.set(namespace, value)
    })
  }
}

export default settingsPlugin
