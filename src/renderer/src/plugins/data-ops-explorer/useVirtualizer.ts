import { useEffect, useLayoutEffect, useRef, useState } from 'react'
import type { RefObject } from 'react'

interface VirtualizerOptions {
  count: number
  itemHeight: number
  overscan?: number
}

export interface VirtualItem {
  index: number
  start: number
  size: number
}

export interface VirtualizerResult {
  containerRef: RefObject<HTMLDivElement | null>
  virtualItems: VirtualItem[]
  totalSize: number
  virtualActive: boolean
}

export function useVirtualizer({
  count,
  itemHeight,
  overscan = 8
}: VirtualizerOptions): VirtualizerResult {
  const containerRef = useRef<HTMLDivElement | null>(null)
  const [scrollTop, setScrollTop] = useState(0)
  const [viewportHeight, setViewportHeight] = useState(600)
  const rafRef = useRef<number | null>(null)

  useLayoutEffect(() => {
    const element = containerRef.current
    if (!element) return
    const measure = (): void => {
      setViewportHeight(element.clientHeight || 600)
      setScrollTop(element.scrollTop)
    }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  useEffect(() => {
    const element = containerRef.current
    if (!element) return
    const onScroll = (): void => {
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
      rafRef.current = requestAnimationFrame(() => setScrollTop(element.scrollTop))
    }
    element.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      element.removeEventListener('scroll', onScroll)
      if (rafRef.current !== null) cancelAnimationFrame(rafRef.current)
    }
  }, [])

  const totalSize = count * itemHeight

  if (count <= 30) {
    return {
      containerRef,
      virtualItems: Array.from({ length: count }, (_, index) => ({
        index,
        start: index * itemHeight,
        size: itemHeight
      })),
      totalSize,
      virtualActive: false
    }
  }

  const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan)
  const endIndex = Math.min(count, Math.ceil((scrollTop + viewportHeight) / itemHeight) + overscan)
  const virtualItems: VirtualItem[] = []
  for (let index = startIndex; index < endIndex; index++) {
    virtualItems.push({ index, start: index * itemHeight, size: itemHeight })
  }

  return { containerRef, virtualItems, totalSize, virtualActive: true }
}
