import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { z } from 'zod'

const viewModeSchema = z.enum(['list', 'grid', 'gallery', 'grouped'])
const sortFieldSchema = z.enum(['name', 'size', 'modifiedAt', 'kind', 'rating'])
const sortOrderSchema = z.enum(['asc', 'desc'])
const kindFilterSchema = z.enum([
  'all', 'folder', 'code', 'image', 'document', 'data', 'archive', 'video', 'audio', 'other'
])
const scrollAnchorSchema = z.object({ path: z.string().nullable(), offset: z.number().finite() })
const tagFocusSchema = z.object({ tagId: z.number().int().positive(), name: z.string().min(1) })
const paneWidthsSchema = z.object({
  left: z.number().finite().min(120).max(1200),
  right: z.number().finite().min(120).max(1200),
  bottom: z.number().finite().min(80).max(1000)
})

const sessionSchema = z.object({
  path: z.string().nullable(),
  viewMode: viewModeSchema,
  groupingEnabled: z.boolean().default(false),
  sortField: sortFieldSchema,
  sortOrder: sortOrderSchema,
  search: z.string(),
  kindFilter: kindFilterSchema,
  tagFilter: z.string().nullable(),
  favoriteOnly: z.boolean(),
  minRating: z.number().int().min(0).max(5),
  selectedPaths: z.array(z.string()),
  focusedPath: z.string().nullable(),
  scrollAnchor: scrollAnchorSchema,
  paneWidths: paneWidthsSchema,
  expandedDirectories: z.array(z.string()),
  // Missing in older documents: the explorer then falls back to the folder view.
  tagFocus: tagFocusSchema.nullable().default(null)
})

type SessionState = z.infer<typeof sessionSchema>
// Defaults apply to restored sessions, never to unrelated partial updates.
const sessionPatchSchema = sessionSchema.partial().extend({ groupingEnabled: z.boolean().optional() })

