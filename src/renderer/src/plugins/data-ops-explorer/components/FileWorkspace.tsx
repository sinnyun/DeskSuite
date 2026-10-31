import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ReactElement } from 'react'
import { call, getService, useUiKit } from '../../../workbench/sdk'
import { fsChangedSchema } from '../schema'
import { PaneStoreProvider, usePaneStoreContext } from '../PaneContext'
import { explorerPanes } from '../panes'
import { metadataStore } from '../metadata'
import { normalizePath, parentDirectory, useExplorerShallow, visibleEntries } from '../store'
import { FileGalleryView } from './FileGalleryView'
import { FileGridView } from './FileGridView'
import { FileListView } from './FileListView'
import type { ComponentType } from 'react'
import type { FsEntry } from '../store'

interface GroupedViewProps {
  entries: FsEntry[]
  allEntries: FsEntry[]
  path: string | null
  filterEntries: (entries: FsEntry[]) => FsEntry[]
  prepareEntries: (entries: FsEntry[]) => Promise<void>
  registerEntries: (entries: FsEntry[]) => void
  renderLayout?: (navigation: ReactElement) => ReactElement
  renderGroup: (entries: FsEntry[]) => ReactNode
  getRating: (path: string) => number
}

interface GroupedViewService {
  component: ComponentType<GroupedViewProps>
}

const paneWatchSignatures = new Map<string, string>()
const paneWatchClearTimers = new Map<string, ReturnType<typeof setTimeout>>()

function registerPaneWatch(paneId: string, directories: string[]): void {
  const pendingClear = paneWatchClearTimers.get(paneId)
  if (pendingClear) clearTimeout(pendingClear)
  paneWatchClearTimers.delete(paneId)
  const signature = directories.join('\n')
  if (paneWatchSignatures.get(paneId) === signature) return
  paneWatchSignatures.set(paneId, signature)
  void call('watch', 'setPaneDirectories', paneId, directories).catch(() => {})
}

function releasePaneWatch(paneId: string): void {
  const previous = paneWatchClearTimers.get(paneId)
  if (previous) clearTimeout(previous)
  paneWatchClearTimers.set(paneId, setTimeout(() => {
    paneWatchClearTimers.delete(paneId)
    paneWatchSignatures.delete(paneId)
    void call('watch', 'clearPane', paneId).catch(() => {})
  }, 0))
}

function PaneContent(): ReactElement {
  const state = useExplorerShallow((s) => ({
    groupingEnabled: s.groupingEnabled, entries: s.entries, path: s.path, viewMode: s.viewMode,
    search: s.search, kindFilter: s.kindFilter, favoriteOnly: s.favoriteOnly, minRating: s.minRating,
    tagFilter: s.tagFilter, sortField: s.sortField, sortOrder: s.sortOrder
  }))
  const store = usePaneStoreContext()
  if (state.groupingEnabled) {
    const service = getService<GroupedViewService>('explorerGroupedView')
    if (service) {
      const GroupedView = service.component
      const entries = visibleEntries(state)
      return <GroupedView
        entries={entries}
        allEntries={state.entries}
        path={state.path}
        filterEntries={(items) => visibleEntries({ ...state, entries: items })}
        prepareEntries={(items) => metadataStore.prime(items.map((entry) => entry.path))}
        registerEntries={(items) => store?.setDescendantEntries(items)}
        getRating={(path) => metadataStore.get(path).rating}
        renderLayout={state.viewMode === 'gallery' ? (navigation) => <FileGalleryView navigation={navigation} /> : undefined}
        renderGroup={(items) => state.viewMode === 'gallery' ? <FileGridView entries={items} embedded singleColumn /> : <EntryView entries={items} embedded />}
      />
    }
  }
  return <EntryView />
}

function EntryView({ entries, embedded = false }: { entries?: FsEntry[]; embedded?: boolean }): ReactElement {
  const state = useExplorerShallow((s) => ({ viewMode: s.viewMode }))
  if (state.viewMode === 'grid') return <FileGridView entries={entries} embedded={embedded} />
  if (state.viewMode === 'gallery') return <FileGalleryView />
  return <FileListView entries={entries} embedded={embedded} />
}

