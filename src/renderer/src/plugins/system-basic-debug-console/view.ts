import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import { z } from 'zod'
import type { LogCategory, LogEntry, LogLevel } from '../../workbench/sdk'
import { formatPayload, searchableLogText } from './labels'

// as const 让字面量数组直接喂给 z.enum，同时保持与 LogLevel / LogCategory 声明同步。
export const LOG_LEVELS = ['info', 'warn', 'error', 'event', 'lifecycle'] as const satisfies readonly LogLevel[]
export const LOG_CATEGORIES = ['action', 'transfer', 'processing', 'result', 'system'] as const satisfies readonly LogCategory[]

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

/** `debug-console:view` 广播的筛选补丁：省略的字段保持面板当前状态。 */
export const consoleViewCommandSchema = z.object({
  search: z.string().max(512).optional(),
  source: z.string().max(128).optional(),
  levels: z.array(z.enum(LOG_LEVELS)).max(LOG_LEVELS.length).optional(),
  categories: z.array(z.enum(LOG_CATEGORIES)).max(LOG_CATEGORIES.length).optional(),
  expanded: z.array(z.string().min(1).max(160)).max(200).optional(),
  reset: z.boolean().optional()
}).strict()

export type ConsoleViewCommand = z.infer<typeof consoleViewCommandSchema>

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

  applyCommand(input: ConsoleViewCommand): void {
    if (input.reset) this.reset()
    const patch: Partial<ConsoleViewState> = {}
    if (input.search !== undefined) patch.search = input.search
    if (input.source !== undefined) patch.source = input.source
    if (input.levels) patch.levels = LOG_LEVELS.filter((level) => input.levels?.includes(level))
    if (input.categories) patch.categories = LOG_CATEGORIES.filter((category) => input.categories?.includes(category))
    if (input.expanded) patch.expanded = [...input.expanded]
    if (Object.keys(patch).length) viewStore.setState(patch)
  },

  toggleExpanded(id: string): void {
    const { expanded } = viewStore.getState()
    viewStore.setState({ expanded: expanded.includes(id) ? expanded.filter((item) => item !== id) : [...expanded, id] })
  }
}

const identity = (view: ConsoleViewState): ConsoleViewState => view

// 选择器必须返回原始值或稳定引用：zustand 用 useSyncExternalStore 比对结果，
// 返回新对象会让组件每次渲染都判定为变化。
export function useConsoleView(): ConsoleViewState
export function useConsoleView<T>(selector: (view: ConsoleViewState) => T): T
export function useConsoleView<T>(selector?: (view: ConsoleViewState) => T): ConsoleViewState | T {
  const select = (selector ?? identity) as (view: ConsoleViewState) => ConsoleViewState | T
  return useStore(viewStore, select)
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
