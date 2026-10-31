import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
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

const viewStore = createStore<ConsoleViewState>(() => INITIAL)

export const consoleViewStore = {
  getSnapshot: viewStore.getState,
  subscribe: (listener: () => void): (() => void) => viewStore.subscribe(listener),

  toggleLevel(level: LogLevel): void {
    const { levels } = viewStore.getState()
    viewStore.setState({ levels: levels.includes(level) ? levels.filter((item) => item !== level) : [...levels, level] })
  },

  toggleCategory(category: LogCategory): void {
    const { categories } = viewStore.getState()
    viewStore.setState({ categories: categories.includes(category) ? categories.filter((item) => item !== category) : [...categories, category] })
  },

  setSearch: (search: string): void => viewStore.setState({ search }),

  setSource: (source: string): void => viewStore.setState({ source }),

  reset: (): void => viewStore.setState({ levels: [...LOG_LEVELS], categories: [...LOG_CATEGORIES], source: '*', search: '' }),

  toggleExpanded(id: string): void {
    const { expanded } = viewStore.getState()
    viewStore.setState({ expanded: expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id] })
  }
}

export function useConsoleView(): ConsoleViewState {
  return useStore(viewStore)
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
