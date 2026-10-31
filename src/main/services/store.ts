import { copyFile, mkdir, open, readFile, rename } from 'node:fs/promises'
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { Service } from 'cordis'
import type { Context } from 'cordis'
import type { z } from 'zod'

export interface StoreDefinition<T> {
  schema: z.ZodType<T>
  default: T
  version?: number
}

export class StoreError extends Error {
  code: 'unregistered' | 'invalid-key' | 'invalid-value' | 'version-too-new'

  constructor(
    code: 'unregistered' | 'invalid-key' | 'invalid-value' | 'version-too-new',
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
}

interface Envelope {
  version: number
  data: unknown
}

type ReadResult = { status: 'ok'; value: unknown } | { status: 'missing' } | { status: 'corrupt' }

const KEY_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

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
      relativePath: segments.join(sep)
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
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch (error) {
      return isEnoent(error) ? { status: 'missing' } : { status: 'corrupt' }
    }
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
    await this.assertStoredVersion(file, entry)
    const parsed = entry.schema.safeParse(value)
    if (!parsed.success) {
      throw new StoreError('invalid-value', `store "${key}" 的值不符合 schema：${parsed.error.message}`, {
        cause: parsed.error
      })
    }
    const serialized = JSON.stringify({ version: entry.version, data: parsed.data }, null, 2)
    await mkdir(dirname(file), { recursive: true })
    const tmp = `${file}.tmp`
    const handle = await open(tmp, 'w')
    try {
      await handle.writeFile(serialized, 'utf8')
      await handle.sync()
    } finally {
      await handle.close()
    }
    try {
      await copyFile(file, `${file}.bak`)
    } catch (error) {
      if (!isEnoent(error)) throw error
    }
    await rename(tmp, file)
  }

  private async assertStoredVersion(file: string, entry: StoreEntry): Promise<void> {
    let raw: string
    try {
      raw = await readFile(file, 'utf8')
    } catch {
      return
    }
    const envelope = parseEnvelope(raw)
    if (envelope && envelope.version > entry.version) {
      throw new StoreError(
        'version-too-new',
        `store 文件 ${file} 的版本 ${envelope.version} 高于已注册版本 ${entry.version}，拒绝覆盖`
      )
    }
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
