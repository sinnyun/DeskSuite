import { useEffect, useSyncExternalStore } from 'react'
import type { ReactNode } from 'react'
import type { ReactElement } from 'react'
import { call, getService, useUiKit } from '../../../workbench/sdk'
import { PaneStoreProvider, usePaneStoreContext } from '../PaneContext'
import { explorerPanes } from '../panes'
import { metadataStore } from '../metadata'
import { normalizePath, parentDirectory, useExplorer, visibleEntries } from '../store'
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

function PaneContent(): ReactElement {
  const state = useExplorer()
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
  const state = useExplorer()
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
  const state = useExplorer()
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
    void call('watch', 'setPaneDirectories', paneId, watchDirectories).catch(() => {})
  }, [paneId, store, watchKey])

  useEffect(() => () => {
    void call('watch', 'clearPane', paneId).catch(() => {})
  }, [paneId])

  useEffect(() => {
    if (!store) return
    return window.bridge.onEvent((channel, payload) => {
      if (channel !== 'fs:changed' || !payload || typeof payload !== 'object') return
      const event = payload as { dirs?: unknown; paths?: unknown; invalidate?: unknown }
      if (!Array.isArray(event.dirs)) return
      const paths = Array.isArray(event.paths)
        ? event.paths.filter((path): path is string => typeof path === 'string')
        : []
      if (state.tagFocus) {
        void store.applyChanges(paths, event.invalidate === true)
        return
      }
      if (!state.path) return
      const current = normalizePath(state.path)
      if (!event.dirs.some((dir) => typeof dir === 'string' && normalizePath(dir) === current)) return
      void store.applyChanges(paths, event.invalidate === true)
    })
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
