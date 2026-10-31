import { useEffect } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { useStore } from 'zustand'
import { createStore } from 'zustand/vanilla'
import { useShallow } from 'zustand/react/shallow'
import { z } from 'zod'

interface LayoutState {
  leftWidth: number
  rightWidth: number
  bottomHeight: number
  leftCollapsed: boolean
  rightCollapsed: boolean
  bottomCollapsed: boolean
  activeLeftTab: string
  activeRightTab: string
  activeBottomTab: string
  zenMode: boolean
  floatingPanels: Record<string, { x: number; y: number; width: number; height: number; maximized: boolean }>
  floatingPanelOpen: boolean
  activeFloatingPanel: string
}

export interface LayoutContextValue extends LayoutState {
  setLeftWidth: (width: number | ((prev: number) => number)) => void
  setRightWidth: (width: number | ((prev: number) => number)) => void
  setBottomHeight: (height: number | ((prev: number) => number)) => void
  setFloatingPanelGeometry: (id: string, geometry: LayoutState['floatingPanels'][string]) => void
  toggleLeftCollapsed: () => void
  toggleRightCollapsed: () => void
  toggleBottomCollapsed: () => void
  openLeftTab: (id: string) => void
  openRightTab: (id: string) => void
  openBottomTab: (id: string) => void
  toggleZenMode: () => void
  resetLayout: () => void
  openFloatingPanel: (id?: string) => void
  closeFloatingPanel: () => void
  toggleFloatingPanel: (id?: string) => void
  setActiveFloatingPanel: (id: string) => void
}

const STORAGE_KEY = 'desksuite.workbench.layout'

const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 268,
  rightWidth: 320,
  bottomHeight: 220,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
  activeLeftTab: 'files',
  activeRightTab: 'inspector',
  activeBottomTab: 'console',
  zenMode: false,
  floatingPanels: {},
  floatingPanelOpen: false,
  activeFloatingPanel: 'clipboard'
}

const panelSchema = z.object({ x: z.number().finite(), y: z.number().finite(), width: z.number().finite(), height: z.number().finite(), maximized: z.boolean().optional() })
const layoutSchema = z.object({
  leftWidth: z.number().finite().optional(), rightWidth: z.number().finite().optional(), bottomHeight: z.number().finite().optional(),
  leftCollapsed: z.boolean().optional(), rightCollapsed: z.boolean().optional(), bottomCollapsed: z.boolean().optional(),
  activeLeftTab: z.string().min(1).max(128).optional(), activeRightTab: z.string().min(1).max(128).optional(), activeBottomTab: z.string().min(1).max(128).optional(),
  zenMode: z.boolean().optional(), floatingPanels: z.record(z.string(), panelSchema).optional()
})
const persistedSchema = z.object({ version: z.literal(2).optional(), layout: layoutSchema.optional(), floating: z.object({ open: z.boolean().optional(), active: z.string().min(1).max(128).optional() }).optional() }).passthrough()

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

function restoreLayout(): LayoutState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return DEFAULT_LAYOUT
    const json: unknown = JSON.parse(raw)
    const envelope = persistedSchema.safeParse(json)
    if (!envelope.success) {
      console.warn('[workbench] Invalid persisted layout; using defaults', envelope.error.issues)
      return DEFAULT_LAYOUT
    }
    const record = json as Record<string, unknown>
    const rawLayout = envelope.data.version === 2 && envelope.data.layout ? envelope.data.layout : record
    const parsed = layoutSchema.safeParse(rawLayout)
    if (!parsed.success) {
      console.warn('[workbench] Invalid persisted layout fields; using defaults', parsed.error.issues)
      return DEFAULT_LAYOUT
    }
    const value = parsed.data
    const floatingPanels: LayoutState['floatingPanels'] = {}
    for (const [id, panel] of Object.entries(value.floatingPanels ?? {}).slice(0, 100)) {
      if (!id || id.length > 128) continue
      floatingPanels[id] = {
        x: clamp(panel.x, 0, 20000), y: clamp(panel.y, 0, 20000),
        width: clamp(panel.width, 260, 10000), height: clamp(panel.height, 240, 10000), maximized: panel.maximized === true
      }
    }
    const floating = envelope.data.floating
    return {
      ...DEFAULT_LAYOUT,
      leftWidth: clamp(value.leftWidth ?? DEFAULT_LAYOUT.leftWidth, 180, 560),
      rightWidth: clamp(value.rightWidth ?? DEFAULT_LAYOUT.rightWidth, 220, 640),
      bottomHeight: clamp(value.bottomHeight ?? DEFAULT_LAYOUT.bottomHeight, 120, 560),
      leftCollapsed: value.leftCollapsed ?? DEFAULT_LAYOUT.leftCollapsed,
      rightCollapsed: value.rightCollapsed ?? DEFAULT_LAYOUT.rightCollapsed,
      bottomCollapsed: value.bottomCollapsed ?? DEFAULT_LAYOUT.bottomCollapsed,
      activeLeftTab: value.activeLeftTab ?? DEFAULT_LAYOUT.activeLeftTab,
      activeRightTab: value.activeRightTab ?? DEFAULT_LAYOUT.activeRightTab,
      activeBottomTab: value.activeBottomTab ?? DEFAULT_LAYOUT.activeBottomTab,
      zenMode: value.zenMode ?? DEFAULT_LAYOUT.zenMode,
      floatingPanels,
      floatingPanelOpen: floating?.open === true,
      activeFloatingPanel: floating?.active ?? DEFAULT_LAYOUT.activeFloatingPanel
    }
  } catch (error) {
    console.warn('[workbench] Could not restore persisted layout; using defaults', error)
    return DEFAULT_LAYOUT
  }
}

