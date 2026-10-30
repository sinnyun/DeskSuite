import { useSyncExternalStore } from 'react'
import {
  call,
  getService,
  log,
  type BasketService,
  type SelectionItem,
  type SelectionSnapshot
} from '../../workbench/sdk'
import { metadataStore } from './metadata'
import { usePaneStoreContext } from './PaneContext'

export type ExplorerViewMode = 'list' | 'grid' | 'gallery' | 'grouped'
export type EntryKind =
  | 'folder'
  | 'code'
  | 'image'
  | 'document'
  | 'data'
  | 'archive'
  | 'video'
  | 'audio'
  | 'other'
export type SortField = 'name' | 'size' | 'modifiedAt' | 'kind' | 'rating'
export type KindFilter = EntryKind | 'all'
export type SelectionMode = 'replace' | 'toggle' | 'range'

export interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  kind: EntryKind
  size: number
  modifiedAt: number
}

export interface DriveInfo {
  name: string
  path: string
  total: number
  free: number
  isNetwork: boolean
}

export interface QuickItem {
  id: string
  label: string
  path: string
}

export interface TagFocus {
  tagId: number
  name: string
}

export interface ExplorerState {
  drives: DriveInfo[]
  quick: QuickItem[]
  path: string | null
  parent: string | null
  tagFocus: TagFocus | null
  entries: FsEntry[]
  descendantEntries: FsEntry[]
  truncated: boolean
  nextCursor: string | null
  loadingMore: boolean
  selectedPaths: string[]
  focusedPath: string | null
  viewMode: ExplorerViewMode
  groupingEnabled: boolean
  search: string
  kindFilter: KindFilter
  tagFilter: string | null
  favoriteOnly: boolean
  minRating: number
  sortField: SortField
  sortOrder: 'asc' | 'desc'
  status: 'idle' | 'loading' | 'ready' | 'error'
  error: string | null
  canBack: boolean
  canForward: boolean
  scrollAnchor: { path: string | null; offset: number }
  paneWidths: { left: number; right: number; bottom: number }
  expandedDirectories: string[]
}

export type PaneSessionState = Pick<ExplorerState,
  | 'path'
  | 'viewMode'
  | 'groupingEnabled'
  | 'sortField'
  | 'sortOrder'
  | 'search'
  | 'kindFilter'
  | 'tagFilter'
  | 'favoriteOnly'
  | 'minRating'
  | 'selectedPaths'
  | 'focusedPath'
  | 'scrollAnchor'
  | 'paneWidths'
  | 'expandedDirectories'
  | 'tagFocus'
>

const INITIAL_STATE: ExplorerState = {
  drives: [],
  quick: [],
  path: null,
  parent: null,
  tagFocus: null,
  entries: [],
  descendantEntries: [],
  truncated: false,
  nextCursor: null,
  loadingMore: false,
  selectedPaths: [],
  focusedPath: null,
  viewMode: 'list',
  groupingEnabled: false,
  search: '',
  kindFilter: 'all',
  tagFilter: null,
  favoriteOnly: false,
  minRating: 0,
  sortField: 'name',
  sortOrder: 'asc',
  status: 'idle',
  error: null,
  canBack: false,
  canForward: false,
  scrollAnchor: { path: null, offset: 0 },
  paneWidths: { left: 268, right: 320, bottom: 220 },
  expandedDirectories: []
}

function toSelectionItem(entry: FsEntry): SelectionItem {
  return {
    path: entry.path,
    name: entry.name,
    isDirectory: entry.isDirectory,
    kind: entry.kind,
    size: entry.size,
    modifiedAt: entry.modifiedAt
  }
}

const CASE_INSENSITIVE_PATHS = navigator.platform.toLowerCase().startsWith('win')

export function normalizePath(path: string): string {
  const trimmed = path.replace(/[\\/]+$/, '').replace(/\\/g, '/')
  return CASE_INSENSITIVE_PATHS ? trimmed.toLowerCase() : trimmed
}

export function parentDirectory(path: string): string {
  const index = Math.max(path.lastIndexOf('\\'), path.lastIndexOf('/'))
  return index > 0 ? path.slice(0, index) : path
}

