import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Search, FolderOpen, X } from 'lucide-react'
import { call, definePlugin, useLayout, useUiKit } from '../../workbench/sdk'

interface SearchItem {
  path: string
  name: string
  kind: string
  size: number
  mtime_ms: number
  favorite: number | null
  rating: number | null
}

interface SearchResult {
  items: SearchItem[]
  total: number
  limit: number
  offset: number
}

export default definePlugin({
  id: 'data-ops-search-ui',
  name: '全局文件搜索',
  version: '1.0.0',
  description: '跨已扫描目录搜索文件名、路径和标注',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'search.open', slotId: 'top.actions', order: 40, component: SearchButton },
    { id: 'search.panel', slotId: 'floating.panels', order: 40, component: SearchPanel }
  ]
})

function SearchButton(): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const { openFloatingPanel } = useLayout()
  return <DesktopIconButton size="xs" icon={<Search className="h-3.5 w-3.5" />} tooltip="搜索已扫描文件" onClick={() => openFloatingPanel('global-search')} />
}

function SearchPanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopInput, DesktopButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayout()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'global-search'
  const [query, setQuery] = useState('')
  const [result, setResult] = useState<SearchResult | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [offset, setOffset] = useState(0)

  useEffect(() => {
    if (!isOpen) return
    const term = query.trim()
    if (!term) { setResult(null); setError(''); return }
    let alive = true
    setLoading(true)
    const timer = window.setTimeout(() => {
      void call<SearchResult>('search', 'query', { query: term, limit: 50, offset })
        .then((next) => { if (alive) { setResult(next); setError('') } })
        .catch((cause) => { if (alive) setError(cause instanceof Error ? cause.message : String(cause)) })
        .finally(() => { if (alive) setLoading(false) })
    }, 180)
    return () => { alive = false; window.clearTimeout(timer) }
  }, [isOpen, query, offset])

  return (
    <ThemeFloatingPanel title="全局搜索" icon={<Search className="h-3.5 w-3.5" />} badge={result ? `${result.total} 条` : undefined}
      isOpen={isOpen} onClose={closeFloatingPanel} initialX={220} initialY={100} initialWidth={680} initialHeight={520} minWidth={520} minHeight={360}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <DesktopInput icon={<Search className="h-3.5 w-3.5" />} placeholder="搜索已扫描的名称或路径…" value={query}
          clearable onClear={() => { setQuery(''); setOffset(0) }} onChange={(event) => { setQuery(event.target.value); setOffset(0) }} />
        <div className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--ds-border)] dark:border-[var(--ds-border)]">
          {!query.trim() ? <p className="p-4 text-xs text-[var(--ds-text-muted)]">输入关键词搜索已扫描的文件。未扫描的目录仍可直接浏览。</p>
            : error ? <p role="alert" className="p-4 text-xs text-[var(--ds-status-danger)]">{error}</p>
              : !result || loading ? <p className="p-4 text-xs text-[var(--ds-text-muted)]">正在搜索…</p>
                : result.items.length === 0 ? <p className="p-4 text-xs text-[var(--ds-text-muted)]">没有找到结果。请确认目标目录已建立索引。</p>
                  : <ul className="divide-y divide-[var(--ds-border)] dark:divide-[var(--ds-border)]">
                    {result.items.map((item) => <li key={item.path} className="flex items-center gap-2 px-3 py-2 hover:bg-[var(--ds-surface-subtle)] dark:hover:bg-[var(--ds-surface-muted)]">
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-xs font-medium">{item.name}</div>
                        <div className="truncate font-mono text-xs text-[var(--ds-text-muted)]" title={item.path}>{item.path}</div>
                      </div>
                      <span className="shrink-0 text-xs text-[var(--ds-text-muted)]">{item.kind}{item.rating ? ` · ★${item.rating}` : ''}{item.favorite ? ' · 收藏' : ''}</span>
                      <DesktopButton size="xs" variant="ghost" icon={<FolderOpen className="h-3 w-3" />} onClick={() => void call('filesystem', 'reveal', item.path)}>定位</DesktopButton>
                    </li>)}
                  </ul>}
        </div>
        {result && <div className="flex items-center justify-between text-xs text-[var(--ds-text-muted)]">
          <span>{Math.min(result.total, result.offset + result.items.length)} / {result.total}</span>
          <div className="flex gap-1">
            <DesktopButton size="xs" variant="ghost" disabled={offset === 0} onClick={() => setOffset(Math.max(0, offset - 50))}>上一页</DesktopButton>
            <DesktopButton size="xs" variant="ghost" disabled={offset + result.items.length >= result.total} onClick={() => setOffset(offset + 50)}>下一页</DesktopButton>
            <DesktopButton size="xs" variant="ghost" icon={<X className="h-3 w-3" />} onClick={closeFloatingPanel}>关闭</DesktopButton>
          </div>
        </div>}
      </div>
    </ThemeFloatingPanel>
  )
}
