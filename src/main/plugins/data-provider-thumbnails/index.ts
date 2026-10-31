import { app, nativeImage } from 'electron'
import type { NativeImage } from 'electron'
import type { Context, Plugin } from 'cordis'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { extname, join } from 'node:path'
import { z } from 'zod'
import { identity, normalize } from '../../services/paths'

const CACHE_DIR_NAME = 'thumbs'
const CACHE_MAGIC = Buffer.from('DSSTHM02')
const HEADER_BYTES = CACHE_MAGIC.length + 4
const CACHE_FILE_LIMIT = 20_000
const DEFAULT_CACHE_BYTE_LIMIT = 512 * 1024 * 1024
const GENERATION_EDGE = 320
const RESULT_EDGE = 240
const JPEG_QUALITY = 80
const SLOT_NAME = (index: number): string => `${index.toString().padStart(5, '0')}.thm`

interface CacheSlot {
  name: string
  key: string
  diskBytes: number
  accessedAt: number
}

interface CacheHeader {
  key: string
  edge: number
  sourceSize: number
  sourceMtimeMs: number
}

const cacheDir = join(app.getPath('userData'), CACHE_DIR_NAME)
const slots = new Map<string, CacheSlot>()
const byKey = new Map<string, CacheSlot>()
const allocated = new Set<string>()
const inFlight = new Map<string, Promise<Buffer>>()
const failedUntil = new Map<string, number>()
const MAX_CONCURRENT_GENERATION = 4
let activeGenerations = 0
const generationQueue: Array<() => void> = []
let cacheReady: Promise<void> | null = null
let writeChain: Promise<void> = Promise.resolve()
let cacheByteLimit = DEFAULT_CACHE_BYTE_LIMIT

const ICON_CACHE_LIMIT = 512
// .exe/.lnk 等文件的图标随文件本身变化，不能按扩展名复用。
const PER_FILE_ICON_EXTENSIONS = new Set(['appx', 'appref-ms', 'cpl', 'dll', 'exe', 'ico', 'lnk', 'msi', 'scr', 'url'])
const iconCache = new Map<string, string>()
const iconRequests = new Map<string, Promise<string>>()

function encodeBlob(header: CacheHeader, jpeg: Buffer): Buffer {
  const json = Buffer.from(JSON.stringify(header), 'utf8')
  const prefix = Buffer.alloc(HEADER_BYTES)
  CACHE_MAGIC.copy(prefix, 0)
  prefix.writeUInt32BE(json.length, CACHE_MAGIC.length)
  return Buffer.concat([prefix, json, jpeg])
}

function decodeBlob(blob: Buffer): { header: CacheHeader; jpeg: Buffer } | null {
  if (blob.length < HEADER_BYTES || !blob.subarray(0, CACHE_MAGIC.length).equals(CACHE_MAGIC)) return null
  const headerLength = blob.readUInt32BE(CACHE_MAGIC.length)
  const jpegStart = HEADER_BYTES + headerLength
  if (!headerLength || jpegStart >= blob.length) return null
  try {
    const header = JSON.parse(blob.subarray(HEADER_BYTES, jpegStart).toString('utf8')) as CacheHeader
    if (
      typeof header.key !== 'string' ||
      !Number.isFinite(header.edge) ||
      !Number.isFinite(header.sourceSize) ||
      !Number.isFinite(header.sourceMtimeMs)
    ) return null
    return { header, jpeg: blob.subarray(jpegStart) }
  } catch {
    return null
  }
}

async function ensureCache(): Promise<void> {
  if (!cacheReady) cacheReady = loadCacheIndex()
  await cacheReady
}

