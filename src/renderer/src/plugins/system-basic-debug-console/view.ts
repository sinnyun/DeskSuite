import { useSyncExternalStore } from 'react'
import type { LogEntry, LogLevel } from '../../workbench/sdk'

export const LOG_LEVELS: LogLevel[] = ['info', 'warn', 'error', 'event', 'lifecycle']

export interface ConsoleViewState {
  levels: LogLevel[]
  search: string
  expanded: string[]
}

const INITIAL: ConsoleViewState = {
  levels: [...LOG_LEVELS],
  search: '',
  expanded: []
}

export function logPayloadText(entry: LogEntry): string {
  if (entry.payload === undefined || entry.payload === null) return ''
  if (typeof entry.payload === 'string') return entry.payload
  if (typeof entry.payload === 'number' || typeof entry.payload === 'boolean') {
    return String(entry.payload)
  }
  try {
    return JSON.stringify(entry.payload, null, 2)
  } catch {
    return String(entry.payload)
  }
}

class ConsoleViewStore {
  private state: ConsoleViewState = INITIAL
  private listeners = new Set<() => void>()

  getSnapshot = (): ConsoleViewState => this.state

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private set(patch: Partial<ConsoleViewState>): void {
    this.state = { ...this.state, ...patch }
    for (const listener of this.listeners) listener()
  }

  toggleLevel = (level: LogLevel): void => {
    const levels = this.state.levels.includes(level)
      ? this.state.levels.filter((item) => item !== level)
      : [...this.state.levels, level]
    this.set({ levels })
  }

  setSearch = (search: string): void => {
    this.set({ search })
  }

  reset = (): void => {
    this.set({ levels: [...LOG_LEVELS], search: '' })
  }

  toggleExpanded = (id: string): void => {
    const expanded = this.state.expanded.includes(id)
      ? this.state.expanded.filter((item) => item !== id)
      : [...this.state.expanded, id]
    this.set({ expanded })
  }
}

export const consoleViewStore = new ConsoleViewStore()

export function useConsoleView(): ConsoleViewState {
  return useSyncExternalStore(consoleViewStore.subscribe, consoleViewStore.getSnapshot)
}

export function filterLogs(logs: LogEntry[], view: ConsoleViewState): LogEntry[] {
  const query = view.search.trim().toLowerCase()
  return logs.filter((entry) => {
    if (!view.levels.includes(entry.level)) return false
    if (!query) return true
    if (entry.message.toLowerCase().includes(query)) return true
    if (entry.source.toLowerCase().includes(query)) return true
    if (logPayloadText(entry).toLowerCase().includes(query)) return true
    return (entry.tags ?? []).some((tag) => tag.toLowerCase().includes(query))
  })
}
