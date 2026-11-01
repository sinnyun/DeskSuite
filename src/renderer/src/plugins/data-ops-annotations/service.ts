import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
import type { z } from 'zod'
import { call, callValidated } from '../../workbench/sdk'
import {
  annotationTagListSchema,
  annotationTagSchema,
  annotationsChangedSchema,
  entriesByPathSchema,
  importLegacyResultSchema
} from './schemas'

export interface EntryMeta {
  favorite: boolean
  rating: number
  tags: string[]
}

export type MetadataMap = Readonly<Record<string, EntryMeta>>

export interface TagItem {
  id: number
  name: string
  parentId: number | null
  path: string
  color: string | null
  sort: number
  children: TagItem[]
}

export interface AnnotationEntry {
  path: string
  favorite: boolean
  rating: number
  note: string
  tags: Array<Pick<TagItem, 'id' | 'name' | 'parentId' | 'path' | 'color'>>
}

const EMPTY: EntryMeta = Object.freeze({ favorite: false, rating: 0, tags: [] })

// 广播合并窗口：连续写入（逐行收藏/评分、标签树批量变更）各自广播一次，合并后只重拉一轮。
// 界面写入是乐观更新，窗口只延后与服务端对账，用户看不到延迟。
const COALESCE_WINDOW_MS = 50

function sameMeta(current: EntryMeta, favorite: boolean, rating: number, tags: string[]): boolean {
  return current.favorite === favorite && current.rating === rating
    && current.tags.length === tags.length
    && current.tags.every((tag, index) => tag === tags[index])
}

interface AnnotationState {
  entries: MetadataMap
  notes: Readonly<Record<string, string>>
}

const stateStore = createStore<AnnotationState>()(subscribeWithSelector(() => ({ entries: Object.freeze({}), notes: Object.freeze({}) })))

class AnnotationStore {
  private readonly tagIds = new Map<string, Map<string, number>>()
  private readonly pending = new Set<string>()
  private readonly queuedPaths = new Set<string>()
  private readonly eventPaths = new Set<string>()
  private eventNeedsFullRefresh = false
  private eventTimer: ReturnType<typeof setTimeout> | undefined
  private loadTask: Promise<void> | undefined
  private treeCache: TagItem[] = []
  private treeLoaded = false
  private treeRequest: Promise<TagItem[]> | undefined
  private running = false
  private stopEvents: (() => void) | undefined

  getSnapshot = (): MetadataMap => stateStore.getState().entries

  subscribe = (listener: () => void): (() => void) => {
    return stateStore.subscribe(listener)
  }

  subscribePath = (path: string, listener: () => void): (() => void) => {
    return stateStore.subscribe((state) => state.entries[path] ?? EMPTY, listener)
  }

