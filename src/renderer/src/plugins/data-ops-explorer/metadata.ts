import { useSyncExternalStore } from 'react'
import { call, getService } from '../../workbench/sdk'

export interface EntryMeta {
  favorite: boolean
  rating: number
  tags: string[]
}

interface AnnotationsService {
  get(path: string | null | undefined): EntryMeta
  toggleFavorite(path: string): boolean
  setRating(path: string, rating: number): void
  addTag(path: string, tag: string): boolean
  removeTag(path: string, tag: string): void
  allTags(): string[]
  subscribe(listener: () => void): () => void
  subscribePath(path: string, listener: () => void): () => void
  getSnapshot(): Readonly<Record<string, EntryMeta>>
  prime(paths: string[]): Promise<void>
}

const EMPTY: EntryMeta = Object.freeze({ favorite: false, rating: 0, tags: [] })
const noopSubscribe = (): (() => void) => () => undefined
let migrationPromise: Promise<void> | undefined

export const metadataStore = {
  get(path: string | null | undefined): EntryMeta {
    return getService<AnnotationsService>('annotations')?.get(path) ?? EMPTY
  },
  toggleFavorite(path: string): boolean {
    return getService<AnnotationsService>('annotations')?.toggleFavorite(path) ?? false
  },
  setRating(path: string, rating: number): void {
    getService<AnnotationsService>('annotations')?.setRating(path, rating)
  },
  addTag(path: string, tag: string): boolean {
    return getService<AnnotationsService>('annotations')?.addTag(path, tag) ?? false
  },
  removeTag(path: string, tag: string): void {
    getService<AnnotationsService>('annotations')?.removeTag(path, tag)
  },
  allTags(): string[] {
    return getService<AnnotationsService>('annotations')?.allTags() ?? []
  },
  subscribe(listener: () => void): () => void {
    return getService<AnnotationsService>('annotations')?.subscribe(listener) ?? noopSubscribe()
  },
  getSnapshot(): Readonly<Record<string, EntryMeta>> {
    return getService<AnnotationsService>('annotations')?.getSnapshot() ?? EMPTY_MAP
  },
  async prime(paths: string[]): Promise<void> {
    const service = getService<AnnotationsService>('annotations')
    if (!service) return
    for (let index = 0; index < paths.length; index += 1000) {
      await service.prime(paths.slice(index, index + 1000))
    }
  },
  async start(): Promise<void> {
    if (migrationPromise) return migrationPromise
    migrationPromise = this.importLegacyIfPresent()
    return migrationPromise
  },
  async importLegacyIfPresent(): Promise<void> {
    const key = 'desksuite.explorer.meta'
    const legacy = localStorage.getItem(key)
    if (!legacy) return
    try {
      const parsed: unknown = JSON.parse(legacy)
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return
      await call('annotations', 'importLegacy', parsed)
      localStorage.removeItem(key)
    } catch {
      // Keep the legacy value so a later startup can retry the migration.
    }
  }
}

const EMPTY_MAP: Readonly<Record<string, EntryMeta>> = Object.freeze({})

export function useEntryMeta(path: string): EntryMeta {
  const service = getService<AnnotationsService>('annotations')
  useSyncExternalStore(
    service ? (listener) => service.subscribePath(path, listener) : noopSubscribe,
    service ? () => service.get(path) : () => EMPTY
  )
  return service?.get(path) ?? EMPTY
}
