import { call, getService } from '../../workbench/sdk'
import { explorerStore, type ExplorerViewMode } from './store'
import { explorerPanes } from './panes'

export interface BookmarkGroup {
  id: string
  name: string
  items: Array<{ id: string; name: string; path: string }>
}
export const bookmarkAction = (args: Record<string, unknown>): Promise<BookmarkGroup[]> => call('quickBookmarks', 'act', args)

export async function addSelectedBookmarks(groupId: string): Promise<BookmarkGroup[]> {
  const state = explorerStore.getState()
  const paths = state.entries.filter((item) => item.isDirectory && state.selectedPaths.includes(item.path)).map((item) => item.path)
  if (!paths.length) throw new Error('请先在中间文件视图中选中文件夹')
  return bookmarkAction({ action: 'add', groupId, paths })
}

export async function openBookmark(groupId: string, itemId: string): Promise<void> {
  const groups = await bookmarkAction({ action: 'list' })
  const item = groups.find((group) => group.id === groupId)?.items.find((item) => item.id === itemId)
  if (!item) throw new Error('收藏地址不存在')
  await call('filesystem', 'listDir', item.path)
  explorerStore.navigate(item.path)
}

export function startBookmarkBridge(): () => void {
  return window.bridge.onEvent((channel, payload) => {
    if (channel !== 'quickBookmarks:explorer') return
    const args = payload as { id: string; action: string; viewMode?: ExplorerViewMode; groupingEnabled?: boolean; groupBy?: 'kind' | 'modifiedMinute' | 'rating' | 'folder'; includeChildren?: boolean; path?: string; paths?: string[]; groupId: string; itemId: string }
    void (async () => {
      try {
        await explorerPanes.initialize()
        let value: unknown
        if (args.action === 'view') {
          if (args.viewMode) explorerStore.setViewMode(args.viewMode)
          if (typeof args.groupingEnabled === 'boolean') explorerStore.setGroupingEnabled(args.groupingEnabled)
          const grouped = getService<{ configure(options: { groupBy?: string; includeChildren?: boolean }): void; getOptions(): unknown }>('explorerGroupedView')
          if (args.groupBy !== undefined || args.includeChildren !== undefined) {
            if (!grouped) throw new Error('分组插件未提供服务')
            grouped.configure({ ...(args.groupBy ? { groupBy: args.groupBy } : {}), ...(args.includeChildren !== undefined ? { includeChildren: args.includeChildren } : {}) })
          }
          const state = explorerStore.getState()
          value = { viewMode: state.viewMode, groupingEnabled: state.groupingEnabled, groupOptions: grouped?.getOptions() }

        }
        if (args.action === 'navigate') {
          await explorerStore.load(args.path!)
          if (explorerStore.getState().status === 'error') throw new Error(explorerStore.getState().error ?? '打开失败')
        }
        if (args.action === 'select') {
          const paths = args.paths ?? []
          if (paths.some((path) => ![...explorerStore.getState().entries, ...explorerStore.getState().descendantEntries].some((item) => item.path === path))) throw new Error('选择项不在当前目录')
          explorerStore.clearSelection()
          paths.forEach((path) => explorerStore.select(path, 'toggle'))
        }
        if (args.action === 'addSelected') value = await addSelectedBookmarks(args.groupId)
        if (args.action === 'open') await openBookmark(args.groupId, args.itemId)
        await call('quickBookmarks', 'complete', args.id, { value: value ?? null })
      } catch (error) {
        await call('quickBookmarks', 'complete', args.id, { error: String(error) })
      }
    })()
  })
}