export class ExplorerStore {
  private state: ExplorerState = { ...INITIAL_STATE }
  private selection: SelectionSnapshot = { path: null, entries: [], selected: [] }
  private listeners = new Set<() => void>()
  private back: string[] = []
  private forward: string[] = []
  private anchorPath: string | null = null
  private token = 0
  private moreToken = 0
  private initialized = false
  private stopMetadata: (() => void) | undefined
  private stopTagEvents: (() => void) | undefined
  private lastDirectory: string | null = null

  constructor(readonly paneId = 'pane-1') {
  }

  getState = (): ExplorerState => this.state

  getSnapshot = (): SelectionSnapshot => this.selection

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    if (!this.stopMetadata) this.stopMetadata = metadataStore.subscribe(() => this.set({}))
    if (!this.stopTagEvents) {
      this.stopTagEvents = window.bridge.onEvent((channel) => {
        if (channel === 'annotations:changed' && this.state.tagFocus) {
          void this.showTagAggregate(this.state.tagFocus)
        }
      })
    }
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
    if (this === activeStore) {
      for (const listener of activeListeners) listener()
    }
  }

  private set(patch: Partial<ExplorerState>): void {
    this.state = { ...this.state, ...patch, canBack: this.back.length > 0, canForward: this.forward.length > 0 }
    const selectedSet = new Set(this.state.selectedPaths)
    this.selection = {
      path: this.state.path,
      entries: [...this.state.entries, ...this.state.descendantEntries].map(toSelectionItem),
      selected: [...this.state.entries, ...this.state.descendantEntries]
        .filter((entry) => selectedSet.has(entry.path))
        .map(toSelectionItem)
    }
    this.notify()
  }

  async init(saved?: Partial<PaneSessionState>): Promise<void> {
    if (this.initialized) return
    this.initialized = true
    try {
      const [drives, quick] = await Promise.all([
        call<DriveInfo[]>('filesystem', 'drives'),
        call<QuickItem[]>('filesystem', 'quickAccess')
      ])
      this.set({ drives, quick })
      if (saved) this.set({ viewMode: saved.viewMode === 'grouped' ? 'grid' : saved.viewMode ?? this.state.viewMode, groupingEnabled: saved.viewMode === 'grouped' ? true : saved.groupingEnabled ?? false })
      const fallback = quick[0]?.path
        const initialPath = saved?.path || fallback
        if (saved?.tagFocus) await this.showTagAggregate(saved.tagFocus)
        else if (initialPath) await this.load(initialPath, saved)
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      log('error', 'Explorer', '初始化文件浏览器失败', message)
    }
  }

  async load(path: string, restore?: Partial<PaneSessionState>, retry = 0, preserveCount = 0): Promise<void> {
    const token = ++this.token
    this.moreToken += 1
    this.set({ status: 'loading', error: null })
    try {
      const result = await call<{
        path: string
        parent: string | null
        entries: FsEntry[]
        truncated: boolean
          nextCursor?: string | null
          stale?: boolean
      }>('filesystem', 'listDir', path)
      if (token !== this.token) return
      if (result.stale) {
        if (retry < 1) await this.load(path, restore, retry + 1, preserveCount)
        else this.set({ status: 'error', error: '目录持续变化，请手动刷新' })
        return
      }
      const entries = [...result.entries]
      let nextCursor = result.nextCursor ?? null
      let truncated = result.truncated
      const seen = new Set(entries.map((entry) => entry.path))
      while (entries.length < preserveCount && nextCursor) {
        const page = await call<{
          entries: FsEntry[]
          truncated: boolean
          nextCursor: string | null
          stale: boolean
        }>('filesystem', 'listMore', nextCursor)
        if (page.stale) {
          if (retry < 1) await this.load(path, restore, retry + 1, preserveCount)
          else this.set({ status: 'error', error: '目录持续变化，请手动刷新' })
          return
        }
        for (const entry of page.entries) {
          if (seen.has(entry.path)) continue
          seen.add(entry.path)
          entries.push(entry)
        }
        nextCursor = page.nextCursor
        truncated = page.truncated
      }
      this.anchorPath = null
      this.lastDirectory = result.path
      this.set({
        path: result.path,
        parent: result.parent,
        tagFocus: null,
        entries,
        descendantEntries: [],
        truncated,
        nextCursor,
        loadingMore: false,
        search: restore?.search ?? '',
        kindFilter: restore?.kindFilter ?? 'all',
        tagFilter: restore?.tagFilter ?? null,
        favoriteOnly: restore?.favoriteOnly ?? false,
        minRating: restore?.minRating ?? 0,
        viewMode: restore?.viewMode === 'grouped' ? 'grid' : restore?.viewMode ?? this.state.viewMode,
        groupingEnabled: restore?.viewMode === 'grouped' ? true : restore?.groupingEnabled ?? this.state.groupingEnabled,
        sortField: restore?.sortField ?? this.state.sortField,
        sortOrder: restore?.sortOrder ?? this.state.sortOrder,
        selectedPaths: (restore?.selectedPaths ?? []).filter((selected) => entries.some((item) => item.path === selected)),
        focusedPath: restore?.focusedPath && entries.some((item) => item.path === restore.focusedPath) ? restore.focusedPath : null,
        scrollAnchor: restore?.scrollAnchor ?? { path: null, offset: 0 },
        paneWidths: restore?.paneWidths ?? this.state.paneWidths,
        expandedDirectories: restore?.expandedDirectories ?? this.state.expandedDirectories,
        status: 'ready',
        error: null
      })
      void metadataStore.prime(entries.map((entry) => entry.path))
      log('info', 'Explorer', `打开目录 ${result.path}`, {
        entries: entries.length,
        truncated
      })
    } catch (error) {
      if (token !== this.token) return
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      log('error', 'Explorer', `打开目录失败：${path}`, message)
    }
  }

  navigate = (path: string): void => {
    if (this.state.path && path !== this.state.path) {
      this.back.push(this.state.path)
      this.forward = []
    }
    void this.load(path)
  }

  goUp = (): void => {
    if (this.state.parent) this.navigate(this.state.parent)
  }

  goBack = (): void => {
    const target = this.back.pop()
    if (!target) return
    if (this.state.path) this.forward.push(this.state.path)
    void this.load(target)
  }

  goForward = (): void => {
    const target = this.forward.pop()
    if (!target) return
    if (this.state.path) this.back.push(this.state.path)
    void this.load(target)
  }

  refresh = (): void => {
    if (this.state.tagFocus) {
      void this.showTagAggregate(this.state.tagFocus)
      return
    }
    if (this.state.path) void this.load(this.state.path, this.getSessionState(), 0, this.state.entries.length)
  }

  applyChanges = async (paths: string[], invalidate = false): Promise<void> => {
    const changedPaths = [...new Set(paths.filter((path) => typeof path === 'string' && path.length > 0))]
    if (this.state.tagFocus) {
      if (invalidate) {
        void this.showTagAggregate(this.state.tagFocus)
        return
      }
      const present = new Set(this.state.entries.map((entry) => normalizePath(entry.path)))
      const changed = changedPaths.filter((path) => present.has(normalizePath(path)))
      if (changed.length > 0) await this.patchEntries(changed, null)
      return
    }
    const directory = this.state.path
    if (!directory || invalidate) {
      this.refresh()
      return
    }
    const target = normalizePath(directory)
    const changed = changedPaths.filter((path) => normalizePath(parentDirectory(path)) === target)
    if (changed.length > 0) await this.patchEntries(changed, directory)
  }

  private async patchEntries(changed: string[], directory: string | null): Promise<void> {
    const token = this.token
    try {
      const stats = await call<FsEntry[]>('filesystem', 'statPaths', changed)
      if (token !== this.token) return
      if (directory !== null && this.state.path !== directory) return
      const changedKeys = new Set(changed.map(normalizePath))
      const found = new Set(stats.map((entry) => normalizePath(entry.path)))
      const next: FsEntry[] = []
      let patched = false
      for (const entry of this.state.entries) {
        const key = normalizePath(entry.path)
        if (changedKeys.has(key) && !found.has(key)) {
          patched = true
          continue
        }
        next.push(entry)
      }
      const indexByPath = new Map(next.map((entry, index) => [normalizePath(entry.path), index]))
      for (const entry of stats) {
        const key = normalizePath(entry.path)
        const index = indexByPath.get(key)
        if (index === undefined) {
          indexByPath.set(key, next.length)
          next.push(entry)
          patched = true
          continue
        }
        const previous = next[index]
        if (
          previous.size !== entry.size ||
          previous.modifiedAt !== entry.modifiedAt ||
          previous.kind !== entry.kind ||
          previous.isDirectory !== entry.isDirectory
        ) {
          next[index] = entry
          patched = true
        }
      }
      if (!patched) return
      const present = new Set(next.map((entry) => normalizePath(entry.path)))
      const selectedPaths = this.state.selectedPaths.filter((path) => present.has(normalizePath(path)))
      const focusedPath = this.state.focusedPath && present.has(normalizePath(this.state.focusedPath))
        ? this.state.focusedPath
        : null
      this.set({ entries: next, selectedPaths, focusedPath })
      void metadataStore.prime(stats.map((entry) => entry.path))
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      log('warn', 'Explorer', '增量更新目录失败，改为重新加载', message)
      if (this.state.tagFocus) void this.showTagAggregate(this.state.tagFocus)
      else this.refresh()
    }
  }

  showTagAggregate = async (tag: TagFocus): Promise<void> => {
    const token = ++this.token
    this.moreToken += 1
    this.set({ status: 'loading', error: null })
    try {
      const paths = await call<string[]>('annotations', 'pathsForTag', tag.tagId)
      const entries = paths.length > 0
        ? await call<FsEntry[]>('filesystem', 'statPaths', paths)
        : []
      if (token !== this.token) return
      this.anchorPath = null
      this.set({
        tagFocus: { ...tag },
        path: null,
        parent: null,
        entries,
        descendantEntries: [],
        truncated: false,
        nextCursor: null,
        loadingMore: false,
        search: '',
        kindFilter: 'all',
        tagFilter: null,
        favoriteOnly: false,
        minRating: 0,
        selectedPaths: [],
        focusedPath: null,
        scrollAnchor: { path: null, offset: 0 },
        status: 'ready',
        error: null
      })
      void metadataStore.prime(entries.map((entry) => entry.path))
      log('info', 'Explorer', `按标签「${tag.name}」聚合 ${entries.length} 个文件`)
    } catch (error) {
      if (token !== this.token) return
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      log('error', 'Explorer', `标签聚合失败：${tag.name}`, message)
    }
  }

  clearTagFocus = (): void => {
    if (!this.state.tagFocus) return
    if (this.lastDirectory) {
      this.navigate(this.lastDirectory)
      return
    }
    this.set({
      tagFocus: null,
      path: null,
      parent: null,
      entries: [],
      truncated: false,
      nextCursor: null,
      loadingMore: false,
      status: 'idle',
      error: null
    })
  }

  loadMore = async (): Promise<void> => {
      const cursor = this.state.nextCursor
      const path = this.state.path
      if (!cursor || !path || this.state.loadingMore) return
      const token = ++this.moreToken
      this.set({ loadingMore: true })
      try {
        const result = await call<{
          path: string
          entries: FsEntry[]
          truncated: boolean
          nextCursor: string | null
          stale: boolean
        }>('filesystem', 'listMore', cursor)
        if (token !== this.moreToken) return
        if (result.stale) {
          this.set({ loadingMore: false })
          this.refresh()
          return
        }
        const seen = new Set(this.state.entries.map((entry) => entry.path))
        const appended = result.entries.filter((entry) => !seen.has(entry.path))
        this.set({
          entries: [...this.state.entries, ...appended],
          truncated: result.truncated,
          nextCursor: result.nextCursor,
          loadingMore: false,
          status: 'ready',
          error: null
        })
        void metadataStore.prime(appended.map((entry) => entry.path))
      } catch (error) {
        if (token !== this.moreToken) return
        const message = error instanceof Error ? error.message : String(error)
        this.set({ loadingMore: false, status: 'ready', error: message })
        log('error', 'Explorer', `读取目录下一页失败：${path}`, message)
      }
    }

  pickAndNavigate = async (): Promise<void> => {
    const path = await call<string | null>('filesystem', 'pickDirectory')
    if (path) this.navigate(path)
  }

  select = (path: string | null, mode: SelectionMode = 'replace'): void => {
    if (!path) {
      this.anchorPath = null
      this.set({ selectedPaths: [], focusedPath: null })
      return
    }

    if (mode === 'toggle') {
      const current = this.state.selectedPaths
      const next = current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path]
      this.anchorPath = path
      this.set({ selectedPaths: next, focusedPath: path })
      return
    }

    if (mode === 'range' && this.anchorPath) {
      const list = visibleEntries({ ...this.state, entries: [...this.state.entries, ...this.state.descendantEntries] }).map((entry) => entry.path)
      const from = list.indexOf(this.anchorPath)
      const to = list.indexOf(path)
      if (from >= 0 && to >= 0) {
        const start = Math.min(from, to)
        const end = Math.max(from, to)
        this.set({ selectedPaths: list.slice(start, end + 1), focusedPath: path })
        return
      }
    }

    this.anchorPath = path
    this.set({ selectedPaths: [path], focusedPath: path })
  }

  selectAll = (): void => {
    const paths = visibleEntries({ ...this.state, entries: [...this.state.entries, ...this.state.descendantEntries] }).map((entry) => entry.path)
    this.set({ selectedPaths: paths, focusedPath: paths[paths.length - 1] ?? null })
    this.anchorPath = paths[0] ?? null
  }

  clearSelection = (): void => {
    this.anchorPath = null
    this.set({ selectedPaths: [], focusedPath: null })
  }

  setSearch = (search: string): void => {
    this.set({ search })
  }

  setKindFilter = (kindFilter: KindFilter): void => {
    this.set({ kindFilter })
  }

  setTagFilter = (tagFilter: string | null): void => {
    this.set({ tagFilter })
  }

  setFavoriteOnly = (favoriteOnly: boolean): void => {
    this.set({ favoriteOnly })
  }

  setMinRating = (minRating: number): void => {
    this.set({ minRating })
  }

  clearFilters = (): void => {
    this.set({ search: '', kindFilter: 'all', tagFilter: null, favoriteOnly: false, minRating: 0 })
  }

  setViewMode = (viewMode: ExplorerViewMode): void => {
    // Legacy persisted sessions and MCP clients used grouped as a fourth mode.
    if (viewMode === 'grouped') this.set({ viewMode: 'grid', groupingEnabled: true })
    else this.set({ viewMode })
  }

  setGroupingEnabled = (groupingEnabled: boolean): void => {
    this.set({ groupingEnabled })
  }

  setScrollAnchor = (path: string | null, offset: number): void => {
    this.set({ scrollAnchor: { path, offset: Number.isFinite(offset) ? offset : 0 } })
  }

  setExpandedDirectories = (expandedDirectories: string[]): void => {
    this.set({ expandedDirectories: [...new Set(expandedDirectories)] })
  }

  setDescendantEntries = (entries: FsEntry[]): void => {
    this.set({ descendantEntries: entries })
  }

  getSessionState = (): PaneSessionState => ({
    path: this.state.path,
    viewMode: this.state.viewMode,
    groupingEnabled: this.state.groupingEnabled,
    sortField: this.state.sortField,
    sortOrder: this.state.sortOrder,
    search: this.state.search,
    kindFilter: this.state.kindFilter,
    tagFilter: this.state.tagFilter,
    favoriteOnly: this.state.favoriteOnly,
    minRating: this.state.minRating,
    selectedPaths: [...this.state.selectedPaths],
    focusedPath: this.state.focusedPath,
    scrollAnchor: { ...this.state.scrollAnchor },
    paneWidths: { ...this.state.paneWidths },
    expandedDirectories: [...this.state.expandedDirectories],
    tagFocus: this.state.tagFocus ? { ...this.state.tagFocus } : null
  })

  setSort = (sortField: SortField): void => {
    if (this.state.sortField === sortField) {
      this.set({ sortOrder: this.state.sortOrder === 'asc' ? 'desc' : 'asc' })
    } else {
      this.set({ sortField, sortOrder: 'asc' })
    }
  }

  toggleFavorite = (path: string): void => {
    const favorite = metadataStore.toggleFavorite(path)
    log('event', 'Explorer', favorite ? '已收藏条目' : '已取消收藏', { path })
  }

  setRating = (path: string, rating: number): void => {
    metadataStore.setRating(path, rating)
  }

  addTag = (path: string, tag: string): boolean => {
    return metadataStore.addTag(path, tag)
  }

  removeTag = (path: string, tag: string): void => {
    metadataStore.removeTag(path, tag)
  }

  openEntry = async (entry: FsEntry): Promise<void> => {
    if (entry.isDirectory) {
      this.navigate(entry.path)
      return
    }
    try {
      await call('filesystem', 'open', entry.path)
      log('event', 'Explorer', `用系统程序打开 ${entry.name}`)
    } catch (error) {
      log('error', 'Explorer', `打开文件失败：${entry.name}`, String(error))
    }
  }

  revealEntry = async (entry: FsEntry): Promise<void> => {
    try {
      await call('filesystem', 'reveal', entry.path)
    } catch (error) {
      log('error', 'Explorer', '定位文件失败', String(error))
    }
  }

  addSelectionToBasket = (): void => {
    const basket = getService<BasketService>('basket')
    if (!basket) {
      log('warn', 'Explorer', '未找到暂存篮服务（data-ops-explorer-insights）')
      return
    }
    const selected = this.selection.selected
    if (selected.length === 0) {
      log('warn', 'Explorer', '请先在文件列表中选择条目')
      return
    }
    basket.add(selected)
    log('event', 'Explorer', `已将 ${selected.length} 个条目加入暂存篮`)
  }
}

