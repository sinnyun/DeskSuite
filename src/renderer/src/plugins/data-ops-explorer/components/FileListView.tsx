import { dragFiles } from '../drag'
import type { ReactElement } from 'react'
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from 'react'
import {
  ArrowDown,
  ArrowUp,
  CheckSquare2,
  FolderOpen,
  Square,
  Star
} from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import {
  explorerStore,
  hasActiveFilters,
  useCurrentExplorerStore,
  useExplorer,
  visibleEntries,
  type FsEntry,
  type SortField
} from '../store'
import { useEntryMeta } from '../metadata'
import { EntryIcon } from '../EntryIcon'
import { KIND_LABEL, formatBytes, formatDate } from '../format'
import { useVirtualizer } from '../useVirtualizer'
import { selectionModeFromEvent } from '../selection'

const ROW_HEIGHT = 32

interface ListColumns {
  tags: boolean
  kind: boolean
  size: boolean
  modified: boolean
}

function useListColumns(): [(node: HTMLDivElement | null) => void, ListColumns] {
  const [width, setWidth] = useState(0)
  const observerRef = useRef<ResizeObserver | null>(null)

  const attach = useCallback((node: HTMLDivElement | null) => {
    observerRef.current?.disconnect()
    if (!node) return
    const update = (): void => setWidth(node.getBoundingClientRect().width)
    update()
    const observer = new ResizeObserver(update)
    observer.observe(node)
    observerRef.current = observer
  }, [])

  useEffect(() => () => observerRef.current?.disconnect(), [])

  return [
    attach,
    {
      tags: width >= 900,
      kind: width >= 620,
      size: width >= 740,
      modified: width >= 480
    }
  ]
}

function SortHeader({ field, label, className }: { field: SortField; label: string; className: string }): ReactElement {
  const { DesktopButton } = useUiKit()
  const state = useExplorer()
  const active = state.sortField === field
  return (
    <DesktopButton
      size="xs"
      variant="ghost"
      onClick={() => explorerStore.setSort(field)}
      title={`按${label}排序`}
      className={`!h-auto !rounded-none !px-2 !py-1.5 gap-1 text-xs font-semibold ${
        active ? '!text-[var(--ds-accent)]' : '!text-[var(--ds-text-muted)] hover:!text-[var(--ds-text-primary)]'
      } ${className}`}
    >
      <span className="truncate">{label}</span>
      {active && (state.sortOrder === 'asc' ? <ArrowUp className="w-3 h-3" /> : <ArrowDown className="w-3 h-3" />)}
    </DesktopButton>
  )
}