const initialLayout = restoreLayout()
export const layoutStore = createStore<LayoutContextValue>((set, get) => ({
  ...initialLayout,
  setLeftWidth: (width) => set((state) => ({ leftWidth: clamp(typeof width === 'function' ? width(state.leftWidth) : width, 180, 560) })),
  setRightWidth: (width) => set((state) => ({ rightWidth: clamp(typeof width === 'function' ? width(state.rightWidth) : width, 220, 640) })),
  setBottomHeight: (height) => set((state) => ({ bottomHeight: clamp(typeof height === 'function' ? height(state.bottomHeight) : height, 120, 560) })),
  setFloatingPanelGeometry: (id, geometry) => set((state) => {
    const current = state.floatingPanels[id]
    if (current && current.x === geometry.x && current.y === geometry.y && current.width === geometry.width && current.height === geometry.height && current.maximized === geometry.maximized) return state
    return { floatingPanels: { ...state.floatingPanels, [id]: geometry } }
  }),
  toggleLeftCollapsed: () => set((state) => ({ leftCollapsed: !state.leftCollapsed })),
  toggleRightCollapsed: () => set((state) => ({ rightCollapsed: !state.rightCollapsed })),
  toggleBottomCollapsed: () => set((state) => ({ bottomCollapsed: !state.bottomCollapsed })),
  openLeftTab: (id) => set({ activeLeftTab: id, leftCollapsed: false }),
  openRightTab: (id) => set({ activeRightTab: id, rightCollapsed: false }),
  openBottomTab: (id) => set({ activeBottomTab: id, bottomCollapsed: false }),
  toggleZenMode: () => set((state) => {
    const next = !state.zenMode
    return { zenMode: next, leftCollapsed: next, rightCollapsed: next, bottomCollapsed: next }
  }),
  resetLayout: () => set({ ...DEFAULT_LAYOUT }),
  openFloatingPanel: (id) => set((state) => ({ floatingPanelOpen: true, activeFloatingPanel: id ?? state.activeFloatingPanel })),
  closeFloatingPanel: () => set({ floatingPanelOpen: false }),
  toggleFloatingPanel: (id) => set((state) => state.floatingPanelOpen && (!id || id === state.activeFloatingPanel)
    ? { floatingPanelOpen: false }
    : { floatingPanelOpen: true, activeFloatingPanel: id ?? state.activeFloatingPanel }),
  setActiveFloatingPanel: (id) => set({ activeFloatingPanel: id })
}))

function persistLayout(state: LayoutContextValue): void {
  try {
    const layout: LayoutState = {
      leftWidth: state.leftWidth, rightWidth: state.rightWidth, bottomHeight: state.bottomHeight,
      leftCollapsed: state.leftCollapsed, rightCollapsed: state.rightCollapsed, bottomCollapsed: state.bottomCollapsed,
      activeLeftTab: state.activeLeftTab, activeRightTab: state.activeRightTab, activeBottomTab: state.activeBottomTab,
      zenMode: state.zenMode, floatingPanels: state.floatingPanels, floatingPanelOpen: state.floatingPanelOpen,
      activeFloatingPanel: state.activeFloatingPanel
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 2, layout, floating: { open: state.floatingPanelOpen, active: state.activeFloatingPanel } }))
  } catch {
    // Local storage is optional; layout remains available in the current session.
  }
}

export function LayoutProvider({ children }: { children: ReactNode }): ReactElement {
  useEffect(() => {
    return layoutStore.subscribe(persistLayout)
  }, [])
  return <>{children}</>
}

export function useLayout<T = LayoutContextValue>(selector: (state: LayoutContextValue) => T = (state) => state as unknown as T): T {
  return useStore(layoutStore, selector)
}

export function useLayoutShallow<T>(selector: (state: LayoutContextValue) => T): T {
  return useStore(layoutStore, useShallow(selector))
}
