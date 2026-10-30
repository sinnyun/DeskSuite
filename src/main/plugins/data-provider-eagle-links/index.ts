import { shell } from 'electron'
import { basename, dirname } from 'node:path'
import { realpath } from 'node:fs/promises'
import type { Context } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpText } from '../../services/mcp'
import { EagleClient, itemId, localPath, samePath, sourceSchema } from './eagle'
import type { EagleSource } from './eagle'

export default {
  inject: ['resources', 'store', 'ipc', 'mcp'],
  apply(ctx: Context) {
    const key = 'eagle-source-links'
    ctx.store.register(key, { schema: z.array(sourceSchema).max(50000), default: [], version: 1 })
    let records: EagleSource[] = []
    const ready = ctx.store.read<EagleSource[]>(key).then(value => { records = value })
    let writes = Promise.resolve()
    const client = new EagleClient()
    let disposed = false
    ctx.effect(() => () => { disposed = true; client.dispose() })
    const pending = new Map<string, Promise<EagleSource>>()
    const save = async (source: EagleSource): Promise<EagleSource> => {
      sourceSchema.parse(source)
      const task = writes.then(async () => {
        await ready
        if (disposed) throw new Error('Eagle 插件已卸载')
        const next = [...records.filter(s => s.resourceUri !== source.resourceUri), source]
        await ctx.store.write(key, next)
        records = next
        ctx.ipc.broadcast('eagleLinks:changed', { reference: source.resourceUri })
      })
      writes = task.catch(() => {})
      await task
      return source
    }
    const linkItem = (id: string): Promise<EagleSource> => {
      itemId.parse(id)
      const existing = pending.get(id)
      if (existing) return existing
      const task = (async () => {
        const source = await client.resolve(id)
        const resource = await ctx.resources.register(source.originalPath)
        if (resource.kind !== 'image') throw new Error('该 Eagle 条目不是图片')
        return save({ ...source, resourceUri: resource.uri })
      })()
      pending.set(id, task)
      void task.finally(() => { if (pending.get(id) === task) pending.delete(id) }).catch(() => {})
      return task
    }
    const get = async (reference: string): Promise<EagleSource | null> => {
      const resource = await ctx.resources.resolve(reference)
      await ready
      return records.find(s => s.resourceUri === resource.uri) ?? null
    }
    const inspect = async (reference: string, refresh = false): Promise<EagleSource | null> => {
      const resource = await ctx.resources.resolve(reference)
      if (resource.kind !== 'image') return null
      const match = basename(dirname(resource.path)).match(/^([a-zA-Z0-9]{1,100})\.info$/i)
      if (!match) return null
      if (!refresh) {
        const cached = await get(resource.uri)
        if (cached) return cached
      }
      const resolved = await client.resolve(match[1])
      if (!samePath(await realpath(resource.path), resolved.originalPath)) throw new Error('拖入的是 Eagle 缩略图或非原图文件，请拖入原图')
      return save({ ...resolved, resourceUri: resource.uri })
    }
    const link = async (args: { itemId?: string; location?: string }): Promise<EagleSource> => {
      if (!!args.itemId === !!args.location) throw new Error('请提供唯一的 Eagle 条目 ID 或本地文件位置')
      if (args.itemId) return linkItem(args.itemId)
      const resource = await ctx.resources.register(localPath(args.location!))
      const source = await inspect(resource.uri)
      if (!source) throw new Error('该文件不在 Eagle 条目目录中')
      return source
    }
    const open = async (id: string): Promise<{ itemId: string; deepLink: string }> => {
      itemId.parse(id)
      const deepLink = `eagle://item/${id}`
      await shell.openExternal(deepLink)
      return { itemId: id, deepLink }
    }
    const methods = { link, get, inspect, open }
    ctx.reflect.provide('eagleLinks', methods)
    ctx.ipc.handle('eagleLinks', methods)
    const definitions: Array<{ name: string; inputSchema: Record<string, z.ZodType>; execute: (args: Record<string, unknown>) => Promise<unknown>; description: string }> = [
      { name: 'eagle_link', inputSchema: { itemId: itemId.optional(), location: z.string().min(1).max(32768).optional() }, execute: (args: Record<string, unknown>) => link(args as { itemId?: string; location?: string }), description: 'Link an Eagle image original by item ID or original file path/URL using the unified resource service. Saves metadata only; never copies or changes Eagle files.' },
      { name: 'eagle_source', inputSchema: { reference: z.string().min(1).max(2048), refresh: z.boolean().optional() }, execute: (args: Record<string, unknown>) => args.refresh ? inspect(String(args.reference), true) : get(String(args.reference)), description: 'Read persisted Eagle metadata for a resource link; refresh queries the running local Eagle API and confirms the original file.' },
      { name: 'eagle_open_item', inputSchema: { itemId }, execute: (args: Record<string, unknown>) => open(String(args.itemId)), description: 'Open and locate an image item in Eagle through its registered eagle://item/{id} handler.' }
    ]
    for (const definition of definitions) ctx.mcp.registerTool(definition.name, {
      ...definition, mutating: true,
      execute: async args => {
        try { return mcpText(JSON.stringify(await definition.execute(args))) }
        catch (error) { return mcpError(String(error)) }
      }
    })
  }
}

declare module 'cordis' {
  interface Context {
    eagleLinks: {
      link(args: { itemId?: string; location?: string }): Promise<EagleSource>
      get(reference: string): Promise<EagleSource | null>
      inspect(reference: string, refresh?: boolean): Promise<EagleSource | null>
      open(itemId: string): Promise<{ itemId: string; deepLink: string }>
    }
  }
}