  start(): () => void {
    this.running = true
    this.stopEvents?.()
    this.stopEvents = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'annotations:changed') return
      const parsed = annotationsChangedSchema.safeParse(payload)
      if (parsed.success) this.scheduleRefresh(parsed.data)
    })
    void this.tree().catch(() => undefined)
    return () => {
      this.running = false
      if (this.eventTimer !== undefined) clearTimeout(this.eventTimer)
      this.eventTimer = undefined
      this.eventPaths.clear()
      this.eventNeedsFullRefresh = false
      this.stopEvents?.()
      this.stopEvents = undefined
    }
  }

  get(path: string | null | undefined): EntryMeta {
    if (!path) return EMPTY
    const cached = stateStore.getState().entries[path]
    if (cached) return cached
    void this.load([path])
    return EMPTY
  }

  getNote(path: string | null | undefined): string {
    if (!path) return ''
    if (!stateStore.getState().entries[path]) void this.load([path])
    return stateStore.getState().notes[path] ?? ''
  }

  prime(paths: string[]): Promise<void> {
    return this.load(paths)
  }

  async forPaths(paths: string[]): Promise<Record<string, AnnotationEntry>> {
    return callValidated(entriesByPathSchema, 'annotations', 'forPaths', paths)
  }

  tree(force = false): Promise<TagItem[]> {
    if (this.treeRequest) return this.treeRequest
    if (!force && this.treeLoaded) return Promise.resolve(this.treeCache)
    const request = callValidated(annotationTagListSchema, 'annotations', 'tree').then((tree) => {
      this.treeCache = tree
      this.treeLoaded = true
      this.rebuildTagIds()
      return this.treeCache
    })
    this.treeRequest = request
    void request.finally(() => { if (this.treeRequest === request) this.treeRequest = undefined }).catch(() => undefined)
    return request
  }

  toggleFavorite(path: string): boolean {
    const current = this.get(path)
    const favorite = !current.favorite
    this.setLocal(path, { ...current, favorite })
    void call('annotations', 'setFavorite', { path, favorite }).catch(() => this.load([path]))
    return favorite
  }

  setRating(path: string, rating: number): void {
    const value = Math.max(0, Math.min(5, Math.round(rating)))
    this.setLocal(path, { ...this.get(path), rating: value })
    void call('annotations', 'setRating', { path, rating: value }).catch(() => this.load([path]))
  }

  setNote(path: string, note: string): void {
    stateStore.setState((state) => ({ notes: { ...state.notes, [path]: note } }))
    void call('annotations', 'setNote', { path, note }).catch(() => this.load([path]))
  }

  addTag(path: string, rawTag: string): boolean {
    const name = rawTag.trim()
    if (!name) return false
    const current = this.get(path)
    if (current.tags.includes(name)) return false
    this.setLocal(path, { ...current, tags: [...current.tags, name] })
    void this.ensureTag(name)
      .then((tagId) => call('annotations', 'assignTag', { paths: [path], tagId }))
      .catch(() => this.load([path]))
    return true
  }

  removeTag(path: string, name: string): void {
    const current = this.get(path)
    this.setLocal(path, { ...current, tags: current.tags.filter((tag) => tag !== name) })
    const id = this.tagIds.get(path)?.get(name) ?? this.findTagId(name)
    if (id !== undefined) {
      void call('annotations', 'unassignTag', { paths: [path], tagId: id }).catch(() => this.load([path]))
    }
  }

  allTags = (): string[] => {
    const names = new Set<string>()
    const visit = (nodes: TagItem[]): void => {
      for (const node of nodes) {
        names.add(node.name)
        visit(node.children)
      }
    }
    visit(this.treeCache)
    for (const meta of Object.values(stateStore.getState().entries)) for (const tag of meta.tags) names.add(tag)
    return [...names].sort((a, b) => a.localeCompare(b))
  }

  exportFor = (paths: string[]): Record<string, EntryMeta> => {
    const result: Record<string, EntryMeta> = {}
    for (const path of paths) {
      const value = stateStore.getState().entries[path]
      if (value) result[path] = value
    }
    return result
  }

  async importLegacy(map: Record<string, unknown>): Promise<{ imported: number; skipped: number }> {
    const result = await callValidated(importLegacyResultSchema, 'annotations', 'importLegacy', map)
    await this.load(Object.keys(map))
    return result
  }

  private async ensureTag(name: string): Promise<number> {
    if (this.treeCache.length === 0) await this.tree()
    const existing = this.findTagId(name)
    if (existing !== undefined) return existing
    const created = await callValidated(annotationTagSchema, 'annotations', 'create', { name })
    this.treeCache = await callValidated(annotationTagListSchema, 'annotations', 'tree')
    this.rebuildTagIds()
    return created.id
  }

  private findTagId(name: string): number | undefined {
    const visit = (nodes: TagItem[]): number | undefined => {
      for (const node of nodes) {
        if (node.name === name) return node.id
        const nested = visit(node.children)
        if (nested !== undefined) return nested
      }
      return undefined
    }
    return visit(this.treeCache)
  }

  private rebuildTagIds(): void {
    for (const [path, entry] of Object.entries(stateStore.getState().entries)) {
      const ids = new Map<string, number>()
      for (const name of entry.tags) {
        const tagId = this.findTagId(name)
        if (tagId !== undefined) ids.set(name, tagId)
      }
      this.tagIds.set(path, ids)
    }
  }

  private load(paths: string[]): Promise<void> {
    const unique = [...new Set(paths.filter(Boolean))].filter((path) => !this.pending.has(path))
    unique.forEach((path) => {
      this.pending.add(path)
      this.queuedPaths.add(path)
    })
    if (!this.loadTask && this.queuedPaths.size) this.loadTask = this.drain()
    return this.loadTask ?? Promise.resolve()
  }

  private async drain(): Promise<void> {
    let failure: unknown
    while (this.queuedPaths.size) {
      const batch = [...this.queuedPaths].slice(0, 1000)
      batch.forEach((path) => this.queuedPaths.delete(path))
      try {
        const result = await this.forPaths(batch)
        const entries = { ...stateStore.getState().entries }
        const notes = { ...stateStore.getState().notes }
        let entriesChanged = false
        let notesChanged = false
        for (const path of batch) {
          const item = result[path]
          if (!item) continue
          const tags = item.tags.map((tag) => tag.name)
          const previous = entries[path]
          // 内容未变时保留旧引用，subscribePath 的选择器据此判定「未变化」，避免全行重渲染
          if (!previous || !sameMeta(previous, item.favorite, item.rating, tags)) {
            entries[path] = Object.freeze({ favorite: item.favorite, rating: item.rating, tags })
            entriesChanged = true
          }
          if (notes[path] !== item.note) {
            notes[path] = item.note
            notesChanged = true
          }
          this.tagIds.set(path, new Map(item.tags.map((tag) => [tag.name, tag.id])))
        }
        if (entriesChanged) stateStore.setState({ entries: Object.freeze(entries) })
        if (notesChanged) stateStore.setState({ notes: Object.freeze(notes) })
      } catch (error) {
        failure ??= error
      } finally {
        batch.forEach((path) => this.pending.delete(path))
      }
      // 循环退出后在同一同步帧内交还任务句柄：留给微任务的话，期间入队的路径会没人消费，
      // 而这些路径仍留在 pending 里，之后每次刷新都会被过滤掉，永远不再更新。
      if (!this.queuedPaths.size) this.loadTask = undefined
    }
    if (failure) throw failure
  }

  private scheduleRefresh(event: z.infer<typeof annotationsChangedSchema>): void {
    if (event.kind === 'metadata' && event.paths?.length) {
      for (const path of event.paths) this.eventPaths.add(path)
    } else {
      // 标签树变更或无路径的旧数据导入：影响面未知，仍按整缓存刷新。
      this.eventNeedsFullRefresh = true
    }
    if (this.eventTimer !== undefined) return
    this.eventTimer = setTimeout(() => {
      this.eventTimer = undefined
      void this.flushEventRefresh()
    }, COALESCE_WINDOW_MS)
  }

  private async flushEventRefresh(): Promise<void> {
    if (!this.running) return
    const paths = [...this.eventPaths]
    const needsFullRefresh = this.eventNeedsFullRefresh
    this.eventPaths.clear()
    this.eventNeedsFullRefresh = false
    const cached = Object.keys(stateStore.getState().entries)
    if (needsFullRefresh) {
      await this.load(cached)
      await this.tree(true).catch(() => this.treeCache)
      return
    }
    // 缓存 key 可能经资源管理器小写化（Windows），比对同样按小写归一。
    const wanted = new Set(paths.map((path) => path.toLowerCase()))
    await this.load(cached.filter((path) => wanted.has(path.toLowerCase())))
  }

  private setLocal(path: string, value: EntryMeta): void {
    const normalized = Object.freeze({ ...value, tags: [...new Set(value.tags)] })
    stateStore.setState((state) => ({ entries: Object.freeze({ ...state.entries, [path]: normalized }) }))
  }
}

export const annotationStore = new AnnotationStore()
