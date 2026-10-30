import { createContext, useContext, useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'

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
}

interface LayoutContextValue extends LayoutState {
  floatingPanelOpen: boolean
  activeFloatingPanel: string
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
  floatingPanels: {}
}

const clamp = (value: number, min: number, max: number): number => Math.max(min, Math.min(max, value))

interface PersistedWorkbenchState {
  layout: LayoutState
  floatingPanelOpen: boolean
  activeFloatingPanel: string
}

function readPersistedWorkbenchState(): PersistedWorkbenchState {
  try {
    const raw = localStorage.getItem(STORAGE_KEY)
    if (!raw) return { layout: DEFAULT_LAYOUT, floatingPanelOpen: false, activeFloatingPanel: 'clipboard' }
    const parsed: unknown = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') throw new Error('Invalid workbench state')
    const record = parsed as Record<string, unknown>
    // 兼容此前直接保存 LayoutState 的版本。
    const source = record.version === 2 && record.layout && typeof record.layout === 'object'
      ? record.layout as Record<string, unknown>
      : record
    const number = (key: 'leftWidth' | 'rightWidth' | 'bottomHeight'): number =>
      typeof source[key] === 'number' && Number.isFinite(source[key]) ? source[key] as number : DEFAULT_LAYOUT[key]
    const bool = (key: 'leftCollapsed' | 'rightCollapsed' | 'bottomCollapsed' | 'zenMode'): boolean =>
      typeof source[key] === 'boolean' ? source[key] as boolean : DEFAULT_LAYOUT[key]
    const tab = (key: 'activeLeftTab' | 'activeRightTab' | 'activeBottomTab'): string =>
      typeof source[key] === 'string' && source[key] ? (source[key] as string).slice(0, 128) : DEFAULT_LAYOUT[key]
    const storedFloating = record.version === 2 ? record.floating : undefined
    const floating = storedFloating && typeof storedFloating === 'object' ? storedFloating as Record<string, unknown> : {}
    const storedPanels = source.floatingPanels && typeof source.floatingPanels === 'object' ? source.floatingPanels as Record<string, unknown> : {}
    const floatingPanels: LayoutState['floatingPanels'] = {}
    for (const [id, rawPanel] of Object.entries(storedPanels).slice(0, 100)) {
      if (!id || id.length > 128 || !rawPanel || typeof rawPanel !== 'object') continue
      const panel = rawPanel as Record<string, unknown>
      if (['x', 'y', 'width', 'height'].every((key) => typeof panel[key] === 'number' && Number.isFinite(panel[key]))) {
        floatingPanels[id] = {
          x: clamp(panel.x as number, 0, 20000), y: clamp(panel.y as number, 0, 20000),
          width: clamp(panel.width as number, 260, 10000), height: clamp(panel.height as number, 240, 10000),
          maximized: panel.maximized === true
        }
      }
    }
    return {
      layout: {
        leftWidth: clamp(number('leftWidth'), 180, 560),
        rightWidth: clamp(number('rightWidth'), 220, 640),
        bottomHeight: clamp(number('bottomHeight'), 120, 560),
        leftCollapsed: bool('leftCollapsed'),
        rightCollapsed: bool('rightCollapsed'),
        bottomCollapsed: bool('bottomCollapsed'),
        activeLeftTab: tab('activeLeftTab'),
        activeRightTab: tab('activeRightTab'),
        activeBottomTab: tab('activeBottomTab'),
        zenMode: bool('zenMode'),
        floatingPanels
      },
      floatingPanelOpen: floating.open === true,
      activeFloatingPanel: typeof floating.active === 'string' && floating.active ? floating.active.slice(0, 128) : 'clipboard'
    }
  } catch {
    return { layout: DEFAULT_LAYOUT, floatingPanelOpen: false, activeFloatingPanel: 'clipboard' }
  }
}

const LayoutContext = createContext<LayoutContextValue | undefined>(undefined)

