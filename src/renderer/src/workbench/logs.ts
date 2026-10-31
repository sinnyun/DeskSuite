import { useSyncExternalStore } from 'react'

export type LogLevel = 'info' | 'warn' | 'error' | 'event' | 'lifecycle'
export type LogCategory = 'action' | 'transfer' | 'processing' | 'result' | 'system'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
  category?: LogCategory
  traceId?: string
  phase?: string
  durationMs?: number
  status?: 'running' | 'ok' | 'error'
}

export interface LogInput {
  id?: string
  timestamp?: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
  category?: LogCategory
  traceId?: string
  phase?: string
  durationMs?: number
  status?: 'running' | 'ok' | 'error'
}

const MAX_ENTRIES = 3000
const MAX_PAYLOAD_CHARS = 48_000
const SECRET_KEY = /(password|passwd|token|secret|authorization|cookie|credential|private[-_]?key|api[-_]?key)/i

function safePayload(value: unknown, depth = 0): unknown {
  if (depth > 8) return '[深度限制]'
  if (typeof value === 'string') {
    const dataUrl = value.match(/^data:([^;,]+);base64,/)
    if (dataUrl) return `[二进制数据 ${dataUrl[1]}，约 ${Math.floor((value.length - value.indexOf(',') - 1) * 0.75)} 字节]`
    return value.length > 12_000 ? `${value.slice(0, 12_000)}…[字符串已截断，共 ${value.length} 字符]` : value
  }
  if (value === null || typeof value !== 'object') return value
  if (Array.isArray(value)) {
    const items = value.slice(0, 100).map((item) => safePayload(item, depth + 1))
    if (value.length > 100) items.push(`[其余 ${value.length - 100} 项已省略]`)
    return items
  }
  const entries = Object.entries(value as Record<string, unknown>).slice(0, 200)
  const result: Record<string, unknown> = {}
  for (const [key, item] of entries) result[key] = SECRET_KEY.test(key) ? '[已脱敏]' : safePayload(item, depth + 1)
  const keyCount = Object.keys(value).length
  if (keyCount > entries.length) result.__truncatedKeys = keyCount - entries.length
  return result
}

function boundedPayload(value: LogInput['payload']): LogInput['payload'] {
  if (value === undefined || value === null) return value
  const safe = safePayload(value)
  try {
    const serialized = JSON.stringify(safe)
    if (serialized.length <= MAX_PAYLOAD_CHARS) return safe as LogInput['payload']
    return {
      __truncated: true,
      preview: serialized.slice(0, MAX_PAYLOAD_CHARS),
      originalChars: serialized.length,
      hint: '载荷超过 48 KB；已保留预览以控制调试缓冲区占用'
    }
  } catch {
    return String(value).slice(0, 12_000)
  }
}

function stamp(): string {
  const now = new Date()
  return `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(2, '0')}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`
}

class LogStore {
  private entries: LogEntry[] = []
  private ids = new Set<string>()
  private listeners = new Set<() => void>()
  private seq = 0

  getSnapshot = (): LogEntry[] => this.entries

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  push(input: LogInput): void {
    const id = input.id ?? `ui-${Date.now()}-${this.seq++}`
    if (this.ids.has(id)) return
    this.ids.add(id)
    const entry: LogEntry = {
      id,
      timestamp: input.timestamp ?? stamp(),
      level: input.level,
      source: input.source,
      message: input.message.length > 4000 ? `${input.message.slice(0, 4000)}…[消息已截断]` : input.message,
      payload: boundedPayload(input.payload),
      tags: input.tags,
      category: input.category,
      traceId: input.traceId,
      phase: input.phase,
      durationMs: input.durationMs,
      status: input.status
    }
    this.entries = [entry, ...this.entries].slice(0, MAX_ENTRIES)
    if (this.entries.length === MAX_ENTRIES) {
      this.ids = new Set(this.entries.map((item) => item.id))
    }
    this.emit()
  }

  clear = (): void => {
    this.entries = []
    this.ids.clear()
    this.emit()
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }
}

export const logStore = new LogStore()

export function log(
  level: LogLevel,
  source: string,
  message: string,
  payload?: LogInput['payload'],
  tags?: string[],
  metadata?: Pick<LogInput, 'category' | 'traceId' | 'phase' | 'durationMs' | 'status'>
): void {
  const category: LogCategory = level === 'event' ? 'action' : level === 'error' || level === 'warn' ? 'result' : 'system'
  logStore.push({ level, source, message, payload, tags, category, ...metadata })
}

export function useLogs(): LogEntry[] {
  return useSyncExternalStore(logStore.subscribe, logStore.getSnapshot)
}
