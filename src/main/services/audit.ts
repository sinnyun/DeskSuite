import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, open } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Service } from 'cordis'
import { z } from 'zod'
import { sanitizeErrorText } from './error-text.ts'
import { boundedSafeData } from './safe-data.ts'

export type AuditOrigin = 'ui' | 'mcp' | 'command'

export interface AuditEntry {
  ts: number
  origin: AuditOrigin
  tool: string
  access?: 'off' | 'read' | 'standard' | 'full'
  allowed?: boolean
  planId?: string
  items?: number
  results?: unknown
  error?: string
}

const auditEntrySchema = z.object({
  ts: z.number().finite().nonnegative(),
  origin: z.enum(['ui', 'mcp', 'command']),
  tool: z.string().min(1).max(512),
  access: z.enum(['off', 'read', 'standard', 'full']).optional(),
  allowed: z.boolean().optional(),
  planId: z.string().max(512).optional(),
  items: z.number().int().nonnegative().optional(),
  results: z.unknown().optional(),
  error: z.string().max(10_000).optional()
}).strict()
const MAX_AUDIT_RESULTS_BYTES = 48 * 1024
const MAX_AUDIT_LINE_CHARS = 256 * 1024
const MAX_AUDIT_TAIL_BYTES = 4 * 1024 * 1024
const MAX_AUDIT_TAIL_LINES = 20_000
const AUDIT_READ_CHUNK_BYTES = 16 * 1024

interface AuditTailBudget {
  bytes: number
  lines: number
}

async function readAuditTailFile(file: string, budget: AuditTailBudget, maxEntries: number): Promise<AuditEntry[]> {
  if (budget.bytes <= 0 || budget.lines <= 0 || maxEntries <= 0) return []
  let handle: Awaited<ReturnType<typeof open>> | undefined
  try {
    handle = await open(file, 'r')
    let position = (await handle.stat()).size
    let pending = Buffer.alloc(0)
    let firstChunk = true
    const entries: AuditEntry[] = []

    const parseLine = (bytes: Buffer): void => {
      budget.lines -= 1
      if (bytes.length === 0 || bytes.length > MAX_AUDIT_LINE_CHARS * 4) return
      const line = bytes.toString('utf8')
      if (!line.trim() || line.length > MAX_AUDIT_LINE_CHARS) return
      try {
        const parsed: unknown = JSON.parse(line)
        const entry = auditEntrySchema.safeParse(parsed)
        if (entry.success) entries.push({
          ...entry.data,
          results: entry.data.results === undefined ? undefined : boundedSafeData(entry.data.results, MAX_AUDIT_RESULTS_BYTES, '审计结果超过 48 KiB 限制'),
          error: entry.data.error === undefined ? undefined : sanitizeErrorText(entry.data.error)
        })
      } catch {
        // Ignore malformed or over-budget rows while preserving newer valid rows.
      }
    }

    while (position > 0 && budget.bytes > 0 && budget.lines > 0 && entries.length < maxEntries) {
      const chunkSize = Math.min(AUDIT_READ_CHUNK_BYTES, position, budget.bytes)
      const start = position - chunkSize
      const chunk = Buffer.allocUnsafe(chunkSize)
      const { bytesRead } = await handle.read(chunk, 0, chunkSize, start)
      if (bytesRead <= 0) break
      budget.bytes -= bytesRead
      if (bytesRead !== chunkSize) break
      position = start
      pending = Buffer.concat([chunk, pending])

      if (firstChunk) {
        firstChunk = false
        // A final newline terminates the last row; it is not an additional blank row.
        if (pending[pending.length - 1] === 0x0a) pending = pending.subarray(0, -1)
      }

      while (budget.lines > 0 && entries.length < maxEntries) {
        const newline = pending.lastIndexOf(0x0a)
        if (newline < 0) break
        parseLine(pending.subarray(newline + 1))
        pending = pending.subarray(0, newline)
      }
    }

    // Only parse the remaining prefix when the read reached the start of the file;
    // otherwise it may be a partial row cut by the total byte budget.
    if (position === 0 && budget.bytes >= 0 && budget.lines > 0 && entries.length < maxEntries && pending.length > 0) {
      parseLine(pending)
    }
    return entries
  } catch {
    return []
  } finally {
    await handle?.close().catch(() => {})
  }
}