const defaultSession: SessionState = {
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

const workspaceSchema = z.object({
  id: z.string().min(1),
  name: z.string().trim().min(1).max(80),
  layout: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  panes: z.array(z.object({ id: z.string().min(1), state: sessionSchema }))
})
type Workspace = z.infer<typeof workspaceSchema>

const workspacesSchema = z.object({
  activeId: z.string().nullable(),
  // Missing in older version-1 documents: default it to null for compatibility.
  activePaneId: z.string().nullable().default(null),
  items: z.array(workspaceSchema)
})
type WorkspacesState = z.infer<typeof workspacesSchema>

const sessionPatchInput = sessionPatchSchema.extend({
  scrollAnchor: scrollAnchorSchema.partial().optional(),
  paneWidths: paneWidthsSchema.partial().optional()
})

function makeWorkspace(name: string, layout: 1 | 2 | 4): Workspace {
  return workspaceSchema.parse({
    id: `workspace_${randomUUID().slice(0, 12)}`,
    name,
    layout,
    panes: Array.from({ length: layout }, (_, index) => ({
      id: `pane-${index + 1}`,
      state: defaultSession
    }))
  })
}

function resizeWorkspace(workspace: Workspace, layout: 1 | 2 | 4): Workspace {
  const panes = workspace.panes.slice(0, layout)
  while (panes.length < layout) {
    const index = panes.length
    panes.push({ id: `pane-${index + 1}`, state: { ...defaultSession } })
  }
  return { ...workspace, layout, panes }
}

export default {
  name: 'system-basic-session',
  inject: ['ipc', 'store'],
  apply(ctx: Context): void {
    ctx.store.register('session', { schema: sessionSchema, default: defaultSession, version: 1 })
    ctx.store.register('workspaces', {
      schema: workspacesSchema,
      default: { activeId: null, activePaneId: null, items: [] },
      version: 1
    })

    let session = defaultSession
    let workspaces: WorkspacesState = { activeId: null, activePaneId: null, items: [] }
    let loaded = false
    let loading: Promise<void> | null = null
    let timer: ReturnType<typeof setTimeout> | null = null
    let pendingSession = false
    let pendingWorkspaces = false
    let writeChain: Promise<void> = Promise.resolve()

    async function ensureLoaded(): Promise<void> {
      if (loaded) return
      if (!loading) {
        loading = (async () => {
          const [savedSession, savedWorkspaces] = await Promise.all([
            ctx.store.read<SessionState>('session'),
            ctx.store.read<WorkspacesState>('workspaces')
          ])
          session = sessionSchema.parse(savedSession)
          workspaces = workspacesSchema.parse(savedWorkspaces)
          loaded = true
        })()
      }
      await loading
    }

    function scheduleWrite(key: 'session' | 'workspaces'): void {
      if (key === 'session') pendingSession = true
      else pendingWorkspaces = true
      if (timer) clearTimeout(timer)
      timer = setTimeout(() => {
        timer = null
        void flush().catch((error) => console.error('[session] 持久化失败', error))
      }, 500)
      ;(timer as { unref?: () => void }).unref?.()
    }

    async function flush(): Promise<void> {
      if (timer) {
        clearTimeout(timer)
        timer = null
      }
      await ensureLoaded()
      const writeSession = pendingSession
      const writeWorkspaces = pendingWorkspaces
      pendingSession = false
      pendingWorkspaces = false
      const sessionSnapshot = sessionSchema.parse(session)
      const workspaceSnapshot = workspacesSchema.parse(workspaces)
      const task = async (): Promise<void> => {
        if (writeSession) await ctx.store.write('session', sessionSnapshot)
        if (writeWorkspaces) await ctx.store.write('workspaces', workspaceSnapshot)
      }
      writeChain = writeChain.then(task, task)
      await writeChain
      if (pendingSession || pendingWorkspaces) await flush()
    }

    function getActiveWorkspace(): Workspace | null {
      return workspaces.items.find((item) => item.id === workspaces.activeId) ?? null
    }

    function activateWorkspace(workspace: Workspace, requestedPaneId?: string): void {
      const pane = workspace.panes.find((item) => item.id === requestedPaneId) ?? workspace.panes[0]
      workspaces = { ...workspaces, activeId: workspace.id, activePaneId: pane?.id ?? null }
      if (pane) session = sessionSchema.parse(pane.state)
      pendingWorkspaces = true
      pendingSession = true
      scheduleWrite('workspaces')
      scheduleWrite('session')
    }

    ctx.ipc.handle('session', {
      get: async () => {
        await ensureLoaded()
        return sessionSchema.parse(session)
      },
      set: async (patchValue: unknown, paneId?: string) => {
        await ensureLoaded()
        const patch = sessionPatchInput.parse(patchValue)
        const active = getActiveWorkspace()
        if (paneId && !active) throw new Error('没有活动工作区，不能指定窗格保存会话')
        const targetPane = active
          ? (paneId ? active.panes.find((pane) => pane.id === paneId) : active.panes[0])
          : undefined
        if (active && !targetPane) throw new Error(`活动工作区中不存在窗格：${paneId ?? '(第一个窗格)'}`)
        session = sessionSchema.parse({
          ...session,
          ...patch,
          scrollAnchor: patch.scrollAnchor ? { ...session.scrollAnchor, ...patch.scrollAnchor } : session.scrollAnchor,
          paneWidths: patch.paneWidths ? { ...session.paneWidths, ...patch.paneWidths } : session.paneWidths
        })
        if (active && targetPane) {
          const panes = active.panes.map((pane) => pane.id === targetPane.id ? { ...pane, state: session } : pane)
          workspaces = {
            ...workspaces,
            activePaneId: targetPane.id,
            items: workspaces.items.map((item) => item.id === active.id ? { ...item, panes } : item)
          }
          scheduleWrite('workspaces')
        }
        scheduleWrite('session')
        return sessionSchema.parse(session)
      },
      reset: async () => {
        await ensureLoaded()
        session = sessionSchema.parse(defaultSession)
        const active = getActiveWorkspace()
        const targetPane = active?.panes.find((pane) => pane.id === workspaces.activePaneId) ?? active?.panes[0]
        if (active && targetPane) {
          workspaces = {
            ...workspaces,
            activePaneId: targetPane.id,
            items: workspaces.items.map((item) => item.id === active.id
              ? { ...item, panes: item.panes.map((pane) => pane.id === targetPane.id ? { ...pane, state: session } : pane) }
              : item)
          }
          scheduleWrite('workspaces')
        }
        scheduleWrite('session')
        return sessionSchema.parse(session)
      },
      flush
    })

    ctx.ipc.handle('workspaces', {
      list: async () => {
        await ensureLoaded()
        return workspacesSchema.parse(workspaces)
      },
      get: async (id: string) => {
        await ensureLoaded()
        return workspaces.items.find((item) => item.id === id) ?? null
      },
      active: async () => {
        await ensureLoaded()
        return getActiveWorkspace()
      },
      create: async (name: string, layout: 1 | 2 | 4 = 1) => {
        await ensureLoaded()
        const workspace = makeWorkspace(name, layout)
        workspaces = { ...workspaces, items: [...workspaces.items, workspace] }
        if (!workspaces.activeId) activateWorkspace(workspace)
        scheduleWrite('workspaces')
        return workspace
      },
      rename: async (id: string, name: string) => {
        await ensureLoaded()
        const updated = workspaces.items.map((item) => item.id === id ? workspaceSchema.parse({ ...item, name }) : item)
        if (!updated.some((item) => item.id === id)) throw new Error(`工作区不存在：${id}`)
        workspaces = { ...workspaces, items: updated }
        scheduleWrite('workspaces')
        return workspaces.items.find((item) => item.id === id)!
      },
      setLayout: async (id: string, layout: 1 | 2 | 4) => {
        await ensureLoaded()
        const existing = workspaces.items.find((item) => item.id === id)
        if (!existing) throw new Error(`工作区不存在：${id}`)
        const updated = resizeWorkspace(existing, layout)
        workspaces = { ...workspaces, items: workspaces.items.map((item) => item.id === id ? updated : item) }
        if (workspaces.activeId === id) {
          const activePane = updated.panes.find((pane) => pane.id === workspaces.activePaneId) ?? updated.panes[0]
          workspaces.activePaneId = activePane?.id ?? null
          if (activePane) {
            session = sessionSchema.parse(activePane.state)
            scheduleWrite('session')
          }
        }
        scheduleWrite('workspaces')
        return updated
      },
      setPane: async (id: string, paneId: string, stateValue: unknown) => {
        await ensureLoaded()
        const nextState = sessionSchema.parse(stateValue)
        const existing = workspaces.items.find((item) => item.id === id)
        if (!existing) throw new Error(`工作区不存在：${id}`)
        if (!existing.panes.some((pane) => pane.id === paneId)) throw new Error(`工作区窗格不存在：${paneId}`)
        const updated = { ...existing, panes: existing.panes.map((pane) => pane.id === paneId ? { ...pane, state: nextState } : pane) }
        const isActivePane = workspaces.activeId === id && (workspaces.activePaneId === paneId || !workspaces.activePaneId)
        workspaces = {
          ...workspaces,
          activePaneId: isActivePane ? paneId : workspaces.activePaneId,
          items: workspaces.items.map((item) => item.id === id ? updated : item)
        }
        if (isActivePane) {
          session = nextState
          scheduleWrite('session')
        }
        scheduleWrite('workspaces')
        return updated
      },
      activate: async (id: string, paneId?: string) => {
        await ensureLoaded()
        const workspace = workspaces.items.find((item) => item.id === id)
        if (!workspace) throw new Error(`工作区不存在：${id}`)
        if (paneId && !workspace.panes.some((pane) => pane.id === paneId)) {
          throw new Error(`工作区窗格不存在：${paneId}`)
        }
        activateWorkspace(workspace, paneId)
        return workspace
      },
      remove: async (id: string) => {
        await ensureLoaded()
        if (!workspaces.items.some((item) => item.id === id)) return false
        const items = workspaces.items.filter((item) => item.id !== id)
        const switchesActive = workspaces.activeId === id
        const nextWorkspace = switchesActive ? items[0] : undefined
        const next = {
          activeId: switchesActive ? (nextWorkspace?.id ?? null) : workspaces.activeId,
          activePaneId: switchesActive ? (nextWorkspace?.panes[0]?.id ?? null) : workspaces.activePaneId,
          items
        }
        workspaces = workspacesSchema.parse(next)
        if (switchesActive && workspaces.activeId) {
          const active = getActiveWorkspace()
          if (active) session = sessionSchema.parse(active.panes.find((pane) => pane.id === workspaces.activePaneId)?.state ?? defaultSession)
          scheduleWrite('session')
        } else if (switchesActive) {
          session = sessionSchema.parse(defaultSession)
          scheduleWrite('session')
        }
        scheduleWrite('workspaces')
        return true
      },
      flush
    })
  }
}