function Row({
  entry,
  selected,
  focused,
  top,
  columns
}: {
  entry: FsEntry
  selected: boolean
  focused: boolean
  top: number
  columns: ListColumns
}): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const meta = useEntryMeta(entry.path)

  return (
    <div
      role="row"
      aria-selected={selected}
      onClick={(event) => explorerStore.select(entry.path, selectionModeFromEvent(event))}
      onDoubleClick={() => void explorerStore.openEntry(entry)}
      draggable={!entry.isDirectory}
      onDragStart={(event) => dragFiles(event, entry)}
      style={{ top: `${top}px`, height: `${ROW_HEIGHT}px` }}
      className={`absolute left-0 right-0 flex items-center px-2 text-xs cursor-pointer border-b border-[var(--ds-border)] transition-colors ${
        selected
          ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:bg-[var(--ds-accent-soft)] dark:text-[var(--ds-accent-strong)]'
          : 'text-[var(--ds-text-primary)] hover:bg-[var(--ds-hover-overlay)]'
      } ${focused && selected ? 'ring-1 ring-inset ring-[var(--ds-accent)]/40 dark:ring-[var(--ds-accent-strong)]/40' : ''}`}
    >
      <DesktopIconButton
        size="xs"
        variant="default"
        icon={<Star
          className={`w-3.5 h-3.5 ${
            meta.favorite ? 'text-[var(--ds-status-warning)] fill-[var(--ds-status-warning)]' : 'text-[var(--ds-text-secondary)] hover:text-[var(--ds-status-warning)]'
          }`}
        />}
        title={meta.favorite ? '取消收藏' : '添加收藏'}
        onClick={(event) => {
          event.stopPropagation()
          explorerStore.toggleFavorite(entry.path)
        }}
        className="!w-6 !h-8 !rounded shrink-0"
      />

      <div className="flex items-center gap-2 flex-1 min-w-0">
        <EntryIcon kind={entry.kind} className="w-4 h-4 shrink-0" />
        <span data-ds-type="body" style={{ color: selected ? 'var(--ds-accent)' : undefined }} className={`ds-type-body truncate ${entry.isDirectory ? 'font-medium' : ''}`}>{entry.name}</span>
      </div>

      {columns.tags && (
        <div className="w-40 shrink-0 flex items-center gap-1 px-1 overflow-hidden">
          {meta.tags.slice(0, 2).map((tag) => (
            <span
              key={tag}
              title={tag}
              className="px-1.5 py-0.5 rounded-full text-xs bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)] truncate max-w-20"
            >
              {tag}
            </span>
          ))}
          {meta.tags.length > 2 && (
            <span className="text-xs text-[var(--ds-text-subtle)]">+{meta.tags.length - 2}</span>
          )}
        </div>
      )}

      {columns.kind && (
        <div data-ds-type="meta" className="ds-type-meta w-20 shrink-0">{KIND_LABEL[entry.kind]}</div>
      )}
      {columns.size && (
        <div data-ds-type="data" className="ds-type-data w-24 shrink-0 text-right font-mono">
          {entry.isDirectory ? '—' : formatBytes(entry.size)}
        </div>
      )}
      {columns.modified && (
        <div data-ds-type="data" className="ds-type-data w-36 shrink-0 text-right font-mono">
          {formatDate(entry.modifiedAt)}
        </div>
      )}
    </div>
  )
}

