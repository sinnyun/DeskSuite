import { copyFile, mkdir, open, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { z } from 'zod'

export interface StoreDefinition<T> {
  schema: z.ZodType<T>
  default: T
  version?: number
  /** Maximum serialized UTF-8 document size. Defaults to 32 MiB. */
  maxBytes?: number
}

export class StoreError extends Error {
  code: 'unregistered' | 'invalid-key' | 'invalid-value' | 'invalid-budget' | 'version-too-new'

  constructor(
    code: 'unregistered' | 'invalid-key' | 'invalid-value' | 'invalid-budget' | 'version-too-new',
    message: string,
    options?: { cause?: unknown }
  ) {
    super(message, options)
    this.name = 'StoreError'
    this.code = code
  }
}

interface StoreEntry {
  schema: z.ZodType
  fallback: unknown
  version: number
  relativePath: string
  maxBytes: number
}

interface Envelope {
  version: number
  data: unknown
}

type ReadResult = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' }

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
export const DEFAULT_STORE_DOCUMENT_MAX_BYTES = 32 * 1024 * 1024
const MAX_STORE_DOCUMENT_MAX_BYTES = 512 * 1024 * 1024

function isEnoent(error: unknown): boolean {
  return typeof error === 'object' && error !== null && (error as NodeJS.ErrnoException).code === 'ENOENT'
}

function parseEnvelope(raw: string): Envelope | null {
  try {
    const value: unknown = JSON.parse(raw)
    if (typeof value !== 'object' || value === null || Array.isArray(value)) return null
    const record = value as Record<string, unknown>
    if (typeof record.version !== 'number' || !Number.isInteger(record.version)) return null
    if (!Object.prototype.hasOwnProperty.call(record, 'data')) return null
    return { version: record.version, data: record.data }
  } catch {
    return null
  }
}

export class StoreService extends Service {
  private dir: string
  private entries = new Map<string, StoreEntry>()
  private queues = new Map<string, Promise<void>>()

  constructor(ctx: Context, dir: string) {
    super(ctx, 'store')
    this.dir = dir
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  register<T>(key: string, def: StoreDefinition<T>): void {
    this.registerDocument(key, `${key}.json`, def)
  }

  /** Register a versioned JSON document below the store root. Path segments are restricted to prevent escape. */
  registerDocument<T>(key: string, relativePath: string, def: StoreDefinition<T>): void {
    this.assertKey(key)
    const maxBytes = def.maxBytes ?? DEFAULT_STORE_DOCUMENT_MAX_BYTES
    if (!Number.isSafeInteger(maxBytes) || maxBytes < 1 || maxBytes > MAX_STORE_DOCUMENT_MAX_BYTES) {
      throw new StoreError('invalid-budget', `store 文档「${key}」的字节预算须为 1 到 ${MAX_STORE_DOCUMENT_MAX_BYTES} 字节`)
    }
    const segments = relativePath.split(/[\\/]/)
    if (
      isAbsolute(relativePath) ||
      segments.length === 0 ||
      segments.some((segment) => !segment || segment === '.' || segment === '..' || !/^[a-zA-Z0-9._-]+$/.test(segment))
    ) {
      throw new StoreError('invalid-key', `非法的 store 文档路径：${relativePath}`)
    }
    const target = resolve(this.dir, ...segments)
    const fromRoot = relative(this.dir, target)
    if (fromRoot === '..' || fromRoot.startsWith(`..${sep}`) || isAbsolute(fromRoot)) {
      throw new StoreError('invalid-key', `store 文档路径超出根目录：${relativePath}`)
    }
    this.entries.set(key, {
      schema: def.schema,
      fallback: def.default,
      version: def.version ?? 1,
      relativePath: segments.join(sep),
      maxBytes
    })
  }

  has(key: string): boolean {
    return this.entries.has(key)
  }

  listKeys(): string[] {
    return [...this.entries.keys()]
  }

  /** Absolute path of a registered document, for diagnostics and storage inventory. */
  resolvePath(key: string): string {
    return this.fileFor(key, this.requireEntry(key))
  }

  listDocuments(): { key: string; path: string }[] {
    return [...this.entries].map(([key, entry]) => ({ key, path: this.fileFor(key, entry) }))
  }

  async read<T>(key: string): Promise<T> {
    const entry = this.requireEntry(key)
    return (await this.load(key, entry)) as T
  }

  async write<T>(key: string, value: T): Promise<void> {
    const entry = this.requireEntry(key)
    await this.enqueue(key, () => this.writeNow(key, entry, value))
  }

  async update<T>(key: string, fn: (current: T) => T | Promise<T>): Promise<T> {
    const entry = this.requireEntry(key)
    return this.enqueue(key, async () => {
      const current = (await this.load(key, entry)) as T
      const next = await fn(current)
      await this.writeNow(key, entry, next)
      return next
    })
  }

  private assertKey(key: string): void {
    if (!KEY_PATTERN.test(key)) {
      throw new StoreError('invalid-key', `非法的 store key：${key}`)
    }
  }

  private requireEntry(key: string): StoreEntry {
    this.assertKey(key)
    const entry = this.entries.get(key)
    if (!entry) throw new StoreError('unregistered', `store key "${key}" 未注册`)
    return entry
  }

  private fileFor(key: string, entry: StoreEntry): string {
    return join(this.dir, entry.relativePath || `${key}.json`)
  }

  private async load(key: string, entry: StoreEntry): Promise<unknown> {
    const file = this.fileFor(key, entry)
    const main = await this.readCandidate(file, entry)
    if (main.status === 'ok') return main.value
    if (main.status === 'missing') return entry.fallback
    const backup = await this.readCandidate(`${file}.bak`, entry)
    if (backup.status === 'ok') return backup.value
    return entry.fallback
  }

  private async readCandidate(file: string, entry: StoreEntry): Promise<ReadResult> {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(file, 'r')
    } catch (error) {
      return isEnoent(error) ? { status: 'missing' } : { status: 'corrupt' }
    }
    let raw: string | null = null
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > entry.maxBytes) return { status: 'corrupt' }
      // Read at most the stat size plus one byte. This catches a file that grows
      // after stat without allowing a race to bypass the registered byte budget.
      const buffer = Buffer.allocUnsafe(Math.min(info.size + 1, entry.maxBytes + 1))
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
        if (offset > entry.maxBytes) return { status: 'corrupt' }
      }
      if (offset !== info.size) return { status: 'corrupt' }
      raw = buffer.subarray(0, offset).toString('utf8')
    } catch {
      return { status: 'corrupt' }
    } finally {
      await handle.close().catch(() => {})
    }
    if (raw === null) return { status: 'corrupt' }
    const envelope = parseEnvelope(raw)
    if (!envelope) return { status: 'corrupt' }
    if (envelope.version > entry.version) {
      throw new StoreError(
        'version-too-new',
        `store 文件 ${file} 的版本 ${envelope.version} 高于已注册版本 ${entry.version}`
      )
    }
    const parsed = entry.schema.safeParse(envelope.data)
    if (!parsed.success) return { status: 'corrupt' }
    return { status: 'ok', value: parsed.data }
  }

  private async writeNow(key: string, entry: StoreEntry, value: unknown): Promise<void> {
    const file = this.fileFor(key, entry)
    const preserveCurrentAsBackup = await this.assertStoredVersion(file, entry)
    const parsed = entry.schema.safeParse(value)
    if (!parsed.success) {
      throw new StoreError('invalid-value', `store "${key}" 的值不符合 schema：${parsed.error.message}`, {
        cause: parsed.error
      })
    }
    const serialized = JSON.stringify({ version: entry.version, data: parsed.data }, null, 2)
    const byteLength = Buffer.byteLength(serialized, 'utf8')
    if (byteLength > entry.maxBytes) {
      throw new StoreError('invalid-value', `store「${key}」序列化后为 ${byteLength} 字节，超过 ${entry.maxBytes} 字节上限`)
    }
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    if (preserveCurrentAsBackup) {
      try {
        await copyFile(file, `${file}.bak`)
      } catch (error) {
        if (!isEnoent(error)) throw error
      }
    }
    await rename(tmp, file)
  }

  private async assertStoredVersion(file: string, entry: StoreEntry): Promise<boolean> {
    let handle: Awaited<ReturnType<typeof open>>
    try {
      handle = await open(file, 'r')
    } catch (error) {
      if (isEnoent(error)) return false
      // Preserve the prior failure behavior: let the atomic write/copy surface
      // any access failure instead of treating an unreadable file as a version.
      return true
    }
    let raw: string | null = null
    try {
      const info = await handle.stat()
      if (!info.isFile() || info.size > entry.maxBytes) return false
      const buffer = Buffer.allocUnsafe(Math.min(info.size + 1, entry.maxBytes + 1))
      let offset = 0
      while (offset < buffer.length) {
        const { bytesRead } = await handle.read(buffer, offset, buffer.length - offset, offset)
        if (bytesRead === 0) break
        offset += bytesRead
        if (offset > entry.maxBytes) return false
      }
      if (offset !== info.size) return false
      raw = buffer.subarray(0, offset).toString('utf8')
    } catch {
      return true
    } finally {
      await handle.close().catch(() => {})
    }
    if (raw === null) return false
    const envelope = parseEnvelope(raw)
    if (envelope && envelope.version > entry.version) {
      throw new StoreError(
        'version-too-new',
        `store 文件 ${file} 的版本 ${envelope.version} 高于已注册版本 ${entry.version}，拒绝覆盖`
      )
    }
    return true
  }

  private enqueue<T>(key: string, task: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const result = previous.then(task, task)
    const tail = result.then(
      () => undefined,
      () => undefined
    )
    this.queues.set(key, tail)
    void tail.then(() => {
      if (this.queues.get(key) === tail) this.queues.delete(key)
    })
    return result
  }
}

declare module 'cordis' {
  interface Context {
    store: StoreService
  }
}