declare module 'cordis' {
  interface Context {
    audit: AuditService
  }
}

function dayKey(ts: number): string {
  const date = new Date(ts)
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${date.getFullYear()}-${month}-${day}`
}

export class AuditService extends Service {
  private readonly dir: string
  private readonly streams = new Map<string, WriteStream>()
  private chain: Promise<void> = Promise.resolve()

  constructor(ctx: Context, dir: string) {
    super(ctx, 'audit')
    this.dir = dir
  }

  async start(): Promise<void> {
    await mkdir(this.dir, { recursive: true })
  }

  record(entry: Omit<AuditEntry, 'ts'> & { ts?: number }): void {
    try {
      const full: AuditEntry = {
        ...entry,
        ts: entry.ts ?? Date.now(),
        results: entry.results === undefined ? undefined : boundedSafeData(entry.results, MAX_AUDIT_RESULTS_BYTES, '审计结果超过 48 KiB 限制'),
        error: entry.error === undefined ? undefined : sanitizeErrorText(entry.error)
      }
      const day = dayKey(full.ts)
      const stream = this.streamFor(day)
      const line = `${JSON.stringify(full)}\n`
      this.enqueue(
        () =>
          new Promise<void>((resolve) => {
            if (stream.destroyed || stream.writableEnded) {
              resolve()
              return
            }
            stream.write(line, (err) => {
              if (err) console.error('[audit] 写入审计日志失败', err)
              resolve()
            })
          })
      )
    } catch (err) {
      // 审计失败不能影响业务：记录异常后照常返回
      console.error('[audit] 记录审计日志失败', err)
    }
  }

  async flush(): Promise<void> {
    try {
      await this.chain
    } catch (err) {
      console.error('[audit] 刷新审计日志失败', err)
    }
    const pending = [...this.streams.values()]
    this.streams.clear()
    await Promise.all(pending.map((stream) => this.endStream(stream)))
  }

  async tail(limit = 100): Promise<AuditEntry[]> {
    const now = Date.now()
    const files = [
      join(this.dir, `audit-${dayKey(now)}.jsonl`),
      join(this.dir, `audit-${dayKey(now - 86_400_000)}.jsonl`)
    ]
    const requestedLimit = Number.isSafeInteger(limit) ? limit : 100
    const budget: AuditTailBudget = { bytes: MAX_AUDIT_TAIL_BYTES, lines: MAX_AUDIT_TAIL_LINES }
    const entries: AuditEntry[] = []
    for (const file of files) {
      const remainingEntries = requestedLimit > 0 ? Math.max(0, requestedLimit - entries.length) : MAX_AUDIT_TAIL_LINES
      entries.push(...await readAuditTailFile(file, budget, remainingEntries))
      if ((requestedLimit > 0 && entries.length >= requestedLimit) || budget.bytes <= 0 || budget.lines <= 0) break
    }
    entries.sort((a, b) => a.ts - b.ts)
    return requestedLimit >= 0 ? entries.slice(-requestedLimit) : entries
  }

  private streamFor(day: string): WriteStream {
    const existing = this.streams.get(day)
    if (existing && !existing.destroyed && !existing.closed) return existing

    for (const [key, stream] of this.streams) {
      if (key === day) continue
      this.streams.delete(key)
      this.enqueue(() => this.endStream(stream))
    }

    const file = join(this.dir, `audit-${day}.jsonl`)
    const stream = createWriteStream(file, { flags: 'a' })
    stream.on('error', (err) => {
      console.error(`[audit] 审计日志流异常：${file}`, err)
      if (this.streams.get(day) === stream) this.streams.delete(day)
    })
    this.streams.set(day, stream)
    return stream
  }

  private enqueue(task: () => Promise<void>): void {
    this.chain = this.chain.then(task).catch((err) => {
      console.error('[audit] 审计日志写入队列失败', err)
    })
  }

  private endStream(stream: WriteStream): Promise<void> {
    return new Promise<void>((resolve) => {
      if (stream.closed || stream.destroyed || stream.writableEnded) {
        resolve()
        return
      }
      stream.once('close', () => resolve())
      stream.end()
    })
  }
}
