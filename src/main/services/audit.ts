import { createWriteStream, type WriteStream } from 'node:fs'
import { mkdir, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Service } from 'cordis'

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
      const full: AuditEntry = { ...entry, ts: entry.ts ?? Date.now() }
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
    const entries: AuditEntry[] = []
    for (const file of files) {
      let raw: string
      try {
        raw = await readFile(file, 'utf8')
      } catch {
        continue
      }
      for (const line of raw.split('\n')) {
        if (!line.trim()) continue
        try {
          entries.push(JSON.parse(line) as AuditEntry)
        } catch {
          // 坏行（进程被杀导致的半行）跳过，不影响其余记录
        }
      }
    }
    entries.sort((a, b) => a.ts - b.ts)
    return limit >= 0 ? entries.slice(-limit) : entries
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
