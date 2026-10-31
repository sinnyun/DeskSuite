import { useSyncExternalStore } from 'react'
import {
  call,
  callWithTrace,
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
let bootstrapCache: { expiresAt: number; value: Promise<{ drives: DriveInfo[]; quick: QuickItem[] }> } | undefined

function loadExplorerBootstrap(): Promise<{ drives: DriveInfo[]; quick: QuickItem[] }> {
  if (bootstrapCache && bootstrapCache.expiresAt > Date.now()) return bootstrapCache.value
  const value = Promise.all([
    call<DriveInfo[]>('filesystem', 'drives'),
    call<QuickItem[]>('filesystem', 'quickAccess')
  ]).then(([drives, quick]) => ({ drives, quick }))
  bootstrapCache = { expiresAt: Date.now() + 30_000, value }
  void value.catch(() => { if (bootstrapCache?.value === value) bootstrapCache = undefined })
  return value
}

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
  private searchLogTimer: ReturnType<typeof setTimeout> | null = null

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
      const { drives, quick } = await loadExplorerBootstrap()
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

  async load(path: string, restore?: Partial<PaneSessionState>, retry = 0, preserveCount = 0, inheritedTraceId?: string): Promise<void> {
    const traceId = inheritedTraceId ?? `explorer-load-${crypto.randomUUID()}`
    const token = ++this.token
    this.moreToken += 1
    this.set({ status: 'loading', error: null })
    log('event', 'Explorer', `读取目录 ${path}`, { path, preserveCount, retry }, ['explorer', 'filesystem'], {
      category: 'action', traceId, phase: '开始', status: 'running'
    })
    try {
      const result = await callWithTrace<{
        path: string
        parent: string | null
        entries: FsEntry[]
        truncated: boolean
          nextCursor?: string | null
          stale?: boolean
      }>(traceId, 'filesystem', 'listDir', path)
      if (token !== this.token) {
        log('info', 'Explorer', `忽略过期目录结果 ${result.path}`, { path: result.path, entries: result.entries.length }, ['explorer', 'filesystem'], {
          category: 'result', traceId, phase: '丢弃过期结果', status: 'ok'
        })
        return
      }
      if (result.stale) {
        if (retry < 1) await this.load(path, restore, retry + 1, preserveCount, traceId)
        else {
          this.set({ status: 'error', error: '目录持续变化，请手动刷新' })
          log('error', 'Explorer', `目录持续变化 ${path}`, { path, retry }, ['explorer', 'filesystem'], {
            category: 'result', traceId, phase: '重试耗尽', status: 'error'
          })
        }
        return
      }
      const entries = [...result.entries]
      let nextCursor = result.nextCursor ?? null
      let truncated = result.truncated
      const seen = new Set(entries.map((entry) => entry.path))
      while (entries.length < preserveCount && nextCursor) {
        const page = await callWithTrace<{
          entries: FsEntry[]
          truncated: boolean
          nextCursor: string | null
          stale: boolean
        }>(traceId, 'filesystem', 'listMore', nextCursor)
        if (page.stale) {
          if (retry < 1) await this.load(path, restore, retry + 1, preserveCount, traceId)
          else {
            this.set({ status: 'error', error: '目录持续变化，请手动刷新' })
            log('error', 'Explorer', `目录分页持续变化 ${path}`, { path, retry }, ['explorer', 'filesystem'], {
              category: 'result', traceId, phase: '重试耗尽', status: 'error'
            })
          }
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
      log('info', 'Explorer', `处理目录结果 ${result.path}`, {
        entries: entries.length,
        truncated,
        nextCursor: Boolean(nextCursor),
        selectedRestored: this.state.selectedPaths.length,
        focusedPath: this.state.focusedPath
      }, ['explorer', 'filesystem'], {
        category: 'processing', traceId, phase: '状态已更新', status: 'ok'
      })
    } catch (error) {
      if (token !== this.token) return
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      log('error', 'Explorer', `打开目录失败：${path}`, { path, error: message }, ['explorer', 'filesystem'], {
        category: 'result', traceId, phase: '处理失败', status: 'error'
      })
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
    const traceId = `explorer-tag-${crypto.randomUUID()}`
    const token = ++this.token
    this.moreToken += 1
    this.set({ status: 'loading', error: null })
    log('event', 'Explorer', `聚合标签「${tag.name}」`, { tagId: tag.tagId }, ['explorer', 'annotations'], {
      category: 'action', traceId, phase: '开始', status: 'running'
    })
    try {
      const paths = await callWithTrace<string[]>(traceId, 'annotations', 'pathsForTag', tag.tagId)
      const entries = paths.length > 0
        ? await callWithTrace<FsEntry[]>(traceId, 'filesystem', 'statPaths', paths)
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
      log('info', 'Explorer', `处理标签聚合结果「${tag.name}」`, {
        tagId: tag.tagId, pathCount: paths.length, entryCount: entries.length,
        missingCount: Math.max(0, paths.length - entries.length)
      }, ['explorer', 'annotations', 'filesystem'], {
        category: 'processing', traceId, phase: '聚合完成', status: 'ok'
      })
    } catch (error) {
      if (token !== this.token) return
      const message = error instanceof Error ? error.message : String(error)
      this.set({ status: 'error', error: message })
      log('error', 'Explorer', `标签聚合失败：${tag.name}`, { tagId: tag.tagId, error: message }, ['explorer', 'annotations'], {
        category: 'result', traceId, phase: '处理失败', status: 'error'
      })
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

  select = (path: string | null, mode: SelectionMode = 'replace', traceId?: string): void => {
    if (!path) {
      this.anchorPath = null
      this.set({ selectedPaths: [], focusedPath: null })
      this.recordSelection(null, mode, [], traceId)
      return
    }

    if (mode === 'toggle') {
      const current = this.state.selectedPaths
      const next = current.includes(path)
        ? current.filter((item) => item !== path)
        : [...current, path]
      this.anchorPath = path
      this.set({ selectedPaths: next, focusedPath: path })
      this.recordSelection(path, mode, next, traceId)
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
        this.recordSelection(path, mode, list.slice(start, end + 1), traceId)
        return
      }
    }

    this.anchorPath = path
    this.set({ selectedPaths: [path], focusedPath: path })
    this.recordSelection(path, mode, [path], traceId)
  }

  private recordSelection(focusedPath: string | null, mode: SelectionMode, selectedPaths: string[], inheritedTraceId?: string): void {
    const traceId = inheritedTraceId ?? `explorer-select-${crypto.randomUUID()}`
    log('event', 'Explorer', focusedPath ? `选择文件 ${focusedPath}` : '清除文件选择', {
      focusedPath,
      mode,
      count: selectedPaths.length,
      paths: selectedPaths.slice(0, 30),
      truncated: selectedPaths.length > 30
    }, ['explorer', 'selection'], { category: 'action', traceId, phase: '选择', status: 'ok' })
  }

  selectAll = (): void => {
    const paths = visibleEntries({ ...this.state, entries: [...this.state.entries, ...this.state.descendantEntries] }).map((entry) => entry.path)
    this.set({ selectedPaths: paths, focusedPath: paths[paths.length - 1] ?? null })
    this.anchorPath = paths[0] ?? null
    this.recordSelection(paths[paths.length - 1] ?? null, 'replace', paths)
  }

  clearSelection = (traceId?: string): void => {
    this.anchorPath = null
    this.set({ selectedPaths: [], focusedPath: null })
    this.recordSelection(null, 'replace', [], traceId)
  }

  setSearch = (search: string): void => {
    this.set({ search })
    if (this.searchLogTimer) clearTimeout(this.searchLogTimer)
    this.searchLogTimer = setTimeout(() => {
      this.searchLogTimer = null
      log('event', 'Explorer', `设置文件搜索条件${search ? '' : '（清空）'}`, {
        query: search.slice(0, 1000), truncated: search.length > 1000, directory: this.state.path
      }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '搜索条件', status: 'ok' })
    }, 350)
  }

  setKindFilter = (kindFilter: KindFilter): void => {
    this.set({ kindFilter })
    log('event', 'Explorer', `筛选文件类型：${kindFilter}`, { kindFilter }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '类型筛选', status: 'ok' })
  }

  setTagFilter = (tagFilter: string | null): void => {
    this.set({ tagFilter })
    log('event', 'Explorer', `筛选标签：${tagFilter ?? '全部'}`, { tagFilter }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '标签筛选', status: 'ok' })
  }

  setFavoriteOnly = (favoriteOnly: boolean): void => {
    this.set({ favoriteOnly })
    log('event', 'Explorer', favoriteOnly ? '仅显示收藏文件' : '显示全部收藏状态', { favoriteOnly }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '收藏筛选', status: 'ok' })
  }

  setMinRating = (minRating: number): void => {
    this.set({ minRating })
    log('event', 'Explorer', `设置最低评分：${minRating}`, { minRating }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '评分筛选', status: 'ok' })
  }

  clearFilters = (): void => {
    this.set({ search: '', kindFilter: 'all', tagFilter: null, favoriteOnly: false, minRating: 0 })
    log('event', 'Explorer', '清除全部文件筛选', { directory: this.state.path }, ['explorer', 'filter'], { category: 'action', traceId: `explorer-filter-${crypto.randomUUID()}`, phase: '清除筛选', status: 'ok' })
  }

  setViewMode = (viewMode: ExplorerViewMode): void => {
    // Legacy persisted sessions and MCP clients used grouped as a fourth mode.
    if (viewMode === 'grouped') this.set({ viewMode: 'grid', groupingEnabled: true })
    else this.set({ viewMode })
    log('event', 'Explorer', `切换文件视图：${viewMode}`, { viewMode }, ['explorer', 'view'], { category: 'action', traceId: `explorer-view-${crypto.randomUUID()}`, phase: '视图切换', status: 'ok' })
  }

  setGroupingEnabled = (groupingEnabled: boolean): void => {
    this.set({ groupingEnabled })
    log('event', 'Explorer', groupingEnabled ? '启用文件分组' : '关闭文件分组', { groupingEnabled }, ['explorer', 'view'], { category: 'action', traceId: `explorer-view-${crypto.randomUUID()}`, phase: '分组设置', status: 'ok' })
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
    log('event', 'Explorer', `调整文件排序：${this.state.sortField} ${this.state.sortOrder}`, {
      sortField: this.state.sortField, sortOrder: this.state.sortOrder
    }, ['explorer', 'sort'], { category: 'action', traceId: `explorer-sort-${crypto.randomUUID()}`, phase: '排序条件', status: 'ok' })
  }

  toggleFavorite = (path: string): void => {
    const favorite = metadataStore.toggleFavorite(path)
    log('event', 'Explorer', favorite ? '已收藏条目' : '已取消收藏', { path })
  }

  setRating = (path: string, rating: number): void => {
    metadataStore.setRating(path, rating)
    log('event', 'Explorer', `设置文件评分：${path}`, { path, rating }, ['explorer', 'metadata'], { category: 'processing', traceId: `explorer-rating-${crypto.randomUUID()}`, phase: '元数据已更新', status: 'ok' })
  }

  addTag = (path: string, tag: string): boolean => {
    const changed = metadataStore.addTag(path, tag)
    log(changed ? 'event' : 'info', 'Explorer', changed ? `添加文件标签：${tag}` : `文件标签未变化：${tag}`, { path, tag, changed }, ['explorer', 'metadata'], { category: 'processing', traceId: `explorer-tag-${crypto.randomUUID()}`, phase: '元数据已处理', status: 'ok' })
    return changed
  }

  removeTag = (path: string, tag: string): void => {
    metadataStore.removeTag(path, tag)
    log('event', 'Explorer', `移除文件标签：${tag}`, { path, tag }, ['explorer', 'metadata'], { category: 'processing', traceId: `explorer-tag-${crypto.randomUUID()}`, phase: '元数据已更新', status: 'ok' })
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
