import { call, callValidated, errorText, getService, log, type BasketService, type ContextMenuContext, type ContextMenuEntry, type ContextMenuItem, type ContextMenuService, type UiKit } from '../../workbench/sdk'
import { addSelectedBookmarks, bookmarkAction, openBookmark, type BookmarkGroup } from './bookmarks'
import { drivePreferencesSchema } from './drive-preferences-schema'
import { metadataStore } from './metadata'
import { explorerStore, hasActiveFilters, type ExplorerState, type FsEntry, type SortField } from './store'

const SEPARATOR: ContextMenuEntry = { separator: true, id: 'sep' }

let cachedGroups: BookmarkGroup[] = []
let networkDrivesShown = true

async function copyText(value: string): Promise<void> {
  await call('clipboard', 'writeText', value)
}

function promptApi(): UiKit['prompt'] | null {
  return getService<UiKit>('ui')?.prompt ?? null
}

function findEntry(path: string, state: ExplorerState): FsEntry | undefined {
  return [...state.entries, ...state.descendantEntries].find((entry) => entry.path === path)
}

function resolveEntryPath(target: Element): string | null {
  return target.closest('[data-entry-path]')?.getAttribute('data-entry-path') ?? null
}

function openInSystem(entry: FsEntry): void {
  void call('filesystem', 'open', entry.path).catch((error) => log('error', 'Explorer', `打开失败：${entry.name}`, errorText(error, '无法打开')))
}

function revealPath(path: string): void {
  void call('filesystem', 'reveal', path).catch((error) => log('error', 'Explorer', '定位失败', errorText(error, '无法定位')))
}

function sortLabel(field: SortField): string {
  return ({ name: '名称', size: '大小', modifiedAt: '修改时间', kind: '类型', rating: '评分' })[field]
}

function entryActionEntries(state: ExplorerState, paths: string[], extra: ContextMenuEntry[] = []): ContextMenuEntry[] {
  const entries = paths.map((path) => findEntry(path, state)).filter((entry): entry is FsEntry => Boolean(entry))
  if (entries.length === 0) return []
  const primary = entries[0]
  const names = entries.map((entry) => entry.name)
  const metas = entries.map((entry) => metadataStore.get(entry.path))
  const allFavorite = metas.every((meta) => meta.favorite)
  const allRated = (rating: number): boolean => metas.every((meta) => meta.rating === rating)
  const hasTag = (tag: string): boolean => metas.every((meta) => meta.tags.includes(tag))
  const basketAvailable = getService<BasketService>('basket') !== undefined

  const ratingSubmenu: ContextMenuEntry[] = [
    { id: 'rating-clear', label: '清除评分', checked: metas.every((meta) => meta.rating === 0), onSelect: () => entries.forEach((entry) => explorerStore.setRating(entry.path, 0)) },
    SEPARATOR,
    ...[1, 2, 3, 4, 5].map<ContextMenuItem>((rating) => ({
      id: `rating-${rating}`,
      label: `${rating} 星`,
      checked: allRated(rating),
      onSelect: () => entries.forEach((entry) => explorerStore.setRating(entry.path, rating))
    }))
  ]

  const items: ContextMenuEntry[] = [
    {
      id: 'open',
      label: entries.length === 1 ? (primary.isDirectory ? '进入文件夹' : '打开') : `打开 ${entries.length} 项`,
      onSelect: () => {
        if (entries.length === 1) {
          void explorerStore.openEntry(primary)
          return
        }
        for (const entry of entries) if (!entry.isDirectory) openInSystem(entry)
      }
    },
    { id: 'open-system', label: '在系统中打开', onSelect: () => entries.forEach(openInSystem) },
    { id: 'reveal', label: '在文件管理器中定位', onSelect: () => revealPath(primary.path) },
    { id: 'copy-path', label: '复制路径', onSelect: () => void copyText(paths.join('\n')).catch((error) => log('error', 'Explorer', '复制路径失败', errorText(error))) },
    { id: 'copy-name', label: '复制文件名', onSelect: () => void copyText(names.join('\n')).catch((error) => log('error', 'Explorer', '复制文件名失败', errorText(error))) },
    SEPARATOR,
    {
      id: 'favorite',
      label: '收藏',
      checked: allFavorite,
      onSelect: () => {
        for (const entry of entries) {
          if (metadataStore.get(entry.path).favorite === allFavorite) explorerStore.toggleFavorite(entry.path)
        }
      }
    },
    { id: 'rating', label: '评分', submenu: ratingSubmenu },
    {
      id: 'tags',
      label: '标签',
      submenu: (): ContextMenuEntry[] => [
        ...metadataStore.allTags().map<ContextMenuItem>((tag) => ({
          id: `tag-${tag}`,
          label: tag,
          checked: hasTag(tag),
          onSelect: () => {
            for (const entry of entries) {
              if (metadataStore.get(entry.path).tags.includes(tag)) explorerStore.removeTag(entry.path, tag)
              else explorerStore.addTag(entry.path, tag)
            }
          }
        })),
        SEPARATOR,
        {
          id: 'tag-new',
          label: '新建标签…',
          onSelect: () => {
            const dialog = promptApi()
            if (!dialog) return
            void dialog({ title: '新建标签', label: entries.length > 1 ? `为 ${entries.length} 个条目添加标签` : `为「${primary.name}」添加标签`, placeholder: '标签名称', confirmText: '添加' })
              .then((tag) => {
                const name = tag?.trim()
                if (!name) return
                for (const entry of entries) explorerStore.addTag(entry.path, name)
              })
              .catch((error) => log('error', 'Explorer', '新建标签失败', errorText(error)))
          }
        }
      ]
    },
    ...(basketAvailable ? [{ id: 'basket', label: '加入暂存篮', onSelect: () => explorerStore.addSelectionToBasket() } satisfies ContextMenuItem] : []),
    ...extra
  ]
  return items
}

