import { useEffect, useLayoutEffect, useRef, useState, useCallback } from 'react';

interface UseVirtualizerOptions {
  count: number;
  itemHeight: number;
  overscan?: number;
  enabled?: boolean;
}

export interface VirtualItem {
  index: number;
  start: number;
  size: number;
}

export interface VirtualizerResult {
  containerRef: React.RefObject<HTMLDivElement | null>;
  virtualItems: VirtualItem[];
  totalSize: number;
  startIndex: number;
  endIndex: number;
  isVirtualActive: boolean;
  visibleCount: number;
  domReductionRatio: number;
}

export function useVirtualizer({
  count,
  itemHeight,
  overscan = 8,
  enabled = true,
}: UseVirtualizerOptions): VirtualizerResult {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const [scrollTop, setScrollTop] = useState(0);
  const [viewportHeight, setViewportHeight] = useState(600);
  const rafIdRef = useRef<number | null>(null);

  // Measure container height
  useLayoutEffect(() => {
    const el = containerRef.current;
    if (!el) return;

    const measure = () => {
      if (el) {
        setViewportHeight(el.clientHeight || 600);
        setScrollTop(el.scrollTop);
      }
    };

    measure();

    const resizeObserver = new ResizeObserver(() => {
      measure();
    });
    resizeObserver.observe(el);

    return () => {
      resizeObserver.disconnect();
    };
  }, []);

  // Optimized smooth scroll listener with requestAnimationFrame
  useEffect(() => {
    const el = containerRef.current;
    if (!el || !enabled) return;

    const onScroll = () => {
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
      rafIdRef.current = requestAnimationFrame(() => {
        setScrollTop(el.scrollTop);
      });
    };

    el.addEventListener('scroll', onScroll, { passive: true });
    return () => {
      el.removeEventListener('scroll', onScroll);
      if (rafIdRef.current !== null) {
        cancelAnimationFrame(rafIdRef.current);
      }
    };
  }, [enabled]);

  const totalSize = count * itemHeight;

  // If disabled or few items (< 30), render all
  if (!enabled || count <= 30) {
    const virtualItems: VirtualItem[] = Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * itemHeight,
      size: itemHeight,
    }));
    return {
      containerRef,
      virtualItems,
      totalSize,
      startIndex: 0,
      endIndex: count,
      isVirtualActive: false,
      visibleCount: count,
      domReductionRatio: 0,
    };
  }

  // Calculate visible range with overscan
  const rawStart = Math.floor(scrollTop / itemHeight);
  const rawEnd = Math.ceil((scrollTop + viewportHeight) / itemHeight);

  const startIndex = Math.max(0, rawStart - overscan);
  const endIndex = Math.min(count, rawEnd + overscan);

  const virtualItems: VirtualItem[] = [];
  for (let i = startIndex; i < endIndex; i++) {
    virtualItems.push({
      index: i,
      start: i * itemHeight,
      size: itemHeight,
    });
  }

  const visibleCount = virtualItems.length;
  const domReductionRatio = count > 0 ? Math.round(((count - visibleCount) / count) * 1000) / 10 : 0;

  return {
    containerRef,
    virtualItems,
    totalSize,
    startIndex,
    endIndex,
    isVirtualActive: true,
    visibleCount,
    domReductionRatio,
  };
}
