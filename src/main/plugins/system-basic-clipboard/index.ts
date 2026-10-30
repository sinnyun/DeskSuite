import { app, clipboard, nativeImage } from 'electron'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { join } from 'node:path'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpText } from '../../services/mcp'

const MAX_TEXT_LENGTH = 1_000_000
const MAX_HISTORY = 50
const MAX_IMAGE_BYTES = 8 * 1024 * 1024
const IMAGE_SLOTS = 50
const EXPIRY_MS = 7 * 24 * 60 * 60 * 1000
const POLL_MS = 1500

const HistoryItemSchema = z.object({
  id: z.string(),
  kind: z.enum(['text', 'image']),
  content: z.string().optional(),
  imageSlot: z.number().int().min(0).max(IMAGE_SLOTS - 1).optional(),
  category: z.enum(['text', 'link', 'code', 'image']),
  favorite: z.boolean(),
  createdAt: z.number(),
  expiresAt: z.number(),
  groupId: z.string().optional()
})
const HistorySchema = z.array(HistoryItemSchema).max(MAX_HISTORY)
const ClipboardGroupSchema = z.object({ id: z.string(), name: z.string().min(1).max(32), createdAt: z.number() })
const ClipboardGroupsSchema = z.array(ClipboardGroupSchema).max(50)
type HistoryItem = z.infer<typeof HistoryItemSchema>

function hash(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex')
}