function workspaceEntries(context: ContextMenuContext): ContextMenuEntry[] {
  const state = explorerStore.getState()
  const entryPath = resolveEntryPath(context.target)
  if (entryPath) {
    if (!state.selectedPaths.includes(entryPath)) explorerStore.select(entryPath, 'replace')
    const current = explorerStore.getState()
    const paths = current.selectedPaths.includes(entryPath) ? current.selectedPaths : [entryPath]
    return entryActionEntries(current, paths)
  }
  const items: ContextMenuEntry[] = [
    { id: 'refresh', label: '刷新', onSelect: () => explorerStore.refresh() },
    { id: 'select-all', label: '全选', onSelect: () => explorerStore.selectAll() }
  ]
  if (hasActiveFilters(state)) items.push({ id: 'clear-filters', label: '清除筛选', onSelect: () => explorerStore.clearFilters() })
  items.push(
    SEPARATOR,
    {
      id: 'view',
      label: '视图',
      submenu: [
        { id: 'view-list', label: '列表', checked: state.viewMode === 'list' && !state.groupingEnabled, onSelect: () => explorerStore.setViewMode('list') },
        { id: 'view-grid', label: '卡片', checked: state.viewMode === 'grid' && !state.groupingEnabled, onSelect: () => explorerStore.setViewMode('grid') },
        { id: 'view-gallery', label: '画廊', checked: state.viewMode === 'gallery', onSelect: () => explorerStore.setViewMode('gallery') },
        SEPARATOR,
        { id: 'view-grouping', label: '分组显示', checked: state.groupingEnabled, onSelect: () => explorerStore.setGroupingEnabled(!state.groupingEnabled) }
      ] satisfies ContextMenuEntry[]
    },
    {
      id: 'sort',
      label: '排序',
      submenu: [
        ...(['name', 'size', 'modifiedAt', 'kind', 'rating'] as SortField[]).map<ContextMenuItem>((field) => ({
          id: `sort-${field}`,
          label: sortLabel(field),
          checked: state.sortField === field,
          onSelect: () => explorerStore.setSort(field, 'asc')
        })),
        SEPARATOR,
        { id: 'sort-reverse', label: `改为${state.sortOrder === 'asc' ? '降序' : '升序'}`, onSelect: () => explorerStore.setSort(state.sortField) }
      ] satisfies ContextMenuEntry[]
    }
  )
  return items
}

function breadcrumbEntries(context: ContextMenuContext): ContextMenuEntry[] {
  const crumb = context.target.closest('[data-crumb-path]')
  const path = crumb?.getAttribute('data-crumb-path')
  if (path) {
    return [
      { id: 'crumb-open', label: '跳转到此目录', onSelect: () => explorerStore.navigate(path) },
      { id: 'crumb-copy', label: '复制路径', onSelect: () => void copyText(path) },
      { id: 'crumb-reveal', label: '在文件管理器中定位', onSelect: () => revealPath(path) },
      SEPARATOR,
      { id: 'crumb-up', label: '返回上一级', disabled: !explorerStore.getState().parent, onSelect: () => explorerStore.goUp() }
    ]
  }
  const state = explorerStore.getState()
  if (state.tagFocus) {
    return [{ id: 'exit-tag', label: `退出标签聚合「${state.tagFocus.name}」`, onSelect: () => explorerStore.clearTagFocus() }]
  }
  return [
    { id: 'copy-current', label: '复制当前路径', disabled: !state.path, onSelect: () => void copyText(state.path ?? '') },
    { id: 'refresh', label: '刷新', disabled: !state.path, onSelect: () => explorerStore.refresh() }
  ]
}

