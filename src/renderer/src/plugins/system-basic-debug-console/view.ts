import { useSyncExternalStore } from 'react'
import type { LogCategory, LogEntry, LogLevel } from '../../workbench/sdk'
import { formatPayload, searchableLogText } from './labels'

export const LOG_LEVELS: LogLevel[] = ['info', 'warn', 'error', 'event', 'lifecycle']
export const LOG_CATEGORIES: LogCategory[] = ['action', 'transfer', 'processing', 'result', 'system']

export interface ConsoleViewState {
  levels: LogLevel[]
  categories: LogCategory[]
  source: string
  search: string
  expanded: string[]
}

const INITIAL: ConsoleViewState = {
  levels: [...LOG_LEVELS],
  categories: [...LOG_CATEGORIES],
  source: '*',
  search: '',
  expanded: []
}

export function logPayloadText(entry: LogEntry): string {
  return formatPayload(entry)
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

  toggleCategory = (category: LogCategory): void => {
    const categories = this.state.categories.includes(category)
      ? this.state.categories.filter((item) => item !== category)
      : [...this.state.categories, category]
    this.set({ categories })
  }

  setSearch = (search: string): void => {
    this.set({ search })
  }

  setSource = (source: string): void => {
    this.set({ source })
  }

  reset = (): void => {
    this.set({ levels: [...LOG_LEVELS], categories: [...LOG_CATEGORIES], source: '*', search: '' })
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
    if (!view.categories.includes(entry.category ?? 'system')) return false
    if (view.source !== '*' && entry.source !== view.source) return false
    if (!query) return true
    return searchableLogText(entry).includes(query)
  })
}
