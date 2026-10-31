import { randomUUID } from 'node:crypto'
import { stat } from 'node:fs/promises'
import { basename, isAbsolute, resolve } from 'node:path'
import type { Context } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpErrorFrom, mcpText } from '../../services/mcp'

const title = z.string().trim().min(1).max(120)
const entry = z.object({ id: z.string(), name: title, path: z.string().min(1) })
const groupsSchema = z.array(z.object({ id: z.string(), name: title, items: z.array(entry).max(1000) })).max(100)
type Groups = z.infer<typeof groupsSchema>
const actionSchema = z.object({
  action: z.enum(['list', 'createGroup', 'renameGroup', 'deleteGroup', 'add', 'edit', 'remove']),
  groupId: z.string().optional(), itemId: z.string().optional(), name: title.optional(),
  paths: z.array(z.string().min(1)).min(1).max(1000).optional(), path: z.string().min(1).optional()
})
const key = 'quick-bookmarks'
const identity = (path: string): string => process.platform === 'win32' ? resolve(path).toLowerCase() : resolve(path)

export default {
  inject: ['ipc', 'mcp', 'store', 'storage'],
  apply(ctx: Context) {
    ctx.store.register(key, { schema: groupsSchema, default: [{ id: 'common', name: '常用', items: [] }] })
    ctx.storage.register('data-ops-quick-bookmarks', {
      title: '快速书签',
      entries: [{ label: '书签分组与条目', storeKey: key }]
    })
    const folder = async (raw: string): Promise<string> => {
      if (!isAbsolute(raw)) throw new Error('请填写文件夹的绝对路径')
      const path = resolve(raw)
      if (!(await stat(path)).isDirectory()) throw new Error('只能收藏文件夹')
      return path
    }
    const act = async (input: unknown): Promise<Groups> => {
      const args = actionSchema.parse(input)
      if (args.action === 'list') return ctx.store.read<Groups>(key)
      const result = await ctx.store.update<Groups>(key, async (stored) => {
        const groups = structuredClone(stored)
        if (args.action === 'createGroup') {
          groups.push({ id: randomUUID(), name: title.parse(args.name), items: [] })
        } else {
          const group = groups.find((item) => item.id === args.groupId)
          if (!group) throw new Error('收藏分组不存在')
          if (args.action === 'renameGroup') group.name = title.parse(args.name)
          if (args.action === 'deleteGroup') return groups.filter((item) => item !== group)
          if (args.action === 'add') {
            const paths = await Promise.all(z.array(z.string()).min(1).parse(args.paths).map(folder))
            for (const path of paths) {
              if (!group.items.some((item) => identity(item.path) === identity(path))) {
                group.items.push({ id: randomUUID(), name: basename(path) || path, path })
              }
            }
          }
          if (args.action === 'edit' || args.action === 'remove') {
            const item = group.items.find((item) => item.id === args.itemId)
            if (!item) throw new Error('收藏地址不存在')
            if (args.action === 'remove') group.items = group.items.filter((value) => value !== item)
            else {
              const path = await folder(z.string().parse(args.path))
              if (group.items.some((other) => other !== item && identity(other.path) === identity(path))) throw new Error('此分组已收藏该地址')
              item.path = path
              item.name = title.parse(args.name)
            }
          }
        }
        return groupsSchema.parse(groups)
      })
      ctx.ipc.broadcast('quickBookmarks:changed', null)
      return result
    }
    const pending = new Map<string, (result: { error?: string; value?: unknown }) => void>()
    ctx.ipc.handle('quickBookmarks', {
      act,
      complete: (id: string, result: { error?: string; value?: unknown }) => { pending.get(id)?.(result) }
    }, {
      act: z.tuple([actionSchema]),
      complete: z.tuple([z.string().uuid(), z.object({ error: z.string().max(500).optional(), value: z.unknown().optional() }).strict()])
    })
    ctx.mcp.registerTool('quick_bookmarks', {
      description: 'List or manage persistent quick bookmark groups and folder addresses. Deleting bookmarks never deletes files.',
      inputSchema: actionSchema.shape, mutating: true,
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await act(args))) } catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('quick_bookmarks_explorer', {
      description: 'Operate the active file pane: navigate, select entries, switch view mode, add selected folders to a bookmark group, or open a bookmark.',
      inputSchema: {
        action: z.enum(['navigate', 'select', 'addSelected', 'open', 'view', 'layout', 'pane']),
        viewMode: z.enum(['list', 'grid', 'gallery', 'grouped']).optional(),
        groupingEnabled: z.boolean().optional(),
        groupBy: z.enum(['kind', 'modifiedMinute', 'rating', 'folder']).optional(),
        includeChildren: z.boolean().optional(), layout: z.union([z.literal(1), z.literal(2), z.literal(4)]).optional(),
        paneId: z.string().min(1).max(128).optional(), path: z.string().optional(),
        paths: z.array(z.string()).optional(), groupId: z.string().optional(), itemId: z.string().optional()
      }, mutating: true,
      execute: async (args) => {
        const id = randomUUID()
        try {
          const result = await new Promise<{ error?: string; value?: unknown }>((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('文件视图未响应')) }, 15000)
            pending.set(id, (value) => { clearTimeout(timer); pending.delete(id); resolve(value) })
            ctx.ipc.broadcast('quickBookmarks:explorer', { ...args, id })
          })
          return result.error ? mcpError(result.error) : mcpText(JSON.stringify(result.value ?? null))
        } catch (error) { return mcpErrorFrom(error) }
      }
    })
  }
}
