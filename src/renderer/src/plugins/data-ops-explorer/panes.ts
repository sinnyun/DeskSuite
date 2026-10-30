import { call } from '../../workbench/sdk'
import { metadataStore } from './metadata'
import {
  activeSelectionService,
  createPaneStore,
  getActivePaneStore,
  setActivePaneStore,
  type ExplorerStore,
  type PaneSessionState
} from './store'

export interface PaneDescriptor {
  id: string
  store: ExplorerStore
}

export interface WorkspaceDescriptor {
  id: string
  name: string
  layout: 1 | 2 | 4
  activePaneId?: string | null
  panes: Array<{ id: string; state: PaneSessionState }>
}

export interface ExplorerPanesSnapshot {
  workspaceId: string
  workspaceName: string
  layout: 1 | 2 | 4
  activePaneId: string
  panes: PaneDescriptor[]
  workspaces: Array<{ id: string; name: string; layout: 1 | 2 | 4 }>
}

const DEFAULT_SESSION: PaneSessionState = {
  path: null,
  viewMode: 'list',
  groupingEnabled: false,
  sortField: 'name',
  sortOrder: 'asc',
  search: '',
  kindFilter: 'all',
  tagFilter: null,
  favoriteOnly: false,
  minRating: 0,
  selectedPaths: [],
  focusedPath: null,
  scrollAnchor: { path: null, offset: 0 },
  paneWidths: { left: 268, right: 320, bottom: 220 },
  expandedDirectories: [],
  tagFocus: null
}

class ExplorerPanes {
  private snapshot: ExplorerPanesSnapshot = {
    workspaceId: '', workspaceName: '默认工作区', layout: 1, activePaneId: 'pane-1',
    panes: [{ id: 'pane-1', store: createPaneStore('pane-1') }], workspaces: []
  }
  private listeners = new Set<() => void>()
  private initialized = false
  private loading: Promise<void> | null = null
  private readyToPersist = false
  private persistTimers = new Map<string, ReturnType<typeof setTimeout>>()
  private readonly persistDelay = 250

  getSnapshot = (): ExplorerPanesSnapshot => this.snapshot

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private emit(): void {
    for (const listener of this.listeners) listener()
  }

  async initialize(): Promise<void> {
    if (this.initialized) return
    if (!this.loading) {
      this.loading = (async () => {
        await metadataStore.start()
        const [session, catalog] = await Promise.all([
          call<PaneSessionState>('session', 'get'),
          call<{ activeId: string | null; activePaneId: string | null; items: WorkspaceDescriptor[] }>('workspaces', 'list')
        ])
        let workspace = catalog.items.find((item) => item.id === catalog.activeId)
        if (!workspace) {
          workspace = await call<WorkspaceDescriptor>('workspaces', 'create', '默认工作区', 1)
        }
        const fallbackState = session ?? DEFAULT_SESSION
        const rawPanes = workspace.panes?.length
          ? workspace.panes
          : [{ id: 'pane-1', state: fallbackState }]
        const panes: PaneDescriptor[] = []
        for (const pane of rawPanes.slice(0, workspace.layout)) {
          const store = createPaneStore(`${workspace.id}:${pane.id}`)
          await store.init(pane.state ?? fallbackState)
          panes.push({ id: pane.id, store })
        }
        if (!panes.length) {
          const store = createPaneStore(`${workspace.id}:pane-1`)
          await store.init(fallbackState)
          panes.push({ id: 'pane-1', store })
        }
        this.snapshot = {
          workspaceId: workspace.id,
          workspaceName: workspace.name,
          layout: workspace.layout,
          activePaneId: panes.some((pane) => pane.id === catalog.activePaneId)
            ? catalog.activePaneId as string
            : panes[0].id,
          panes,
          workspaces: catalog.items.map(({ id, name, layout }) => ({ id, name, layout }))
        }
        setActivePaneStore(panes.find((pane) => pane.id === this.snapshot.activePaneId)!.store)
        this.readyToPersist = true
        for (const pane of panes) pane.store.subscribe(() => this.schedulePersist(pane.id))
        this.initialized = true
        this.emit()
      })()
    }
    await this.loading
  }

  async setLayout(layout: 1 | 2 | 4): Promise<void> {
    await this.initialize()
    const workspace = await call<WorkspaceDescriptor>('workspaces', 'setLayout', this.snapshot.workspaceId, layout)
    await this.replaceWorkspace(workspace)
  }

