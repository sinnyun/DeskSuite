import { z } from 'zod'
import type { Context, Plugin } from 'cordis'
import { mcpErrorFrom, mcpText } from '../../services/mcp'

const MAX_ITEMS = 200

export interface BasketItem {
  path: string
  name: string
  isDirectory: boolean
  kind: string
  size: number
  modifiedAt: number
  addedAt: number
}

type BasketInput = Omit<BasketItem, 'addedAt'>

const basketItemSchema = z.object({
  path: z.string().min(1).max(32768),
  name: z.string().max(1024),
  isDirectory: z.boolean(),
  kind: z.string().max(64),
  size: z.number().finite().nonnegative(),
  modifiedAt: z.number().finite().nonnegative(),
  addedAt: z.number().finite().nonnegative()
})
const basketInputSchema = basketItemSchema.omit({ addedAt: true })
const basketManageSchema = z.object({
  action: z.enum(['list', 'add', 'remove', 'clear']),
  items: z.array(basketInputSchema).max(MAX_ITEMS).optional(),
  path: z.string().min(1).max(32768).optional()
})

const basketSchema: z.ZodType<BasketItem[]> = z.array(basketItemSchema).max(MAX_ITEMS)

const basketPlugin: Plugin = {
  inject: ['ipc', 'store', 'storage', 'mcp'],
  apply(ctx: Context): void {
    ctx.store.register('basket', { schema: basketSchema, default: [] })
    ctx.storage.register('data-ops-basket', {
      title: '文件暂存篮',
      entries: [{ label: '暂存条目', storeKey: 'basket' }]
    })

    const list = () => ctx.store.read<BasketItem[]>('basket')
    const add = async (items: BasketInput[]) => {
      const result = await ctx.store.update<BasketItem[]>('basket', (current) => {
        const existing = new Set(current.map((item) => item.path))
        const incoming = items.filter((item) => !existing.has(item.path))
        if (incoming.length === 0) return current
        const addedAt = Date.now()
        return [...incoming.map((item) => ({ ...item, addedAt })), ...current].slice(0, MAX_ITEMS)
      })
      ctx.ipc.broadcast('basket:changed', null)
      return result
    }
    const remove = async (path: string) => {
      const result = await ctx.store.update<BasketItem[]>('basket', (current) =>
        current.some((item) => item.path === path) ? current.filter((item) => item.path !== path) : current
      )
      ctx.ipc.broadcast('basket:changed', null)
      return result
    }
    const clear = async () => {
      const result = await ctx.store.update<BasketItem[]>('basket', () => [])
      ctx.ipc.broadcast('basket:changed', null)
      return result
    }
    ctx.ipc.handle('basket', { list, add, remove, clear }, {
      list: z.tuple([]),
      add: z.tuple([z.array(basketInputSchema).max(MAX_ITEMS)]),
      remove: z.tuple([z.string().min(1).max(32768)]),
      clear: z.tuple([])
    })

    ctx.mcp.registerTool('basket_manage', {
      description: 'Read or update the persistent file basket. Changes are broadcast to the renderer cache.',
      inputSchema: basketManageSchema.shape,
      mutating: true,
      execute: async (args) => {
        try {
          const input = basketManageSchema.parse(args)
          if (input.action === 'list') return mcpText(JSON.stringify(await list()))
          if (input.action === 'add') return mcpText(JSON.stringify(await add(input.items ?? [])))
          if (input.action === 'remove') {
            if (!input.path) throw new Error('移除暂存项需要 path')
            return mcpText(JSON.stringify(await remove(input.path)))
          }
          return mcpText(JSON.stringify(await clear()))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
  }
}

export default basketPlugin
