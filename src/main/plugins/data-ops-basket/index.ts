import { z } from 'zod'
import type { Context, Plugin } from 'cordis'

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
  path: z.string().min(1),
  name: z.string(),
  isDirectory: z.boolean(),
  kind: z.string(),
  size: z.number(),
  modifiedAt: z.number(),
  addedAt: z.number()
})

const basketSchema: z.ZodType<BasketItem[]> = z.array(basketItemSchema).max(MAX_ITEMS)

const basketPlugin: Plugin = {
  inject: ['ipc', 'store'],
  apply(ctx: Context): void {
    ctx.store.register('basket', { schema: basketSchema, default: [] })

    ctx.ipc.handle('basket', {
      list: () => ctx.store.read<BasketItem[]>('basket'),

      // 整个数组由主进程裁剪，渲染层只提供要加进来的条目
      add: (items: BasketInput[]) =>
        ctx.store.update<BasketItem[]>('basket', (current) => {
          const existing = new Set(current.map((item) => item.path))
          const incoming = items.filter((item) => !existing.has(item.path))
          if (incoming.length === 0) return current
          const addedAt = Date.now()
          return [...incoming.map((item) => ({ ...item, addedAt })), ...current].slice(0, MAX_ITEMS)
        }),

      remove: (path: string) =>
        ctx.store.update<BasketItem[]>('basket', (current) =>
          current.some((item) => item.path === path)
            ? current.filter((item) => item.path !== path)
            : current
        ),

      clear: () => ctx.store.update<BasketItem[]>('basket', () => [])
    })
  }
}

export default basketPlugin