  async activateWorkspace(workspaceId: string): Promise<void> {
    await this.initialize()
    const workspace = await call<WorkspaceDescriptor>('workspaces', 'activate', workspaceId)
    const catalog = await call<{ activeId: string | null; activePaneId: string | null; items: WorkspaceDescriptor[] }>('workspaces', 'list')
    await this.replaceWorkspace({ ...workspace, activePaneId: catalog.activePaneId })
    this.snapshot = { ...this.snapshot, workspaces: catalog.items.map(({ id, name, layout }) => ({ id, name, layout })) }
    this.emit()
  }

  async createWorkspace(name: string): Promise<void> {
    await this.initialize()
    const workspace = await call<WorkspaceDescriptor>('workspaces', 'create', name, this.snapshot.layout)
    const activated = await call<WorkspaceDescriptor>('workspaces', 'activate', workspace.id)
    const catalog = await call<{ activeId: string | null; activePaneId: string | null; items: WorkspaceDescriptor[] }>('workspaces', 'list')
    this.snapshot = { ...this.snapshot, workspaces: catalog.items.map(({ id, name: title, layout }) => ({ id, name: title, layout })) }
    await this.replaceWorkspace({ ...activated, activePaneId: catalog.activePaneId })
  }

  setActivePane(paneId: string): void {
    const pane = this.snapshot.panes.find((item) => item.id === paneId)
    if (!pane || paneId === this.snapshot.activePaneId) return
    this.snapshot = { ...this.snapshot, activePaneId: paneId }
    setActivePaneStore(pane.store)
    this.emit()
    void call('workspaces', 'activate', this.snapshot.workspaceId, paneId).catch(() => undefined)
    void call('session', 'set', pane.store.getSessionState(), pane.id).catch(() => undefined)
  }

  private async replaceWorkspace(workspace: WorkspaceDescriptor): Promise<void> {
    const previous = new Map(this.snapshot.panes.map((pane) => [pane.store.paneId, pane.store]))
    const panes: PaneDescriptor[] = []
    for (const item of workspace.panes.slice(0, workspace.layout)) {
      const storeKey = `${workspace.id}:${item.id}`
      const store = previous.get(storeKey) ?? createPaneStore(storeKey)
      if (!previous.has(storeKey)) {
        await store.init(item.state ?? DEFAULT_SESSION)
        store.subscribe(() => this.schedulePersist(item.id))
      }
      panes.push({ id: item.id, store })
    }
    this.snapshot = {
      ...this.snapshot,
      workspaceId: workspace.id,
      workspaceName: workspace.name,
      layout: workspace.layout,
      activePaneId: workspace.activePaneId && panes.some((pane) => pane.id === workspace.activePaneId)
        ? workspace.activePaneId
        : panes.some((pane) => pane.id === this.snapshot.activePaneId)
          ? this.snapshot.activePaneId
          : panes[0]?.id ?? 'pane-1',
      panes
    }
    const active = panes.find((pane) => pane.id === this.snapshot.activePaneId) ?? panes[0]
    if (active) setActivePaneStore(active.store)
    this.emit()
  }

  private schedulePersist(paneId: string): void {
    if (!this.readyToPersist) return
    const workspaceId = this.snapshot.workspaceId
    const timerKey = `${workspaceId}:${paneId}`
    const existing = this.persistTimers.get(timerKey)
    if (existing) clearTimeout(existing)
    const timer = setTimeout(() => {
      this.persistTimers.delete(timerKey)
      if (this.snapshot.workspaceId !== workspaceId) return
      const pane = this.snapshot.panes.find((item) => item.id === paneId && item.store.paneId === `${workspaceId}:${paneId}`)
      if (!pane) return
      const state = pane.store.getSessionState()
      void call('workspaces', 'setPane', workspaceId, paneId, state).catch(() => undefined)
      if (paneId === this.snapshot.activePaneId) {
        void call('session', 'set', state, paneId).catch(() => undefined)
      }
    }, this.persistDelay)
    ;(timer as { unref?: () => void }).unref?.()
    this.persistTimers.set(timerKey, timer)
  }
}

export const explorerPanes = new ExplorerPanes()

export const panesRendererService = {
  getSnapshot: explorerPanes.getSnapshot,
  subscribe: explorerPanes.subscribe,
  getActiveStore: getActivePaneStore,
  setActivePane: (paneId: string) => explorerPanes.setActivePane(paneId),
  setLayout: (layout: 1 | 2 | 4) => explorerPanes.setLayout(layout),
  activateWorkspace: (workspaceId: string) => explorerPanes.activateWorkspace(workspaceId),
  createWorkspace: (name: string) => explorerPanes.createWorkspace(name),
  initialize: () => explorerPanes.initialize(),
  showTagAggregate: (tag: { tagId: number; name: string }) => getActivePaneStore().showTagAggregate(tag),
  clearTagFocus: () => getActivePaneStore().clearTagFocus()
}

export { activeSelectionService }