async function loadCacheIndex(): Promise<void> {
  await fs.mkdir(cacheDir, { recursive: true }).catch(() => undefined)
  let directory
  try {
    directory = await fs.opendir(cacheDir)
  } catch {
    return
  }

  for await (const entry of directory) {
    if (!/^\d{5}\.thm$/.test(entry.name) || !entry.isFile()) continue
    allocated.add(entry.name)
    const path = join(cacheDir, entry.name)
    try {
      const [blob, stats] = await Promise.all([fs.readFile(path), fs.stat(path)])
      if (stats.size === 0) continue
      const decoded = decodeBlob(blob)
      if (!decoded) {
        await fs.writeFile(path, Buffer.alloc(0))
        continue
      }
      const slot: CacheSlot = {
        name: entry.name,
        key: decoded.header.key,
        diskBytes: stats.size,
        accessedAt: stats.mtimeMs
      }
      slots.set(entry.name, slot)
      const previous = byKey.get(slot.key)
      if (!previous || previous.accessedAt < slot.accessedAt) byKey.set(slot.key, slot)
    } catch {
      // 损坏或被外部占用的缓存槽位留待后续请求时回收。
    }
  }
  await pruneCache()
}

function resizeToFit(image: NativeImage, edge: number): NativeImage {
  const { width, height } = image.getSize()
  if (width <= 0 || height <= 0) return image
  if (width <= edge && height <= edge) return image
  const scale = Math.min(edge / width, edge / height)
  return image.resize({
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
    quality: 'better'
  })
}

function imageToJpeg(image: NativeImage, edge: number): Buffer {
  if (image.isEmpty()) throw new Error('系统未能生成该文件的缩略图')
  return resizeToFit(image, edge).toJPEG(JPEG_QUALITY)
}

async function createThumbnail(path: string, edge: number): Promise<Buffer> {
  try {
    const thumbnail = await nativeImage.createThumbnailFromPath(path, { width: edge, height: edge })
    if (!thumbnail.isEmpty()) return imageToJpeg(thumbnail, edge)
  } catch {
    // Some Windows shell providers return no preview or fail for an unsupported format.
  }

  try {
    const source = nativeImage.createFromPath(path)
    if (!source.isEmpty()) return imageToJpeg(source, edge)
  } catch {
    // Continue to the operating system file icon fallback.
  }

  const icon = await app.getFileIcon(path, { size: 'normal' })
  return imageToJpeg(icon, edge)
}

async function withGenerationLimit<T>(work: () => Promise<T>): Promise<T> {
  if (activeGenerations >= MAX_CONCURRENT_GENERATION) {
    await new Promise<void>((resolve) => generationQueue.push(resolve))
  }
  activeGenerations += 1
  try {
    return await work()
  } finally {
    activeGenerations -= 1
    generationQueue.shift()?.()
  }
}

function cacheKey(path: string, size: number, mtimeMs: number, edge: number): string {
  return createHash('sha1').update(`${identity(path)}\0${size}\0${mtimeMs}\0${edge}`).digest('hex')
}

async function touchSlot(slot: CacheSlot): Promise<void> {
  slot.accessedAt = Date.now()
  try {
    const path = join(cacheDir, slot.name)
    const current = await fs.stat(path)
    await fs.utimes(path, current.atime, new Date(slot.accessedAt))
  } catch {
    // The in-memory LRU still applies when the filesystem does not support updating times.
  }
}

async function emptySlot(slot: CacheSlot): Promise<void> {
  await fs.writeFile(join(cacheDir, slot.name), Buffer.alloc(0))
  slots.delete(slot.name)
  if (byKey.get(slot.key) === slot) byKey.delete(slot.key)
}

async function pruneCache(protectedKey?: string, incomingBytes = 0): Promise<void> {
  let totalBytes = [...slots.values()].reduce((total, slot) => total + slot.diskBytes, 0)
  const overCount = (): boolean => slots.size > CACHE_FILE_LIMIT
  const overBytes = (): boolean => totalBytes + incomingBytes > cacheByteLimit
  const ordered = [...slots.values()].sort((a, b) => a.accessedAt - b.accessedAt)
  for (const slot of ordered) {
    if (!overCount() && !overBytes()) break
    if (slot.key === protectedKey) continue
    await emptySlot(slot)
    totalBytes -= slot.diskBytes
  }
}