const defaultStore = new ExplorerStore('pane-1')
let activeStore = defaultStore
const activeListeners = new Set<() => void>()

export function createPaneStore(paneId: string): ExplorerStore {
  return paneId === defaultStore.paneId ? defaultStore : new ExplorerStore(paneId)
}

export function getActivePaneStore(): ExplorerStore {
  return activeStore
}

export function setActivePaneStore(store: ExplorerStore): void {
  if (activeStore === store) return
  activeStore = store
  for (const listener of activeListeners) listener()
}

function subscribeActive(listener: () => void): () => void {
  activeListeners.add(listener)
  return () => activeListeners.delete(listener)
}

const activeStoreProxy = new Proxy(defaultStore, {
  get(_target, property) {
    const value = Reflect.get(activeStore, property, activeStore) as unknown
    return typeof value === 'function'
      ? (...args: unknown[]) => (Reflect.get(activeStore, property, activeStore) as (...values: unknown[]) => unknown).apply(activeStore, args)
      : value
  }
})

export const explorerStore = activeStoreProxy

export const activeSelectionService = {
  getSnapshot: (): SelectionSnapshot => activeStore.getSnapshot(),
  subscribe: subscribeActive
}

export function useCurrentExplorerStore(): ExplorerStore {
  return usePaneStoreContext() ?? activeStore
}

