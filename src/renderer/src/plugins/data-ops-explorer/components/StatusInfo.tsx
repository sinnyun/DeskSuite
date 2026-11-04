import type { ReactElement } from 'react'
import { HardDrive, Zap } from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import { explorerStore, hasActiveFilters, useExplorerShallow, visibleEntries } from '../store'
import { formatBytes } from '../format'

export function StatusInfo(): ReactElement {
  const { DesktopButton } = useUiKit()
  const state = useExplorerShallow((s) => ({
    entries: s.entries, search: s.search, kindFilter: s.kindFilter, tagFilter: s.tagFilter,
    favoriteOnly: s.favoriteOnly, minRating: s.minRating, sortField: s.sortField, sortOrder: s.sortOrder,
    path: s.path, focusedPath: s.focusedPath, viewMode: s.viewMode, tagFocus: s.tagFocus, selectedPaths: s.selectedPaths,
    truncated: s.truncated
  }))
  const visible = visibleEntries(state).length
  const folders = state.entries.filter((entry) => entry.isDirectory).length
  const files = state.entries.length - folders
  const totalSize = state.entries.reduce((sum, entry) => sum + (entry.isDirectory ? 0 : entry.size), 0)
  const focused = state.focusedPath
    ? state.entries.find((entry) => entry.path === state.focusedPath)
    : undefined
  const virtualActive = state.viewMode === 'list' && visible > 30

  return (
    <div data-ds-type="meta" data-context-zone="explorer.status" className="ds-type-meta flex items-center gap-2 min-w-0">
      <span className="flex items-center gap-1 min-w-0">
        <HardDrive className="w-3 h-3 shrink-0" />
        <span
          className="truncate max-w-72"
          title={state.tagFocus ? `标签聚合：${state.tagFocus.name}` : state.path ?? '未打开目录'}
        >
          {state.tagFocus ? `标签聚合：${state.tagFocus.name}` : state.path ?? '未打开目录'}
        </span>
      </span>
      <span className="text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">|</span>
      <span className="font-mono tabular-nums shrink-0">
        {folders} 文件夹 / {files} 文件
      </span>
      {state.selectedPaths.length > 0 && (
          <DesktopButton
            size="xs"
            variant="ghost"
            active
          onClick={() => explorerStore.clearSelection()}
          title="点击清除选择"
            className="!h-auto shrink-0 !px-1.5 !py-0.5 rounded-md font-mono tabular-nums"
        >
          已选 {state.selectedPaths.length} 项
          </DesktopButton>
      )}
      {focused && (
        <span className="font-mono shrink-0 max-w-40 truncate" title={focused.name}>
          {focused.name}
        </span>
      )}
      {hasActiveFilters(state) && (
          <DesktopButton
            size="xs"
            variant="ghost"
          onClick={explorerStore.clearFilters}
          title="点击清除筛选"
            className="!h-auto shrink-0 !px-1 !py-0.5 font-mono tabular-nums text-[var(--ds-accent)]"
        >
          筛选 {visible}/{state.entries.length}
          </DesktopButton>
      )}
      <span className="font-mono tabular-nums shrink-0">共 {formatBytes(totalSize)}</span>
      {virtualActive && (
          <span className="flex items-center gap-0.5 shrink-0 text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)] font-mono">
          <Zap className="w-3 h-3" />
          虚拟滚动
        </span>
      )}
          {state.truncated && <span className="text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)] shrink-0">还有目录项</span>}
    </div>
  )
}
