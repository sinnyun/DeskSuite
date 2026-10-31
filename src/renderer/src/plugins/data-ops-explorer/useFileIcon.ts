import { useEffect, useState } from 'react'
import type { RefObject } from 'react'
import { call } from '../../workbench/sdk'
import type { FsEntry } from './store'

const CACHE_LIMIT = 256
// .exe/.lnk 等文件的图标随文件本身变化，不能按扩展名复用。
const PER_FILE_ICON_EXTENSIONS = new Set(['appx', 'appref-ms', 'cpl', 'dll', 'exe', 'ico', 'lnk', 'msi', 'scr', 'url'])
const cache = new Map<string, string | null>()
const pending = new Map<string, Promise<string | null>>()

function cacheKey(entry: FsEntry): string {
  const dot = entry.name.lastIndexOf('.')
  const extension = dot > 0 ? entry.name.slice(dot + 1).toLowerCase() : ''
  if (!extension || PER_FILE_ICON_EXTENSIONS.has(extension)) return entry.path
  return `extension:${extension}`
}

function remember(key: string, value: string | null): void {
  if (cache.size >= CACHE_LIMIT && !cache.has(key)) {
    const oldest = cache.keys().next().value
    if (oldest !== undefined) cache.delete(oldest)
  }
  cache.set(key, value)
}

function fetchIcon(entry: FsEntry, key: string): Promise<string | null> {
  const cached = cache.get(key)
  if (cached !== undefined) return Promise.resolve(cached)
  const running = pending.get(key)
  if (running) return running
  const request = call<{ dataUrl: string }>('fileIcons', 'get', entry.path)
    .then((result) => result.dataUrl)
    .catch(() => null)
    .then((value) => {
      remember(key, value)
      pending.delete(key)
      return value
    })
  pending.set(key, request)
  return request
}

export function useFileIcon(entry: FsEntry, enabled: boolean, observeRef?: RefObject<Element | null>): string | null {
  const key = cacheKey(entry)
  const [src, setSrc] = useState<string | null>(() => cache.get(key) ?? null)
  useEffect(() => {
    if (!enabled || entry.isDirectory) {
      setSrc(null)
      return
    }
    const cached = cache.get(key)
    if (cached !== undefined) {
      setSrc(cached)
      return
    }
    setSrc(null)
    let alive = true
    const load = (): void => {
      void fetchIcon(entry, key).then((value) => { if (alive) setSrc(value) })
    }
    const target = observeRef?.current
    if (!target || typeof IntersectionObserver === 'undefined') load()
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          observer.disconnect()
          load()
        }
      }, { rootMargin: '320px' })
      observer.observe(target)
      return () => { alive = false; observer.disconnect() }
    }
    return () => { alive = false }
  }, [key, enabled, entry.path, entry.isDirectory, observeRef])
  return src
}