export function LayoutProvider({ children }: { children: ReactNode }): ReactElement {
  const [initial] = useState(readPersistedWorkbenchState)
  const [layout, setLayout] = useState<LayoutState>(initial.layout)
  const [floatingPanelOpen, setFloatingPanelOpen] = useState(initial.floatingPanelOpen)
  const [activeFloatingPanel, setActiveFloatingPanel] = useState(initial.activeFloatingPanel)

  useEffect(() => {
    try {
      localStorage.setItem(STORAGE_KEY, JSON.stringify({
        version: 2,
        layout,
        floating: { open: floatingPanelOpen, active: activeFloatingPanel }
      }))
    } catch {
      // 本地存储不可用时只在当前会话中保留布局。
    }
  }, [layout, floatingPanelOpen, activeFloatingPanel])

  const update = (patch: Partial<LayoutState>): void => setLayout((prev) => ({ ...prev, ...patch }))

  const openLeftTab = (id: string): void => update({ activeLeftTab: id, leftCollapsed: false })
  const openRightTab = (id: string): void => update({ activeRightTab: id, rightCollapsed: false })
  const openBottomTab = (id: string): void => update({ activeBottomTab: id, bottomCollapsed: false })

  const openFloatingPanel = (id?: string): void => {
    if (id) setActiveFloatingPanel(id)
    setFloatingPanelOpen(true)
  }

  const closeFloatingPanel = (): void => setFloatingPanelOpen(false)

  const toggleFloatingPanel = (id?: string): void => {
    if (floatingPanelOpen && (!id || id === activeFloatingPanel)) {
      setFloatingPanelOpen(false)
      return
    }
    openFloatingPanel(id)
  }

  const toggleZenMode = (): void => {
    setLayout((prev) => {
      const nextZen = !prev.zenMode
      return {
        ...prev,
        zenMode: nextZen,
        leftCollapsed: nextZen,
        rightCollapsed: nextZen,
        bottomCollapsed: nextZen
      }
    })
  }

  const resetLayout = (): void => {
    setLayout(DEFAULT_LAYOUT)
    setFloatingPanelOpen(false)
    setActiveFloatingPanel('clipboard')
  }

  return (
    <LayoutContext.Provider
      value={{
        ...layout,
        floatingPanelOpen,
        activeFloatingPanel,
        setLeftWidth: (width) =>
          setLayout((prev) => ({
            ...prev,
            leftWidth: clamp(typeof width === 'function' ? width(prev.leftWidth) : width, 180, 560)
          })),
        setRightWidth: (width) =>
          setLayout((prev) => ({
            ...prev,
            rightWidth: clamp(typeof width === 'function' ? width(prev.rightWidth) : width, 220, 640)
          })),
        setBottomHeight: (height) =>
          setLayout((prev) => ({
            ...prev,
            bottomHeight: clamp(
              typeof height === 'function' ? height(prev.bottomHeight) : height,
              120,
              560
            )
          })),
        setFloatingPanelGeometry: (id, geometry) => setLayout((prev) => {
          const current = prev.floatingPanels[id]
          if (current && current.x === geometry.x && current.y === geometry.y && current.width === geometry.width && current.height === geometry.height && current.maximized === geometry.maximized) return prev
          return { ...prev, floatingPanels: { ...prev.floatingPanels, [id]: geometry } }
        }),
        toggleLeftCollapsed: () =>
          setLayout((prev) => ({ ...prev, leftCollapsed: !prev.leftCollapsed })),
        toggleRightCollapsed: () =>
          setLayout((prev) => ({ ...prev, rightCollapsed: !prev.rightCollapsed })),
        toggleBottomCollapsed: () =>
          setLayout((prev) => ({ ...prev, bottomCollapsed: !prev.bottomCollapsed })),
        openLeftTab,
        openRightTab,
        openBottomTab,
        toggleZenMode,
        resetLayout,
        openFloatingPanel,
        closeFloatingPanel,
        toggleFloatingPanel,
        setActiveFloatingPanel
      }}
    >
      {children}
    </LayoutContext.Provider>
  )
}

export function useLayout(): LayoutContextValue {
  const context = useContext(LayoutContext)
  if (!context) throw new Error('useLayout 必须在 LayoutProvider 内使用')
  return context
}
