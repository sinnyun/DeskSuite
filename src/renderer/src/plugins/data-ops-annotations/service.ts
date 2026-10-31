import { createStore } from 'zustand/vanilla'
import { subscribeWithSelector } from 'zustand/middleware'
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

interface AnnotationState {
  entries: MetadataMap
  notes: Readonly<Record<string, string>>
}

const stateStore = createStore<AnnotationState>()(subscribeWithSelector(() => ({ entries: Object.freeze({}), notes: Object.freeze({}) })))

class AnnotationStore {
  private readonly tagIds = new Map<string, Map<string, number>>()
  private readonly pending = new Set<string>()
  private readonly queuedPaths = new Set<string>()
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
      if (annotationsChangedSchema.safeParse(payload).success) void this.refreshKnown()
    })
    void this.tree().catch(() => undefined)
    return () => {
      this.running = false
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
    if (!this.loadTask && this.queuedPaths.size) {
      const task = Promise.resolve().then(async () => {
        let failure: unknown
        while (this.queuedPaths.size) {
          const batch = [...this.queuedPaths].slice(0, 1000)
          batch.forEach((path) => this.queuedPaths.delete(path))
          try {
            const result = await this.forPaths(batch)
            const entries = { ...stateStore.getState().entries }
            const notes = { ...stateStore.getState().notes }
            for (const path of batch) {
              const item = result[path]
              if (!item) continue
              entries[path] = Object.freeze({
                favorite: item.favorite,
                rating: item.rating,
                tags: item.tags.map((tag) => tag.name)
              })
              notes[path] = item.note
              this.tagIds.set(path, new Map(item.tags.map((tag) => [tag.name, tag.id])))
            }
            if (Object.keys(entries).length) stateStore.setState({ entries: Object.freeze(entries), notes: Object.freeze(notes) })
          } catch (error) {
            failure ??= error
          } finally {
            batch.forEach((path) => this.pending.delete(path))
          }
        }
        if (failure) throw failure
      }).finally(() => {
        if (this.loadTask === task) this.loadTask = undefined
      })
      this.loadTask = task
    }
    return this.loadTask ?? Promise.resolve()
  }

  private async refreshKnown(): Promise<void> {
    if (!this.running) return
    await this.load(Object.keys(stateStore.getState().entries))
    await this.tree(true).catch(() => this.treeCache)
  }

  private setLocal(path: string, value: EntryMeta): void {
    const normalized = Object.freeze({ ...value, tags: [...new Set(value.tags)] })
    stateStore.setState((state) => ({ entries: Object.freeze({ ...state.entries, [path]: normalized }) }))
  }
}

export const annotationStore = new AnnotationStore()