export function FileWorkspace(): ReactElement {
  const snapshot = useSyncExternalStore(explorerPanes.subscribe, explorerPanes.getSnapshot)

  useEffect(() => {
    void explorerPanes.initialize()
  }, [])

  const columns = snapshot.layout === 1 ? 1 : 2
  const rows = snapshot.layout === 4 ? 2 : 1

  return (
    <div className="flex h-full min-h-0 flex-col" data-file-workspace>
      <div
        className="grid flex-1 min-h-0 gap-1 overflow-hidden bg-[var(--ds-border)] dark:bg-[var(--ds-surface-muted)]"
        style={{
          gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))`,
          gridTemplateRows: `repeat(${rows}, minmax(0, 1fr))`
        }}
      >
        {snapshot.panes.map((pane, index) => (
          <PaneStoreProvider key={`${snapshot.workspaceId}:${pane.id}`} store={pane.store}>
            <PaneFrame
              paneId={pane.id}
              index={index}
              active={snapshot.activePaneId === pane.id}
              activate={() => explorerPanes.setActivePane(pane.id)}
            />
          </PaneStoreProvider>
        ))}
      </div>
    </div>
  )
}

function PaneFrame({
  paneId,
  index,
  active,
  activate
}: {
  paneId: string
  index: number
  active: boolean
  activate: () => void
}): ReactElement {
  const state = useExplorerShallow((s) => ({
    tagFocus: s.tagFocus, entries: s.entries, path: s.path, expandedDirectories: s.expandedDirectories,
    nextCursor: s.nextCursor, loadingMore: s.loadingMore
  }))
  const store = usePaneStoreContext()
  const { DesktopButton } = useUiKit()

  const watchDirectories = state.tagFocus
    ? [...new Set(state.entries.map((entry) => parentDirectory(entry.path)))].slice(0, 16)
    : state.path
      ? [...new Set([state.path, ...state.expandedDirectories])].slice(0, 16)
      : []
  const watchKey = watchDirectories.join('\n')

  useEffect(() => {
    if (!store) return
    registerPaneWatch(paneId, watchDirectories)
  }, [paneId, store, watchKey])

  useEffect(() => () => releasePaneWatch(paneId), [paneId])

  useEffect(() => {
    if (!store) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingPaths = new Set<string>()
    let pendingInvalidate = false
    const flush = (): void => {
      timer = null
      const paths = [...pendingPaths]
      const invalidate = pendingInvalidate
      pendingPaths = new Set()
      pendingInvalidate = false
      void store.applyChanges(paths, invalidate)
    }
    const unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'fs:changed') return
      const decoded = fsChangedSchema.safeParse(payload)
      if (!decoded.success) return
      const event = decoded.data
      const paths = event.paths
      if (state.tagFocus) {
        for (const path of paths) pendingPaths.add(path)
        pendingInvalidate ||= event.invalidate
      } else {
        if (!state.path) return
        const current = normalizePath(state.path)
        if (!event.dirs.some((dir) => normalizePath(dir) === current)) return
        for (const path of paths) pendingPaths.add(path)
        pendingInvalidate ||= event.invalidate
      }
      if (timer) clearTimeout(timer)
      timer = setTimeout(flush, 180)
    })
    return () => {
      unsubscribe()
      if (timer) clearTimeout(timer)
    }
  }, [state.path, state.tagFocus, store])

  return (
    <section
      data-file-workspace
      data-current-path={state.path ?? ''}
      data-pane-id={paneId}
      onPointerDownCapture={activate}
      className={`flex min-w-0 min-h-0 flex-col overflow-hidden bg-[var(--ds-surface)] dark:bg-[var(--ds-surface)] ${active && index > 0 ? 'ring-1 ring-inset ring-[var(--ds-accent)]/30' : ''}`}
    >
      {index > 0 && (
        <div className="sr-only" aria-label={`窗格 ${index + 1}${active ? '，当前活动' : ''}`} />
      )}
      <PaneContent />
      {state.nextCursor && (
        <div className="flex h-8 shrink-0 items-center justify-center border-t border-[var(--ds-border)] bg-[var(--ds-surface)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
          <DesktopButton
            size="xs"
            variant="subtle"
            disabled={state.loadingMore}
            onClick={() => void store?.loadMore()}
          >
            {state.loadingMore ? '正在加载…' : `加载更多（已载入 ${state.entries.length} 项）`}
          </DesktopButton>
        </div>
      )}
    </section>
  )
}