function inspectorEntries(context: ContextMenuContext): ContextMenuEntry[] | null {
  const state = explorerStore.getState()
  const hit = resolveEntryPath(context.target)
  const paths = state.selectedPaths.length > 0 && (!hit || state.selectedPaths.includes(hit))
    ? state.selectedPaths
    : hit
      ? [hit]
      : state.focusedPath
        ? [state.focusedPath]
        : []
  if (paths.length === 0) return null
  return entryActionEntries(state, paths, [
    SEPARATOR,
    {
      id: 'export-manifest',
      label: '导出目录清单…',
      onSelect: () => window.dispatchEvent(new CustomEvent('explorer:export-manifest'))
    }
  ])
}

function statusEntries(): ContextMenuEntry[] {
  const state = explorerStore.getState()
  const items: ContextMenuEntry[] = []
  if (state.selectedPaths.length > 0) {
    items.push({ id: 'clear-selection', label: `清除选择（${state.selectedPaths.length} 项）`, onSelect: () => explorerStore.clearSelection() })
  }
  if (hasActiveFilters(state)) {
    items.push({ id: 'clear-filters', label: '清除筛选', onSelect: () => explorerStore.clearFilters() })
  }
  items.push(
    { id: 'refresh', label: '刷新', disabled: !state.path && !state.tagFocus, onSelect: () => explorerStore.refresh() }
  )
  if (state.path) {
    items.push({ id: 'copy-path', label: '复制当前路径', onSelect: () => void copyText(state.path ?? '') })
  }
  return items
}

function driveToggleEntry(): ContextMenuItem {
  return {
    id: 'drive-net',
    label: '显示网络驱动盘',
    checked: networkDrivesShown,
    onSelect: () => {
      void call('filesystem', 'setDrivePreferences', { showNetworkDrives: !networkDrivesShown })
        .catch((error) => log('error', 'Explorer', '保存驱动器偏好失败', errorText(error)))
    }
  }
}

