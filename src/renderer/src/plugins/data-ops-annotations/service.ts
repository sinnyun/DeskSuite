import { call } from '../../workbench/sdk'

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

class AnnotationStore {
  private readonly entries = new Map<string, EntryMeta>()
  private readonly notes = new Map<string, string>()
  private readonly tagIds = new Map<string, Map<string, number>>()
  private readonly listeners = new Set<() => void>()
  private readonly pending = new Set<string>()
  private treeCache: TagItem[] = []
  private snapshot: MetadataMap = Object.freeze({})
  private running = false
  private stopEvents: (() => void) | undefined

  getSnapshot = (): MetadataMap => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  start(): () => void {
    this.running = true
    this.stopEvents?.()
    this.stopEvents = window.bridge.onEvent((channel) => {
      if (channel === 'annotations:changed') void this.refreshKnown()
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
    const cached = this.entries.get(path)
    if (cached) return cached
    void this.load([path])
    return EMPTY
  }

  getNote(path: string | null | undefined): string {
    if (!path) return ''
    if (!this.entries.has(path)) void this.load([path])
    return this.notes.get(path) ?? ''
  }

  prime(paths: string[]): Promise<void> {
    return this.load(paths)
  }

  async forPaths(paths: string[]): Promise<Record<string, AnnotationEntry>> {
    return call('annotations', 'forPaths', paths)
  }

  async tree(): Promise<TagItem[]> {
    this.treeCache = await call<TagItem[]>('annotations', 'tree')
    this.rebuildTagIds()
    return this.treeCache
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
    this.notes.set(path, note)
    this.emit()
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
    for (const meta of this.entries.values()) for (const tag of meta.tags) names.add(tag)
    return [...names].sort((a, b) => a.localeCompare(b))
  }

  exportFor = (paths: string[]): Record<string, EntryMeta> => {
    const result: Record<string, EntryMeta> = {}
    for (const path of paths) {
      const value = this.entries.get(path)
      if (value) result[path] = value
    }
    return result
  }

  async importLegacy(map: Record<string, unknown>): Promise<{ imported: number; skipped: number }> {
    const result = await call<{ imported: number; skipped: number }>('annotations', 'importLegacy', map)
    await this.load(Object.keys(map))
    return result
  }

  private async ensureTag(name: string): Promise<number> {
    if (this.treeCache.length === 0) await this.tree()
    const existing = this.findTagId(name)
    if (existing !== undefined) return existing
    const created = await call<TagItem>('annotations', 'create', { name })
    this.treeCache = await call<TagItem[]>('annotations', 'tree')
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
    for (const [path, entry] of this.entries) {
      const ids = new Map<string, number>()
      for (const name of entry.tags) {
        const tagId = this.findTagId(name)
        if (tagId !== undefined) ids.set(name, tagId)
      }
      this.tagIds.set(path, ids)
    }
  }

  private async load(paths: string[]): Promise<void> {
    const unique = [...new Set(paths.filter(Boolean))].filter((path) => !this.pending.has(path))
    if (unique.length === 0) return
    unique.forEach((path) => this.pending.add(path))
    try {
      const result = await this.forPaths(unique)
      for (const path of unique) {
        const item = result[path]
        if (!item) continue
        this.entries.set(path, {
          favorite: item.favorite,
          rating: item.rating,
          tags: item.tags.map((tag) => tag.name)
        })
        this.notes.set(path, item.note)
        this.tagIds.set(path, new Map(item.tags.map((tag) => [tag.name, tag.id])))
      }
      if (this.running) this.emit()
    } finally {
      unique.forEach((path) => this.pending.delete(path))
    }
  }

  private async refreshKnown(): Promise<void> {
    if (!this.running) return
    await this.load([...this.entries.keys()])
    this.treeCache = await call<TagItem[]>('annotations', 'tree').catch(() => this.treeCache)
    this.rebuildTagIds()
    this.emit()
  }

  private setLocal(path: string, value: EntryMeta): void {
    this.entries.set(path, Object.freeze({ ...value, tags: [...new Set(value.tags)] }))
    this.emit()
  }

  private emit(): void {
    this.snapshot = Object.freeze(Object.fromEntries(this.entries))
    for (const listener of this.listeners) listener()
  }
}

export const annotationStore = new AnnotationStore()
