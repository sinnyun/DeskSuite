import { useSyncExternalStore } from 'react'

export type LogLevel = 'info' | 'warn' | 'error' | 'event' | 'lifecycle'

export interface LogEntry {
  id: string
  timestamp: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
}

export interface LogInput {
  id?: string
  timestamp?: string
  level: LogLevel
  source: string
  message: string
  payload?: Record<string, unknown> | string | number | boolean | null
  tags?: string[]
}

const MAX_ENTRIES = 500

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
      message: input.message,
      payload: input.payload,
      tags: input.tags
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
  tags?: string[]
): void {
  logStore.push({ level, source, message, payload, tags })
}

export function useLogs(): LogEntry[] {
  return useSyncExternalStore(logStore.subscribe, logStore.getSnapshot)
}
