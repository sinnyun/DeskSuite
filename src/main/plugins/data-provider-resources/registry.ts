import { createHash, randomUUID } from 'node:crypto'
import { open, realpath, stat } from 'node:fs/promises'
import type { FileHandle } from 'node:fs/promises'
import type { Stats } from 'node:fs'
import { basename, extname, isAbsolute } from 'node:path'
import type { Context } from 'cordis'
import { z } from 'zod'
import { identity } from '../../services/paths'
import { resourceFormat } from './mime'
import type { ResourceBytes, ResourceInfo, ResourceRecord, ResourcesService } from './types'

export const SCHEME = 'desksuite-resource'
const key = 'resource-links'
const idSchema = z.string().uuid()
const recordSchema = z.object({ id: idSchema, path: z.string().min(1), name: z.string().min(1), extension: z.string(), registeredAt: z.number() })
const registrySchema = z.array(recordSchema).max(50000)
export const MAX_READ = 1024 * 1024

function validFilePath(value: unknown): value is string {
  if (typeof value !== 'string' || !isAbsolute(value) || value.includes('\0') || /:/.test(value.slice(2))) return false
  if (value.startsWith('\\\\')) return /^\\\\[^\\/:*?"<>|.][^\\/:*?"<>|]*\\[^\\/:*?"<>|]+(?:\\|$)/.test(value)
  return !value.startsWith('//')
}

export class ResourceError extends Error {
  constructor(public code: string, message: string, public status = 400) { super(message) }
}

export function uriFor(record: ResourceRecord): string {
  return `${SCHEME}://local/${record.id}/content${record.extension ? '.' + record.extension : ''}`
}

export function revisionOf(stats: Stats): string {
  return createHash('sha256').update([stats.dev, stats.ino, stats.size, stats.mtimeMs, stats.ctimeMs].join(':')).digest('hex').slice(0, 24)
}

export function referenceId(reference: unknown): string {
  if (typeof reference !== 'string') throw new ResourceError('invalid-reference', '资源引用必须为 ID 或统一链接')
  if (idSchema.safeParse(reference).success) return reference
  let url: URL
  try { url = new URL(reference) } catch { throw new ResourceError('invalid-reference', '资源链接无效') }
  const match = url.pathname.match(/^\/([a-f0-9-]+)\/content(?:\.[a-z0-9]{1,24})?$/)
  if (url.protocol !== `${SCHEME}:` || url.host !== 'local' || url.username || url.password || url.hash || !match || !idSchema.safeParse(match[1]).success || [...url.searchParams.keys()].some((key) => key !== 'v') || url.searchParams.getAll('v').length > 1) {
    throw new ResourceError('invalid-reference', '不是有效的 DeskSuite 资源链接')
  }
  return match[1]
}

export class ResourceRegistry implements ResourcesService {
  private current: ResourceRecord[] = []
  private ready: Promise<void>
  private mutations: Promise<void> = Promise.resolve()

  constructor(private ctx: Context) {
    ctx.store.register(key, { schema: registrySchema, default: [], version: 1 })
    this.ready = ctx.store.read<ResourceRecord[]>(key).then((records) => { this.current = records })
  }

  private async records(): Promise<ResourceRecord[]> { await this.ready; return this.current }

  // This plugin is the sole owner. Keep reads in memory so rapid UI refreshes do
  // not hold the Windows JSON file open during an atomic rename.
  private async mutate(fn: (records: ResourceRecord[]) => ResourceRecord[]): Promise<void> {
    const task = this.mutations.then(async () => {
      await this.ready
      const next = fn(this.current)
      if (next !== this.current) {
        await this.ctx.store.write(key, next)
        this.current = next
      }
    })
    this.mutations = task.catch(() => {})
    await task
  }

  async find(reference: string): Promise<ResourceRecord> {
    const id = referenceId(reference)
    const record = (await this.records()).find((record) => record.id === id)
    if (!record) throw new ResourceError('unknown-resource', '资源未登记或已取消登记', 404)
    if (reference.includes('://')) {
      const url = new URL(reference)
      if (url.origin + url.pathname !== new URL(uriFor(record)).origin + new URL(uriFor(record)).pathname) {
        throw new ResourceError('invalid-reference', '资源链接路径不匹配')
      }
    }
    return record
  }

  async register(rawPath: string): Promise<ResourceInfo> {
    if (!validFilePath(rawPath)) {
      throw new ResourceError('invalid-path', '请提供普通文件的本地绝对路径或共享路径，不支持设备或数据流路径')
    }
    const path = await realpath(rawPath)
    if (!validFilePath(path)) throw new ResourceError('invalid-path', '不支持通过链接登记设备或数据流文件')
    if (!(await stat(path)).isFile()) throw new ResourceError('not-file', '只能登记普通文件')
    let registered!: ResourceRecord
    await this.mutate((records) => {
      const existing = records.find((record) => identity(record.path) === identity(path))
      registered = existing ?? {
        id: randomUUID(), path, name: basename(path),
        extension: extname(path).slice(1).toLowerCase().replace(/[^a-z0-9]/g, '').slice(0, 24), registeredAt: Date.now()
      }
      return existing ? records : [...records, registered]
    })
    const resource = await this.describe(registered)
    this.ctx.ipc.broadcast('resources:changed', { id: resource.id, action: 'register' })
    return resource
  }

  private async describe(record: ResourceRecord): Promise<ResourceInfo> {
    const uri = uriFor(record)
    let stats: Stats | null = null
    try {
      const real = await realpath(record.path)
      if (identity(real) === identity(record.path)) {
        const candidate = await stat(record.path)
        if (candidate.isFile()) stats = candidate
      }
    } catch { /* Missing/unreadable/rebound sources remain registered and visible as unavailable. */ }
    const revision = stats ? revisionOf(stats) : null
    return { ...record, ...resourceFormat(record.extension), uri, url: revision ? `${uri}?v=${revision}` : uri, available: !!stats, size: stats?.size ?? null, modifiedAt: stats?.mtimeMs ?? null, revision }
  }

  async resolve(reference: string): Promise<ResourceInfo> { return this.describe(await this.find(reference)) }

  async list(): Promise<ResourceInfo[]> {
    const records = await this.records()
    const result: ResourceInfo[] = []
    // Bound filesystem concurrency rather than opening every registered source at once.
    for (let index = 0; index < records.length; index += 32) result.push(...await Promise.all(records.slice(index, index + 32).map((record) => this.describe(record))))
    return result
  }

  async forget(reference: string): Promise<boolean> {
    const record = await this.find(reference)
    let removed = false
    await this.mutate((records) => records.filter((item) => {
      if (item.id !== record.id) return true
      removed = true
      return false
    }))
    this.ctx.ipc.broadcast('resources:changed', { id: record.id, action: 'forget' })
    return removed
  }

  async open(reference: string): Promise<{ handle: FileHandle; resource: ResourceInfo; stats: Stats }> {
    const record = await this.find(reference)
    let handle: FileHandle | undefined
    try {
      if (identity(await realpath(record.path)) !== identity(record.path)) throw new ResourceError('rebound-source', '资源路径已被重定向，请重新登记', 409)
      handle = await open(record.path, 'r')
      const stats = await handle.stat()
      const current = await stat(record.path)
      if (!stats.isFile() || stats.dev !== current.dev || stats.ino !== current.ino || identity(await realpath(record.path)) !== identity(record.path)) throw new ResourceError('changed-source', '读取期间资源发生变化，请重试', 409)
      const revision = revisionOf(stats)
      const resource: ResourceInfo = { ...record, ...resourceFormat(record.extension), uri: uriFor(record), url: `${uriFor(record)}?v=${revision}`, available: true, revision, size: stats.size, modifiedAt: stats.mtimeMs }
      const requestedVersion = reference.includes('://') ? new URL(reference).searchParams.get('v') : null
      if (requestedVersion && requestedVersion !== revision) throw new ResourceError('stale-version', '资源已修改，请重新解析资源链接', 409)
      return { handle, resource, stats }
    } catch (error) {
      await handle?.close()
      if (error instanceof ResourceError) throw error
      throw new ResourceError('source-unavailable', '资源原文件不存在或无法读取', 404)
    }
  }

  async read(reference: string, offset = 0, length = 64 * 1024): Promise<ResourceBytes> {
    if (!Number.isSafeInteger(offset) || offset < 0 || !Number.isSafeInteger(length) || length < 1 || length > MAX_READ) throw new ResourceError('invalid-range', '读取偏移必须为非负整数，单次长度为 1–1048576 字节')
    const { handle, resource, stats } = await this.open(reference)
    try {
      const buffer = Buffer.alloc(Math.min(length, Math.max(0, stats.size - offset)))
      const { bytesRead } = buffer.length ? await handle.read(buffer, 0, buffer.length, offset) : { bytesRead: 0 }
      if (revisionOf(await handle.stat()) !== resource.revision) throw new ResourceError('changed-source', '读取期间文件发生变化，请重试', 409)
      return { id: resource.id, revision: resource.revision!, offset, total: stats.size, base64: buffer.subarray(0, bytesRead).toString('base64'), eof: offset + bytesRead >= stats.size }
    } finally { await handle.close() }
  }

  async readText(reference: string): Promise<{ resource: ResourceInfo; text: string }> {
    const resource = await this.resolve(reference)
    if (!['text', 'markdown'].includes(resource.kind)) throw new ResourceError('not-text', '此格式不属于文本资源，请按二进制读取')
    if (!resource.available || resource.size === null) throw new ResourceError('source-unavailable', '资源原文件不存在或无法读取', 404)
    if (resource.size > MAX_READ) throw new ResourceError('too-large', '文本预览最多读取 1 MiB，请使用分段读取')
    const value = await this.read(resource.url, 0, MAX_READ)
    return { resource, text: new TextDecoder('utf-8').decode(Buffer.from(value.base64, 'base64')) }
  }
}
