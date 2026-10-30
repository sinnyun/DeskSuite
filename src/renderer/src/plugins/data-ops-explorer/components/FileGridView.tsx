import { dragFiles } from '../drag'
import type { ReactElement } from 'react'
import { FolderOpen } from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import {
  explorerStore,
  hasActiveFilters,
  useExplorer,
  visibleEntries,
  type FsEntry
} from '../store'
import { useEntryMeta } from '../metadata'
import { FileCard } from './FileCard'
import { selectionModeFromEvent } from '../selection'

const MAX_TILES = 400

function Tile({ entry, selected }: { entry: FsEntry; selected: boolean }): ReactElement {
  const meta = useEntryMeta(entry.path)
  return <FileCard entry={entry} selected={selected} rating={meta.rating} favorite={meta.favorite}
    onSelect={(item, event) => explorerStore.select(item.path, selectionModeFromEvent(event))}
    onOpen={(item) => void explorerStore.openEntry(item)}
    onToggleFavorite={() => explorerStore.toggleFavorite(entry.path)}
    onDragStart={(event) => dragFiles(event, entry)} />
}

export function FileGridView({ entries: suppliedEntries, embedded = false, singleColumn = false }: { entries?: FsEntry[]; embedded?: boolean; singleColumn?: boolean } = {}): ReactElement {
  const { DesktopButton } = useUiKit()
  const state = useExplorer()
  const entries = suppliedEntries ?? visibleEntries(state)
  const tiles = entries.slice(0, MAX_TILES)

  if (!state.path && !state.tagFocus) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 h-full min-h-64 p-8 text-xs text-[var(--ds-text-subtle)]">
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

  if (state.status === 'error') {
    return (
      <div className="m-3 p-3 rounded-xl bg-[var(--ds-status-danger-soft)] dark:bg-[var(--ds-status-danger-soft)] text-xs text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)] break-all">
        读取目录失败：{state.error}
      </div>
    )
  }

  if (entries.length === 0) {
    return (
      <div className="flex items-center justify-center p-8 text-xs text-[var(--ds-text-subtle)]">
        {state.status === 'loading'
          ? '正在读取目录…'
          : hasActiveFilters(state)
            ? '没有符合筛选条件的条目'
            : '空文件夹'}
      </div>
    )
  }

  return (
    <div data-entry-view="grid" className={embedded ? '' : 'p-3'}>
      <div data-card-layout={singleColumn ? 'single-column' : 'grid'} className={singleColumn ? 'grid grid-cols-[152px] justify-center gap-3' : 'grid gap-3 grid-cols-[repeat(auto-fill,152px)]'}>
        {tiles.map((entry) => (
          <Tile key={entry.path} entry={entry} selected={state.selectedPaths.includes(entry.path)} />
        ))}
      </div>
      {entries.length > MAX_TILES && (
        <div className="mt-3 text-center text-xs text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]">
          条目过多，卡片视图仅展示前 {MAX_TILES} 项，请使用列表视图或筛选
        </div>
      )}
    </div>
  )
}