export function useExplorer(): ExplorerState {
  const paneStore = usePaneStoreContext()
  return useSyncExternalStore(
    paneStore?.subscribe ?? subscribeActive,
    paneStore?.getState ?? (() => activeStore.getState())
  )
}

export function useSelection(): SelectionSnapshot {
  const paneStore = usePaneStoreContext()
  return useSyncExternalStore(
    paneStore?.subscribe ?? subscribeActive,
    paneStore?.getSnapshot ?? (() => activeStore.getSnapshot())
  )
}

export function hasActiveFilters(state: ExplorerState): boolean {
  return (
    state.search.trim().length > 0 ||
    state.kindFilter !== 'all' ||
    state.tagFilter !== null ||
    state.favoriteOnly ||
    state.minRating > 0
  )
}

export function visibleEntries(state: ExplorerState): FsEntry[] {
  const query = state.search.trim().toLowerCase()
  const list = state.entries.filter((entry) => {
    if (query && !entry.name.toLowerCase().includes(query)) return false
    if (state.kindFilter !== 'all' && entry.kind !== state.kindFilter) return false
    const meta = metadataStore.get(entry.path)
    if (state.favoriteOnly && !meta.favorite) return false
    if (state.minRating > 0 && meta.rating < state.minRating) return false
    if (state.tagFilter && !meta.tags.includes(state.tagFilter)) return false
    return true
  })
  const direction = state.sortOrder === 'asc' ? 1 : -1
  return [...list].sort((a, b) => {
    if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
    let compare = 0
    if (state.sortField === 'size') compare = a.size - b.size
    else if (state.sortField === 'modifiedAt') compare = a.modifiedAt - b.modifiedAt
    else if (state.sortField === 'kind') compare = a.kind.localeCompare(b.kind)
    else if (state.sortField === 'rating') {
      compare = metadataStore.get(a.path).rating - metadataStore.get(b.path).rating
    } else compare = a.name.localeCompare(b.name)
    return compare * direction
  })
}