function withWriteLock<T>(task: () => Promise<T>): Promise<T> {
  const current = writeChain.then(task, task)
  writeChain = current.then(() => undefined, () => undefined)
  return current
}

function freeSlotName(): string | undefined {
  for (let index = 0; index < CACHE_FILE_LIMIT; index += 1) {
    const name = SLOT_NAME(index)
    if (!allocated.has(name)) {
      allocated.add(name)
      return name
    }
  }
  return undefined
}

async function saveToCache(key: string, header: CacheHeader, jpeg: Buffer): Promise<void> {
  if (jpeg.length >= cacheByteLimit) return
  await ensureCache()
  await withWriteLock(async () => {
    const existing = byKey.get(key)
    const reusable = existing ?? [...slots.values()].sort((a, b) => a.accessedAt - b.accessedAt)[0]
    const name = reusable?.name ?? [...allocated].find((candidate) => !slots.has(candidate)) ?? freeSlotName()
    if (!name) return

    const encoded = encodeBlob(header, jpeg)
    if (encoded.length >= cacheByteLimit) return
    if (reusable) await emptySlot(reusable)
    await pruneCache(undefined, encoded.length)
    await fs.writeFile(join(cacheDir, name), encoded)
    const slot: CacheSlot = { name, key, diskBytes: encoded.length, accessedAt: Date.now() }
    slots.set(name, slot)
    byKey.set(key, slot)
    allocated.add(name)
  })
}

async function readCache(key: string): Promise<Buffer | null> {
  await ensureCache()
  const slot = byKey.get(key)
  if (!slot) return null
  try {
    const blob = await fs.readFile(join(cacheDir, slot.name))
    const decoded = decodeBlob(blob)
    if (!decoded || decoded.header.key !== key) {
      await withWriteLock(() => emptySlot(slot))
      return null
    }
    await touchSlot(slot)
    return decoded.jpeg
  } catch {
    await withWriteLock(() => emptySlot(slot)).catch(() => undefined)
    return null
  }
}

async function getThumbnail(rawPath: string, requestedEdge?: number): Promise<{ dataUrl: string }> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('path 必须是非空绝对路径')
  const path = normalize(rawPath)
  const edge = requestedEdge === undefined ? GENERATION_EDGE : Math.floor(requestedEdge)
  if (!Number.isFinite(edge) || edge < 64 || edge > 1024) throw new Error('edge 必须介于 64 与 1024 之间')
  const sourceStats = await fs.stat(path)
  if (!sourceStats.isFile()) throw new Error('仅支持文件缩略图')
  const key = cacheKey(path, sourceStats.size, sourceStats.mtimeMs, edge)
  const failedThrough = failedUntil.get(key)
  if (failedThrough && failedThrough > Date.now()) throw new Error('该文件近期生成缩略图失败，请稍后重试')
  if (failedThrough) failedUntil.delete(key)
  let jpeg: Buffer | null = null
  try {
    jpeg = await readCache(key)
  } catch {
    // 缓存目录不可用时仍尝试实时生成缩略图。
  }

  if (!jpeg) {
    const pending = inFlight.get(key)
    if (pending) jpeg = await pending
    else {
      const generation = (async () => {
        try {
          const generated = await withGenerationLimit(() => createThumbnail(path, edge))
          const latest = await fs.stat(path)
          if (latest.size !== sourceStats.size || latest.mtimeMs !== sourceStats.mtimeMs) {
            throw new Error('生成缩略图期间文件发生变化，请重试')
          }
          await saveToCache(key, {
            key,
            edge,
            sourceSize: sourceStats.size,
            sourceMtimeMs: sourceStats.mtimeMs
          }, generated).catch(() => undefined)
          return generated
        } catch (error) {
          if (failedUntil.size >= CACHE_FILE_LIMIT) failedUntil.clear()
          failedUntil.set(key, Date.now() + 10 * 60_000)
          throw error
        }
      })()
      inFlight.set(key, generation)
      try {
        jpeg = await generation
      } finally {
        inFlight.delete(key)
      }
    }
  }

  const output = nativeImage.createFromBuffer(jpeg)
  if (output.isEmpty()) throw new Error('缩略图缓存内容无效')
  const resized = resizeToFit(output, RESULT_EDGE).toJPEG(JPEG_QUALITY)
  return { dataUrl: `data:image/jpeg;base64,${resized.toString('base64')}` }
}