function categorize(text: string): HistoryItem['category'] {
  if (/^https?:\/\//i.test(text.trim())) return 'link'
  if (/```|\b(const|let|function|class|import|SELECT|CREATE)\b/.test(text)) return 'code'
  return 'text'
}

function imagePng(): Buffer | null {
  const image = clipboard.readImage()
  if (image.isEmpty()) return null
  const png = image.toPNG()
  return png.length > 0 && png.length <= MAX_IMAGE_BYTES ? png : null
}

const clipboardPlugin: Plugin = {
  inject: ['ipc', 'mcp', 'store'],
  apply(ctx: Context) {
    ctx.store.register('clipboard-history', { schema: HistorySchema, default: [], version: 1 })
    ctx.store.register('clipboard-groups', { schema: ClipboardGroupsSchema, default: [], version: 1 })
    const imageDir = join(app.getPath('userData'), 'data', 'clipboard-images')
    let imageWriteCursor = 0

    const removeExpired = (items: HistoryItem[], now: number): HistoryItem[] =>
      items.filter((item) => item.favorite || item.expiresAt > now)

    const captureCurrent = async (): Promise<HistoryItem | null> => {
      const now = Date.now()
      const image = imagePng()
      const text = image ? '' : clipboard.readText().slice(0, MAX_TEXT_LENGTH)
      if (!image && !text) return null
      const id = image ? hash(image) : hash(text)
      let chosen: HistoryItem | null = null
      const updated = await ctx.store.update<HistoryItem[]>('clipboard-history', async (stored) => {
        const items = removeExpired(stored, now)
        const existing = items.find((item) => item.id === id)
        if (existing) {
          chosen = { ...existing, createdAt: now, expiresAt: now + EXPIRY_MS }
          return [chosen, ...items.filter((item) => item.id !== id)]
        }
        if (items.filter((item) => item.favorite).length >= MAX_HISTORY) return items
        let imageSlot: number | undefined
        if (image) {
          const occupied = new Set(items.filter((item) => item.favorite).map((item) => item.imageSlot))
          for (let offset = 0; offset < IMAGE_SLOTS; offset += 1) {
            const slot = (imageWriteCursor + offset) % IMAGE_SLOTS
            const occupying = items.find((item) => item.imageSlot === slot)
            if (!occupied.has(slot) && (!occupying || !occupying.favorite)) {
              imageSlot = slot
              imageWriteCursor = (slot + 1) % IMAGE_SLOTS
              break
            }
          }
          if (imageSlot === undefined) return items
        }
        const item: HistoryItem = {
          id,
          kind: image ? 'image' : 'text',
          ...(imageSlot === undefined ? { content: text } : { imageSlot }),
          category: image ? 'image' : categorize(text),
          favorite: false,
          createdAt: now,
          expiresAt: now + EXPIRY_MS
        }
        chosen = item
        if (image && imageSlot !== undefined) {
          await fs.mkdir(imageDir, { recursive: true })
          await fs.writeFile(join(imageDir, `${imageSlot}.png`), image)
        }
        const next = [
          item,
          ...items.filter((entry) => entry.id !== id && (imageSlot === undefined || entry.imageSlot !== imageSlot))
        ]
        const favorites = next.filter((entry) => entry.favorite)
        const temporary = next.filter((entry) => !entry.favorite).slice(0, MAX_HISTORY - favorites.length)
        return [...favorites, ...temporary]
      })
      return chosen ?? updated[0] ?? null
    }

    const listHistory = async (): Promise<HistoryItem[]> => {
      const now = Date.now()
      return ctx.store.update<HistoryItem[]>('clipboard-history', (items) => removeExpired(items, now))
    }

    ctx.ipc.handle('clipboard', {
      readText: () => clipboard.readText(),
      writeText: (text: string) => {
        const value = String(text ?? '')
        if (value.length > MAX_TEXT_LENGTH) throw new Error('剪贴板文本超过 100 万字符上限')
        clipboard.writeText(value)
        return true
      },
      readImage: () => {
        const image = clipboard.readImage()
        if (image.isEmpty()) return null
        const png = image.toPNG()
        return png.length > MAX_IMAGE_BYTES ? null : `data:image/png;base64,${png.toString('base64')}`
      },
      hasImage: () => !clipboard.readImage().isEmpty(),
      writeImage: (dataUrl: string) => {
        const match = /^data:image\/png;base64,([A-Za-z0-9+/=]+)$/.exec(String(dataUrl))
        if (!match) throw new Error('仅支持 PNG 图片')
        const buffer = Buffer.from(match[1], 'base64')
        if (buffer.length > MAX_IMAGE_BYTES) throw new Error('图片超过 8MB 上限')
        clipboard.writeImage(nativeImage.createFromBuffer(buffer))
        return true
      },
      capture: () => captureCurrent(),
      importLegacy: async (texts: string[]) => {
        if (!Array.isArray(texts)) throw new Error('历史格式无效')
        const now = Date.now()
        await ctx.store.update<HistoryItem[]>('clipboard-history', (stored) => {
          const imported = texts
            .filter((text): text is string => typeof text === 'string' && text.length > 0 && text.length <= MAX_TEXT_LENGTH)
            .slice(0, 20)
            .map((content) => ({
              id: hash(content), kind: 'text' as const, content, category: categorize(content),
              favorite: false, createdAt: now, expiresAt: now + EXPIRY_MS
            }))
          const ids = new Set(stored.map((item) => item.id))
          const combined = [...stored, ...imported.filter((item) => !ids.has(item.id))]
          const favorites = combined.filter((item) => item.favorite)
          return [...favorites, ...combined.filter((item) => !item.favorite).slice(0, MAX_HISTORY - favorites.length)]
        })
        return true
      },
      history: () => listHistory(),
      groups: () => ctx.store.read('clipboard-groups'),
      createGroup: async (name: string) => {
        const label = String(name ?? '').trim()
        if (!label || label.length > 32) throw new Error('分组名称需为 1 到 32 个字符')
        const groups = await ctx.store.update<z.infer<typeof ClipboardGroupsSchema>>('clipboard-groups', (items) => {
          if (items.some((item) => item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('分组名称已存在')
          if (items.length >= 50) throw new Error('最多创建 50 个分组')
          return [...items, { id: createHash('sha1').update(`${Date.now()}-${label}`).digest('hex').slice(0, 12), name: label, createdAt: Date.now() }]
        })
        return groups
      },
      renameGroup: async (id: string, name: string) => {
        const label = String(name ?? '').trim()
        if (!label || label.length > 32) throw new Error('分组名称需为 1 到 32 个字符')
        const groups = await ctx.store.update<z.infer<typeof ClipboardGroupsSchema>>('clipboard-groups', (items) => {
          if (items.some((item) => item.id !== id && item.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('分组名称已存在')
          return items.map((item) => item.id === id ? { ...item, name: label } : item)
        })
        return groups
      },
      deleteGroup: async (id: string) => {
        await ctx.store.update<HistoryItem[]>('clipboard-history', (items) => items.map((item) => {
          if (item.groupId !== id) return item
          const { groupId: _removed, ...rest } = item
          return rest
        }))
        return ctx.store.update<z.infer<typeof ClipboardGroupsSchema>>('clipboard-groups', (items) => items.filter((item) => item.id !== id))
      },
      assignGroup: async (id: string, groupId: string | null) => {
        const groups = await ctx.store.read<z.infer<typeof ClipboardGroupsSchema>>('clipboard-groups')
        if (groupId && !groups.some((group) => group.id === groupId)) throw new Error('目标分组不存在')
        await ctx.store.update<HistoryItem[]>('clipboard-history', (items) => items.map((item) => {
          if (item.id !== id) return item
          const { groupId: _old, ...rest } = item
          return groupId ? { ...rest, groupId } : rest
        }))
        return true
      },
      updateHistory: async (id: string, content: string) => {
        const value = String(content ?? '')
        if (value.length > MAX_TEXT_LENGTH) throw new Error('剪贴板文本超过 100 万字符上限')
        const nextId = hash(value)
        const result = await ctx.store.update<HistoryItem[]>('clipboard-history', (items) => {
          const source = items.find((item) => item.id === id)
          if (!source || source.kind !== 'text') throw new Error('只能编辑文本历史')
          const duplicate = items.find((item) => item.id === nextId && item.id !== id)
          const updated = { ...source, id: nextId, content: value, category: categorize(value), createdAt: Date.now(), expiresAt: Date.now() + EXPIRY_MS }
          return [updated, ...items.filter((item) => item.id !== id && item.id !== duplicate?.id)]
        })
        return result.find((item) => item.id === nextId) ?? null
      },
      historyImage: async (id: string) => {
        const item = (await listHistory()).find((entry) => entry.id === id)
        if (!item || item.kind !== 'image' || item.imageSlot === undefined) return null
        try {
          return `data:image/png;base64,${(await fs.readFile(join(imageDir, `${item.imageSlot}.png`))).toString('base64')}`
        } catch {
          return null
        }
      },
      setFavorite: async (id: string, favorite: boolean) => {
        await ctx.store.update<HistoryItem[]>('clipboard-history', (items) =>
          items.map((item) => (item.id === id ? { ...item, favorite: Boolean(favorite) } : item))
        )
        return true
      },
      removeHistory: async (id: string) => {
        await ctx.store.update<HistoryItem[]>('clipboard-history', (items) => items.filter((item) => item.id !== id))
        return true
      },
      clearHistory: async () => {
        await ctx.store.update<HistoryItem[]>('clipboard-history', (items) => items.filter((item) => item.favorite))
        return true
      },
      useHistory: async (id: string) => {
        const item = (await listHistory()).find((entry) => entry.id === id)
        if (!item) throw new Error('剪贴板历史已过期')
        if (item.kind === 'text') clipboard.writeText(item.content ?? '')
        else if (item.imageSlot !== undefined) {
          const buffer = await fs.readFile(join(imageDir, `${item.imageSlot}.png`))
          clipboard.writeImage(nativeImage.createFromBuffer(buffer))
        }
        return true
      }
    })

    ctx.mcp.registerTool('read_clipboard', {
      description: '读取系统剪贴板文本或图片；图片以 PNG 图片内容返回',
      execute: async () => {
        const image = clipboard.readImage()
        if (!image.isEmpty()) {
          const png = image.toPNG()
          if (png.length > MAX_IMAGE_BYTES) return mcpError('剪贴板图片超过 8MB 上限')
          return { content: [{ type: 'image', data: png.toString('base64'), mimeType: 'image/png' }] }
        }
        const text = clipboard.readText()
        return mcpText(text.length > 0 ? text : '（剪贴板为空或不是文本）')
      }
    })

    ctx.mcp.registerTool('write_clipboard', {
      description: '向系统剪贴板写入文本内容',
      inputSchema: { text: z.string() },
      mutating: true,
      impact: 'low',
      execute: async (args) => {
        const text = String(args.text ?? '')
        if (text.length > MAX_TEXT_LENGTH) return mcpError('文本超过 100 万字符上限')
        clipboard.writeText(text)
        return mcpText(`已写入剪贴板：${text.length} 个字符`)
      }
    })

    void captureCurrent().catch(() => {})
    const poller = setInterval(() => { void captureCurrent().catch(() => {}) }, POLL_MS)
    poller.unref?.()
    return () => clearInterval(poller)
  }
}

export default clipboardPlugin
