import '../toolbar.css'
import type { ComponentType, ReactElement } from 'react'
import {
  ArrowDownUp,
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Archive,
  Filter,
  FilterX,
  FolderOpen,
  Images,
  LayoutGrid,
  List,
  RefreshCw,
  Search,
  Star
} from 'lucide-react'
import {
  getService,
  useUiKit,
  type BasketService
} from '../../../workbench/sdk'
import {
  explorerStore,
  hasActiveFilters,
  useExplorerShallow,
  type ExplorerViewMode,
  type KindFilter,
  type SortField
} from '../store'
import { metadataStore } from '../metadata'
import { KIND_LABEL } from '../format'
import { ExplorerBreadcrumbs } from './ExplorerBreadcrumbs'
import { WorkspaceToolbar } from './WorkspaceToolbar'

interface GroupedToolbarService {
  toolbarComponent: ComponentType
}

const VIEW_ICONS: Record<Exclude<ExplorerViewMode, 'grouped'>, ReactElement> = {
  list: <List className="w-3.5 h-3.5" />,
  grid: <LayoutGrid className="w-3.5 h-3.5" />,
  gallery: <Images className="w-3.5 h-3.5" />
}

const VIEW_LABELS: Record<Exclude<ExplorerViewMode, 'grouped'>, string> = {
  list: '列表视图',
  grid: '卡片视图',
  gallery: '画廊视图'
}

const KIND_OPTIONS: { value: KindFilter; label: string }[] = [
  { value: 'all', label: '全部类型' },
  ...(
    ['folder', 'code', 'image', 'document', 'data', 'archive', 'video', 'audio', 'other'] as const
  ).map((kind) => ({ value: kind, label: KIND_LABEL[kind] }))
]

const SORT_OPTIONS: { value: SortField; label: string }[] = [
  { value: 'name', label: '按名称' },
  { value: 'modifiedAt', label: '按修改时间' },
  { value: 'size', label: '按大小' },
  { value: 'kind', label: '按类型' },
  { value: 'rating', label: '按评分' }
]

const RATING_OPTIONS = [
  { value: '0', label: '全部评分' },
  { value: '3', label: '≥ 3 星' },
  { value: '4', label: '≥ 4 星' },
  { value: '5', label: '5 星' }
]