async function getThumbnails(rawPaths: string[], requestedEdge?: number): Promise<Array<{ path: string; dataUrl: string | null }>> {
  if (!Array.isArray(rawPaths)) throw new Error('paths 必须是数组')
  const paths = [...new Set(rawPaths.filter((path): path is string => typeof path === 'string' && Boolean(path.trim())))].slice(0, 64)
  return Promise.all(paths.map(async (path) => {
    try {
      const result = await getThumbnail(path, requestedEdge)
      return { path, dataUrl: result.dataUrl }
    } catch {
      return { path, dataUrl: null }
    }
  }))
}

function iconCacheKey(path: string): string {
  const extension = extname(path).toLowerCase()
  if (!extension || PER_FILE_ICON_EXTENSIONS.has(extension.slice(1))) return path
  return `extension:${extension}`
}

async function loadSystemIcon(path: string): Promise<string> {
  const icon = await app.getFileIcon(path, { size: 'large' })
  if (icon.isEmpty()) throw new Error('系统未能提供该文件的图标')
  return `data:image/png;base64,${icon.toPNG().toString('base64')}`
}

async function getSystemIcon(rawPath: string): Promise<{ dataUrl: string }> {
  if (typeof rawPath !== 'string' || !rawPath.trim()) throw new Error('path 必须是非空绝对路径')
  const path = normalize(rawPath)
  const key = iconCacheKey(path)
  const cached = iconCache.get(key)
  if (cached) return { dataUrl: cached }

  let pending = iconRequests.get(key)
  if (!pending) {
    pending = (async () => {
      const stats = await fs.stat(path)
      if (!stats.isFile() && !stats.isDirectory()) throw new Error('该路径不支持系统图标')
      const dataUrl = await loadSystemIcon(path)
      if (iconCache.size >= ICON_CACHE_LIMIT) {
        const oldest = iconCache.keys().next().value
        if (oldest !== undefined) iconCache.delete(oldest)
      }
      iconCache.set(key, dataUrl)
      return dataUrl
    })()
    iconRequests.set(key, pending)
    pending.finally(() => iconRequests.delete(key)).catch(() => undefined)
  }
  return { dataUrl: await pending }
}

const thumbnailsPlugin: Plugin = {
  name: 'data-provider-thumbnails',
  inject: ['ipc', 'settings', 'storage'],
  apply(ctx: Context): void {
    ctx.storage.register('data-provider-thumbnails', {
      title: '缩略图缓存',
      entries: [{ label: '缩略图缓存文件', relativePath: CACHE_DIR_NAME, kind: 'directory' }]
    })
    const settingsSchema = z.object({ cacheMiB: z.number().int().min(32).max(2048).default(512).describe('缩略图磁盘缓存预算（MiB）') })
    ctx.settings.register('thumbnails', settingsSchema, { cacheMiB: 512 }, { title: '缩略图缓存', description: '磁盘缓存预算；超出时按最近使用时间回收', group: '数据服务' })
    void ctx.settings.get('thumbnails').then((value) => { cacheByteLimit = Number(value.cacheMiB) * 1024 * 1024 })
    ctx.settings.subscribe((namespace, value) => {
      if (namespace !== 'thumbnails') return
      cacheByteLimit = Number(value.cacheMiB) * 1024 * 1024
      void ensureCache().then(() => withWriteLock(() => pruneCache())).catch(() => undefined)
    })
    ctx.ipc.handle('thumbnails', {
      get: (path: string, edge?: number) => getThumbnail(path, edge),
      getMany: (paths: string[], edge?: number) => getThumbnails(paths, edge)
    })
    ctx.ipc.handle('fileIcons', {
      get: (path: string) => getSystemIcon(path)
    })
  }
}

export default thumbnailsPlugin
