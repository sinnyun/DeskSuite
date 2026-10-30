import { realpath, readdir, stat } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { z } from 'zod'

export const itemId = z.string().regex(/^[a-zA-Z0-9]{1,100}$/)
export const sourceSchema = z.object({
  itemId, name: z.string().max(1000), resourceUri: z.string().max(2048).regex(/^desksuite-resource:\/\/local\/[a-f0-9-]+\/content(?:\.[a-z0-9]+)?$/),
  originalPath: z.string().max(32768), thumbnailPath: z.string().max(32768),
  apiUrl: z.string().max(2048), folders: z.array(z.object({ id: z.string(), name: z.string() })).max(1000),
  tags: z.array(z.string().max(1000)).max(1000), annotation: z.string().max(100000),
  url: z.string().max(10000), width: z.number().nonnegative(), height: z.number().nonnegative(),
  size: z.number().nonnegative(), rating: z.number().min(0).max(5), updatedAt: z.number()
})
export type EagleSource = z.infer<typeof sourceSchema>
const api = 'http://127.0.0.1:41595'
const itemSchema = z.object({
  id: itemId, name: z.string().max(1000), ext: z.string().regex(/^[a-zA-Z0-9]{1,24}$/),
  size: z.number().int().nonnegative(), folders: z.array(z.string()).nullish(), tags: z.array(z.string()).nullish(),
  isDeleted: z.boolean().nullish(), noThumbnail: z.boolean().nullish(),
  width: z.number().nonnegative().nullish(), height: z.number().nonnegative().nullish(),
  rating: z.number().min(0).max(5).nullish(), annotation: z.string().nullish(), url: z.string().nullish()
})

export function localPath(value: string): string {
  if (!value.trim()) throw new Error('Eagle 文件位置为空')
  return value.startsWith('file:') ? fileURLToPath(value) : value
}
export const samePath = (a: string, b: string): boolean => process.platform === 'win32' ? a.toLowerCase() === b.toLowerCase() : a === b

export class EagleClient {
  private abort = new AbortController()
  constructor(private request: typeof fetch = fetch) {}
  dispose(): void { this.abort.abort() }
  private async json(path: string, params: Record<string, string>): Promise<unknown> {
    const url = new URL(path, api)
    for (const [key, value] of Object.entries(params)) url.searchParams.set(key, value)
    try {
      const response = await this.request(url, { signal: AbortSignal.any([AbortSignal.timeout(5000), this.abort.signal]), redirect: 'error' })
      if (!response.ok) throw new Error(`HTTP ${response.status}`)
      const reader = response.body?.getReader()
      if (!reader) throw new Error('空响应')
      const chunks: Uint8Array[] = []
      let length = 0
      try {
        for (;;) {
          const { value, done } = await reader.read()
          if (done) break
          length += value.byteLength
          if (length > 4 * 1024 * 1024) throw new Error('响应超过 4MB')
          chunks.push(value)
        }
      } finally { await reader.cancel().catch(() => {}) }
      const envelope = z.object({ status: z.string(), data: z.unknown(), message: z.string().optional() }).parse(JSON.parse(Buffer.concat(chunks).toString('utf8')))
      if (envelope.status !== 'success') throw new Error(envelope.message ?? '查询失败')
      return envelope.data
    } catch (error) { throw new Error(`Eagle 查询失败，请确认 Eagle 已运行且启用本机 API：${String(error)}`) }
  }
  async resolve(id: string): Promise<Omit<EagleSource, 'resourceUri'>> {
    itemId.parse(id)
    const page = z.object({ data: z.array(itemSchema) }).parse(await this.json('/api/v2/item/get', { id }))
    if (page.data.length !== 1 || page.data[0].id !== id || page.data[0].isDeleted) throw new Error('Eagle 条目不存在、已在回收站或返回结果不唯一')
    const item = page.data[0]
    const rawThumbnail = z.string().min(1).parse(await this.json('/api/item/thumbnail', { id }))
    // Eagle encodes the complete filesystem path once, not just its basename.
    const thumbnailPath = await realpath(localPath(decodeURIComponent(rawThumbnail)))
    if (!(await stat(thumbnailPath)).isFile() || basename(dirname(thumbnailPath)).toLowerCase() !== `${id}.info`.toLowerCase()) throw new Error('Eagle 缩略图不在对应条目目录中')
    let originalPath = thumbnailPath
    if (!item.noThumbnail) {
      const candidates: string[] = []
      for (const entry of await readdir(dirname(thumbnailPath), { withFileTypes: true })) {
        const path = join(dirname(thumbnailPath), entry.name)
        if (!entry.isFile() || samePath(path, thumbnailPath) || extname(path).slice(1).toLowerCase() !== item.ext.toLowerCase()) continue
        if ((await stat(path)).size === item.size) candidates.push(await realpath(path))
      }
      if (candidates.length !== 1) throw new Error('无法唯一确认 Eagle 原图，请检查文件缺失或同目录存在多个匹配文件')
      originalPath = candidates[0]
    }
    if (extname(originalPath).slice(1).toLowerCase() !== item.ext.toLowerCase() || (await stat(originalPath)).size !== item.size) throw new Error('Eagle 原图扩展名或大小与条目不符')
    const ids = item.folders ?? []
    const folders: EagleSource['folders'] = []
    if (ids.length) {
      const page = z.object({ data: z.array(z.unknown()) }).parse(await this.json('/api/v2/folder/get', { ids: ids.join(',') }))
      const queue = [...page.data]
      let visited = 0
      while (queue.length) {
        if (++visited > 20000) throw new Error('Eagle 文件夹响应过大')
        const folder = z.object({ id: z.string(), name: z.string(), children: z.array(z.unknown()).optional() }).parse(queue.pop())
        if (ids.includes(folder.id)) folders.push({ id: folder.id, name: folder.name })
        queue.push(...(folder.children ?? []))
      }
    }
    const apiUrl = new URL('/api/v2/item/get', api)
    apiUrl.searchParams.set('id', id)
    return {
      itemId: id, name: item.name, originalPath, thumbnailPath, apiUrl: apiUrl.href,
      folders: ids.map(id => folders.find(folder => folder.id === id) ?? { id, name: id }),
      tags: item.tags ?? [], annotation: item.annotation ?? '', url: item.url ?? '',
      width: item.width ?? 0, height: item.height ?? 0, size: item.size, rating: item.rating ?? 0, updatedAt: Date.now()
    }
  }
}