export function ExplorerToolbar(): ReactElement {
  const { DesktopIconButton, DesktopInput, DesktopSelect } = useUiKit()
  const state = useExplorerShallow((s) => ({
    tagFilter: s.tagFilter, canBack: s.canBack, canForward: s.canForward, parent: s.parent,
    status: s.status, search: s.search, kindFilter: s.kindFilter, minRating: s.minRating,
    favoriteOnly: s.favoriteOnly, sortField: s.sortField, sortOrder: s.sortOrder, viewMode: s.viewMode
  }))
  const basketAvailable = getService<BasketService>('basket') !== undefined
  const GroupedToolbar = getService<GroupedToolbarService>('explorerGroupedView')?.toolbarComponent
  const knownTags = metadataStore.allTags()
  const tags =
    state.tagFilter && !knownTags.includes(state.tagFilter)
      ? [state.tagFilter, ...knownTags]
      : knownTags

  return (
    <div className="flex min-w-0 flex-col" data-file-explorer-toolbar>
      <div data-toolbar-row="address" className="flex h-10 min-w-0 items-center gap-1.5 border-b border-[var(--ds-border)] px-1 dark:border-[var(--ds-border)]">
        <div className="flex items-center gap-0.5 shrink-0">
          <DesktopIconButton
            size="xs"
            icon={<ArrowLeft className="w-3.5 h-3.5" />}
            tooltip="后退"
            disabled={!state.canBack}
            className={!state.canBack ? 'opacity-30' : ''}
            onClick={explorerStore.goBack}
          />
          <DesktopIconButton
            size="xs"
            icon={<ArrowRight className="w-3.5 h-3.5" />}
            tooltip="前进"
            disabled={!state.canForward}
            className={!state.canForward ? 'opacity-30' : ''}
            onClick={explorerStore.goForward}
          />
          <DesktopIconButton
            size="xs"
            icon={<ArrowUp className="w-3.5 h-3.5" />}
            tooltip="上一级"
            disabled={!state.parent}
            className={!state.parent ? 'opacity-30' : ''}
            onClick={explorerStore.goUp}
          />
          <DesktopIconButton
            size="xs"
            icon={<RefreshCw className={`w-3.5 h-3.5 ${state.status === 'loading' ? 'animate-spin' : ''}`} />}
            tooltip="刷新当前目录"
            onClick={explorerStore.refresh}
          />

          <DesktopIconButton size="xs" icon={<FolderOpen className="h-3.5 w-3.5" />} tooltip="打开工作区目录" onClick={() => void explorerStore.pickAndNavigate()} />
        </div>

        <div data-address-breadcrumbs className="flex items-center min-w-40 flex-1 h-7 px-2 rounded-md border border-[var(--ds-border-strong)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border-strong)] dark:bg-[var(--ds-surface-raised)]">
          <ExplorerBreadcrumbs />
        </div>

        <div className="w-56 shrink min-w-28">
          <DesktopInput
            icon={<Search className="w-3.5 h-3.5" />}
            placeholder="在当前目录筛选…"
            value={state.search}
            clearable
            onClear={() => explorerStore.setSearch('')}
            onChange={(event) => explorerStore.setSearch(event.target.value)}
          />
        </div>

        {basketAvailable && (
          <DesktopIconButton
            size="xs"
            icon={<Archive className="w-3.5 h-3.5" />}
            tooltip="加入暂存篮"
            onClick={explorerStore.addSelectionToBasket}
          />
        )}
      </div>

      <div data-toolbar-row="view" className="flex min-h-10 min-w-0 flex-wrap items-center gap-1.5 px-1 py-0.5">
        <div data-toolbar-filters className="flex flex-wrap items-center gap-1.5">
        <WorkspaceToolbar />
        <div className="mx-0.5 h-4 shrink-0 border-l border-[var(--ds-border-strong)] dark:border-[var(--ds-border-strong)]" />
        <DesktopSelect
          className="w-[104px] shrink-0"
          title="按文件类型筛选"
          icon={<Filter className="w-3.5 h-3.5" />}
          value={state.kindFilter}
          options={KIND_OPTIONS}
          onChange={(value) => explorerStore.setKindFilter(value as KindFilter)}
        />

        {(
          <DesktopSelect
            className="w-[104px] shrink-0"
            title="按标签筛选"
            value={state.tagFilter ?? ''}
            options={[{ value: '', label: '全部标签' }, ...tags.map((tag) => ({ value: tag, label: tag }))]}
            onChange={(value) => explorerStore.setTagFilter(value || null)}
          />
        )}

        <DesktopSelect
          className="w-[104px] shrink-0"
          title="按评分筛选"
          icon={<Star className="h-3 w-3 fill-[var(--ds-status-warning)] text-[var(--ds-status-warning)]" />}
          value={String(state.minRating)}
          options={RATING_OPTIONS}
          onChange={(value) => explorerStore.setMinRating(Number(value))}
        />

        <DesktopIconButton
          size="xs"
          active={state.favoriteOnly}
          icon={<Star className={`w-3.5 h-3.5 ${state.favoriteOnly ? 'fill-current' : ''}`} />}
          tooltip={state.favoriteOnly ? '显示全部条目' : '仅显示收藏'}
          onClick={() => explorerStore.setFavoriteOnly(!state.favoriteOnly)}
        />

        {hasActiveFilters(state) && (
          <DesktopIconButton
            size="xs"
            icon={<FilterX className="w-3.5 h-3.5" />}
            tooltip="清除全部筛选"
            onClick={explorerStore.clearFilters}
          />
        )}

        </div>
        <div data-toolbar-display className="ml-auto flex items-center gap-1 shrink-0">
          <DesktopSelect
            className="w-[90px] shrink-0"
            title="排序字段"
            value={state.sortField}
            options={SORT_OPTIONS}
            onChange={(value) => explorerStore.setSort(value as SortField)}
          />

          <DesktopIconButton
            size="xs"
            icon={<ArrowDownUp className="w-3.5 h-3.5" />}
            tooltip={state.sortOrder === 'asc' ? '切换为降序' : '切换为升序'}
            onClick={() => explorerStore.setSort(state.sortField)}
          />

          <div data-view-buttons className="flex items-center shrink-0">
            {(['grid', 'gallery', 'list'] as const).map((mode) => (
              <DesktopIconButton
                key={mode}
                size="xs"
                data-view-mode={mode}
                aria-pressed={state.viewMode === mode}
                active={state.viewMode === mode}
                tooltip={VIEW_LABELS[mode]}
                icon={VIEW_ICONS[mode]}
                onClick={() => explorerStore.setViewMode(mode)}
              />
            ))}
          </div>
          {GroupedToolbar && <GroupedToolbar />}
        </div>
      </div>
    </div>
  )
}