export function FileListView({ entries: suppliedEntries, embedded = false }: { entries?: FsEntry[]; embedded?: boolean } = {}): ReactElement {
  const { DesktopButton, DesktopIconButton } = useUiKit()
  const state = useExplorer()
  const paneStore = useCurrentExplorerStore()
  const entries = suppliedEntries ?? visibleEntries(state)
  const allSelected = entries.length > 0 && entries.every(entry => state.selectedPaths.includes(entry.path))
  const [attachRoot, columns] = useListColumns()
  const { containerRef, virtualItems, totalSize, virtualActive } = useVirtualizer({
    count: entries.length,
    itemHeight: ROW_HEIGHT
  })
  const lastSavedAnchor = useRef<string | null>(null)

  useLayoutEffect(() => {
    if (embedded) return
    const container = containerRef.current
    if (!container) return
    if (!state.scrollAnchor.path) {
      container.scrollTop = 0
      lastSavedAnchor.current = null
      return
    }
    const index = entries.findIndex((entry) => entry.path === state.scrollAnchor.path)
    if (index >= 0) {
      container.scrollTop = index * ROW_HEIGHT + state.scrollAnchor.offset
      lastSavedAnchor.current = state.scrollAnchor.path
    }
  }, [state.path, state.scrollAnchor.path])

  const rememberScroll = (): void => {
    if (embedded) return
    const container = containerRef.current
    if (!container) return
    const index = Math.max(0, Math.min(entries.length - 1, Math.floor(container.scrollTop / ROW_HEIGHT)))
    const path = entries[index]?.path ?? null
    if (path && path !== lastSavedAnchor.current) {
      lastSavedAnchor.current = path
      paneStore.setScrollAnchor(path, container.scrollTop - index * ROW_HEIGHT)
    }
  }

  if (!state.path && !state.tagFocus) {
    return (
      <div ref={attachRoot} className="flex flex-col items-center justify-center gap-3 h-full min-h-64 p-8 text-xs text-[var(--ds-text-subtle)]">
        <FolderOpen className="w-8 h-8 opacity-40" />
        <span>尚未打开任何目录</span>
        <DesktopButton
          size="sm"
          variant="primary"
          icon={<FolderOpen className="w-3.5 h-3.5" />}
          onClick={() => void explorerStore.pickAndNavigate()}
        >
          打开目录
        </DesktopButton>
      </div>
    )
  }

  return (
    <div data-entry-view="list" ref={attachRoot} style={embedded ? { height: Math.min(420, 34 + entries.length * ROW_HEIGHT) } : undefined} className="flex flex-col h-full min-h-0">
      <div className="flex items-center px-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)]/70 shrink-0 sticky top-0 z-10">
        <DesktopIconButton
          size="xs"
          icon={allSelected ? <CheckSquare2 className="w-3.5 h-3.5" /> : <Square className="w-3.5 h-3.5" />}
          onClick={() => {
            if (!embedded) { if (allSelected) explorerStore.clearSelection(); else explorerStore.selectAll(); return }
            entries.forEach(entry => { if (allSelected || !state.selectedPaths.includes(entry.path)) explorerStore.select(entry.path, 'toggle') })
          }}
          title={allSelected ? '取消全选' : '全选当前条目'}
          className="!w-6 !h-8 !rounded shrink-0 text-[var(--ds-text-subtle)] hover:!text-[var(--ds-accent)]"
        />
        <SortHeader field="name" label="名称" className="flex-1 min-w-0" />
        {columns.tags && (
          <span className="w-40 shrink-0 px-2 py-1.5 text-xs font-semibold text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">
            标签
          </span>
        )}
        {columns.kind && <SortHeader field="kind" label="类型" className="w-20 shrink-0" />}
        {columns.size && <SortHeader field="size" label="大小" className="w-24 shrink-0 text-right" />}
        {columns.modified && (
          <SortHeader field="modifiedAt" label="修改时间" className="w-36 shrink-0 text-right" />
        )}
      </div>

      {state.status === 'error' && (
        <div className="flex items-center gap-3 m-3 p-3 rounded-xl bg-[var(--ds-status-danger-soft)] dark:bg-[var(--ds-status-danger-soft)] text-xs text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]">
          <span className="flex-1 break-all">读取目录失败：{state.error}</span>
          <DesktopIconButton
            size="xs"
            icon={<ArrowUp className="w-3.5 h-3.5" />}
            tooltip="返回上一级"
            onClick={explorerStore.goUp}
          />
          <DesktopButton size="xs" variant="subtle" onClick={explorerStore.refresh}>
            重试
          </DesktopButton>
        </div>
      )}

      {state.status !== 'error' && entries.length === 0 && (
        <div className="flex-1 flex items-center justify-center p-8 text-xs text-[var(--ds-text-subtle)]">
          {state.status === 'loading'
            ? '正在读取目录…'
            : hasActiveFilters(state)
              ? '没有符合筛选条件的条目'
              : '空文件夹'}
        </div>
      )}

      {entries.length > 0 && (
        <div ref={containerRef} onScroll={rememberScroll} className="flex-1 min-h-0 overflow-auto relative">
          <div style={{ height: `${totalSize}px` }} className="relative">
            {virtualItems.map((item) => {
              const entry = entries[item.index]
              return (
                <Row
                  key={entry.path}
                  entry={entry}
                  selected={state.selectedPaths.includes(entry.path)}
                  focused={state.focusedPath === entry.path}
                  top={item.start}
                  columns={columns}
                />
              )
            })}
          </div>
          {virtualActive && (
            <div className="sticky bottom-2 left-1/2 -translate-x-1/2 w-max px-2.5 py-1 rounded-full bg-[var(--ds-surface)]/95 border border-[var(--ds-border)] shadow-xs text-xs font-mono text-[var(--ds-text-muted)]">
              虚拟滚动 · 共 {entries.length} 行
            </div>
          )}
        </div>
      )}
    </div>
  )
}