function treeEntries(context: ContextMenuContext): ContextMenuEntry[] {
  const itemEl = context.target.closest('[data-bookmark-item]')
  if (itemEl) {
    const groupId = itemEl.closest('[data-bookmark-group]')?.getAttribute('data-bookmark-group') ?? ''
    const itemId = itemEl.getAttribute('data-bookmark-item') ?? ''
    const path = itemEl.getAttribute('data-bookmark-path') ?? ''
    const name = cachedGroups.find((group) => group.id === groupId)?.items.find((item) => item.id === itemId)?.name ?? ''
    return [
      { id: 'bm-open', label: '打开', onSelect: () => { openBookmark(groupId, itemId).catch((error) => log('error', 'Explorer', '打开收藏失败', errorText(error))) } },
      {
        id: 'bm-edit',
        label: '编辑书签…',
        onSelect: () => {
          const dialog = promptApi()
          if (!dialog) return
          void dialog({ title: '编辑收藏名称', value: name, confirmText: '下一步' })
            .then((nextName) => {
              if (!nextName?.trim()) return null
              const pathDialog = promptApi()
              if (!pathDialog) return null
              return pathDialog({ title: '编辑收藏地址', value: path, confirmText: '保存' }).then((nextPath) => {
                if (!nextPath?.trim()) return
                return bookmarkAction({ action: 'edit', groupId, itemId, name: nextName.trim(), path: nextPath.trim() })
              })
            })
            .catch((error) => log('error', 'Explorer', '编辑收藏失败', errorText(error)))
        }
      },
      { id: 'bm-remove', label: '移除此书签', danger: true, onSelect: () => { bookmarkAction({ action: 'remove', groupId, itemId }).catch((error) => log('error', 'Explorer', '移除收藏失败', errorText(error))) } },
      SEPARATOR,
      { id: 'bm-copy', label: '复制路径', disabled: !path, onSelect: () => void copyText(path) },
      { id: 'bm-reveal', label: '在文件管理器中定位', disabled: !path, onSelect: () => revealPath(path) }
    ]
  }
  const groupEl = context.target.closest('[data-bookmark-group]')
  if (groupEl) {
    const groupId = groupEl.getAttribute('data-bookmark-group') ?? ''
    const groupName = cachedGroups.find((group) => group.id === groupId)?.name ?? ''
    const selectedDirs = explorerStore.getState().entries.filter((entry) => entry.isDirectory && explorerStore.getState().selectedPaths.includes(entry.path)).length
    return [
      {
        id: 'bm-add-selected',
        label: '收藏选中的文件夹',
        disabled: selectedDirs === 0 ? '请先在文件视图中选中文件夹' : false,
        onSelect: () => {
          addSelectedBookmarks(groupId).catch((error) => log('error', 'Explorer', '收藏文件夹失败', errorText(error)))
        }
      },
      {
        id: 'bm-rename',
        label: '重命名分组…',
        onSelect: () => {
          const dialog = promptApi()
          if (!dialog) return
          void dialog({ title: '重命名收藏分组', value: groupName, confirmText: '保存' })
            .then((next) => {
              const name = next?.trim()
              if (!name) return
              return bookmarkAction({ action: 'renameGroup', groupId, name })
            })
            .catch((error) => log('error', 'Explorer', '重命名分组失败', errorText(error)))
        }
      },
      {
        id: 'bm-delete',
        label: '删除分组',
        danger: true,
        onSelect: () => {
          if (!window.confirm(`删除收藏分组「${groupName}」？其中的收藏条目将一并移除，文件不受影响。`)) return
          bookmarkAction({ action: 'deleteGroup', groupId }).catch((error) => log('error', 'Explorer', '删除分组失败', errorText(error)))
        }
      },
      SEPARATOR,
      {
        id: 'bm-toggle',
        label: '展开 / 折叠分组',
        onSelect: () => window.dispatchEvent(new CustomEvent('explorer:toggle-bookmark-group', { detail: { groupId } }))
      }
    ]
  }
  const driveEl = context.target.closest('[data-drive-path]')
  if (driveEl) {
    const path = driveEl.getAttribute('data-drive-path') ?? ''
    return [
      { id: 'drive-open', label: '打开', disabled: !path, onSelect: () => explorerStore.navigate(path) },
      { id: 'drive-copy', label: '复制路径', disabled: !path, onSelect: () => void copyText(path) },
      SEPARATOR,
      driveToggleEntry()
    ]
  }
  const quickEl = context.target.closest('[data-tree-kind="quick"]')
  if (quickEl) {
    const path = quickEl.getAttribute('data-tree-path') ?? ''
    return [
      { id: 'quick-open', label: '打开', disabled: !path, onSelect: () => explorerStore.navigate(path) },
      { id: 'quick-reveal', label: '在文件管理器中定位', disabled: !path, onSelect: () => revealPath(path) },
      { id: 'quick-copy', label: '复制路径', disabled: !path, onSelect: () => void copyText(path) }
    ]
  }
  return [
    { id: 'tree-refresh', label: '刷新驱动器与快捷入口', onSelect: () => { void explorerStore.init() } },
    driveToggleEntry(),
    SEPARATOR,
    {
      id: 'tree-new-group',
      label: '新建收藏分组…',
      onSelect: () => {
        const dialog = promptApi()
        if (!dialog) return
        void dialog({ title: '新建收藏分组', placeholder: '分组名称', confirmText: '创建' })
          .then((next) => {
            const name = next?.trim()
            if (!name) return
            return bookmarkAction({ action: 'createGroup', name })
          })
          .catch((error) => log('error', 'Explorer', '新建分组失败', errorText(error)))
      }
    }
  ]
}

function startCaches(): () => void {
  const refreshGroups = (): void => {
    bookmarkAction({ action: 'list' })
      .then((groups) => { cachedGroups = groups })
      .catch(() => {})
  }
  const refreshDrivePreferences = (): void => {
    callValidated(drivePreferencesSchema, 'filesystem', 'getDrivePreferences')
      .then((preferences) => { networkDrivesShown = preferences.showNetworkDrives })
      .catch(() => {})
  }
  refreshGroups()
  refreshDrivePreferences()
  const stopGroups = window.bridge.onEvent((channel) => { if (channel === 'quickBookmarks:changed') refreshGroups() })
  const stopDrives = window.bridge.onEvent((channel, payload) => {
    if (channel !== 'filesystem:drivePreferences') return
    const parsed = drivePreferencesSchema.safeParse(payload)
    if (parsed.success) networkDrivesShown = parsed.data.showNetworkDrives
  })
  return () => { stopGroups(); stopDrives() }
}

export function setupExplorerMenus(): () => void {
  const contextMenu = getService<ContextMenuService>('contextMenu')
  if (!contextMenu) {
    log('warn', 'Explorer', '右键菜单服务不可用，跳过右键注册')
    return () => undefined
  }
  const disposers = [
    contextMenu.register('explorer.workspace', workspaceEntries, { order: 10 }),
    contextMenu.register('explorer.breadcrumb', breadcrumbEntries, { order: 10 }),
    contextMenu.register('explorer.inspector', inspectorEntries, { order: 10 }),
    contextMenu.register('explorer.status', statusEntries, { order: 10 }),
    contextMenu.register('explorer.tree', treeEntries, { order: 10 })
  ]
  const stopCaches = startCaches()
  return () => {
    disposers.forEach((dispose) => dispose())
    stopCaches()
  }
}
