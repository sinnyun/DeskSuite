import { call } from '../../workbench/sdk'

const EDGE = 320
const MAX_CACHE_ENTRIES = 80
const MAX_CACHE_BYTES = 3.5 * 1024 * 1024
const cache = new Map<string, string>()
const queued = new Map<string, { path: string; resolvers: Array<(value: string | null) => void> }>()
let flushScheduled = false
let cacheBytes = 0

function remember(key: string, value: string): void {
  const previous = cache.get(key)
  if (previous) cacheBytes -= previous.length
  cache.delete(key)
  cache.set(key, value)
  cacheBytes += value.length
  while (cache.size > MAX_CACHE_ENTRIES || cacheBytes > MAX_CACHE_BYTES) {
    const oldest = cache.keys().next().value
    if (oldest === undefined) break
    const removed = cache.get(oldest)
    if (removed) cacheBytes -= removed.length
    cache.delete(oldest)
  }
}

function scheduleFlush(): void {
  if (flushScheduled) return
  flushScheduled = true
  setTimeout(() => {
    flushScheduled = false
    const batch = [...queued.entries()].slice(0, 64)
    for (const [key] of batch) queued.delete(key)
    if (!batch.length) return
    void call<Array<{ path: string; dataUrl: string | null }>>('thumbnails', 'getMany', batch.map(([, item]) => item.path), EDGE)
      .then((results) => {
        const byPath = new Map(results.map((result) => [result.path, result.dataUrl]))
        for (const [key, item] of batch) {
          const value = byPath.get(item.path) ?? null
          if (value) remember(key, value)
          for (const resolve of item.resolvers) resolve(value)
        }
      })
      .catch(() => {
        for (const [, item] of batch) for (const resolve of item.resolvers) resolve(null)
      })
      .finally(() => { if (queued.size) scheduleFlush() })
  }, 16)
}

export function requestThumbnail(path: string, identity = path): Promise<string | null> {
  const cached = cache.get(identity)
  if (cached) {
    cache.delete(identity)
    cache.set(identity, cached)
    return Promise.resolve(cached)
  }
  return new Promise((resolve) => {
    const item = queued.get(identity) ?? { path, resolvers: [] }
    item.resolvers.push(resolve)
    queued.set(identity, item)
    scheduleFlush()
  })
}
