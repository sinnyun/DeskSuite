import '../shell.css'
import { useEffect } from 'react'
import type { ReactElement } from 'react'
import { ChevronDown, ChevronLeft, ChevronRight } from 'lucide-react'
import { SlotRenderer, log, useLayoutShallow } from '../../../workbench/sdk'
import { TopBar } from './TopBar'
import { LeftSidebar } from './LeftSidebar'
import { CenterWorkspace } from './CenterWorkspace'
import { RightSidebar } from './RightSidebar'
import { BottomDock } from './BottomDock'
import { StatusBar } from './StatusBar'
import { SplitterHandle } from './SplitterHandle'

function useWorkbenchShortcuts(): void {
  const {
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleBottomCollapsed,
    toggleZenMode,
    resetLayout,
    toggleFloatingPanel,
    openFloatingPanel
  } = useLayoutShallow((state) => ({
    leftCollapsed: state.leftCollapsed, rightCollapsed: state.rightCollapsed, bottomCollapsed: state.bottomCollapsed,
    toggleLeftCollapsed: state.toggleLeftCollapsed, toggleRightCollapsed: state.toggleRightCollapsed,
    toggleBottomCollapsed: state.toggleBottomCollapsed, toggleZenMode: state.toggleZenMode,
    resetLayout: state.resetLayout, toggleFloatingPanel: state.toggleFloatingPanel, openFloatingPanel: state.openFloatingPanel
  }))

  useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent): void => {
      const mod = event.metaKey || event.ctrlKey
      const key = event.key.toLowerCase()

      if (mod && event.altKey && key === 'r') {
        event.preventDefault()
        resetLayout()
        log('event', 'Keyboard', '重置工作台布局 (Ctrl+Alt+R)')
        return
      }

      if (mod && key === 'b') {
        event.preventDefault()
        if (event.shiftKey) {
          toggleRightCollapsed()
          log('event', 'Keyboard', '切换右侧属性栏 (Ctrl+Shift+B)', { collapsed: !rightCollapsed })
        } else {
          toggleLeftCollapsed()
          log('event', 'Keyboard', '切换左侧工程栏 (Ctrl+B)', { collapsed: !leftCollapsed })
        }
        return
      }

      if (mod && (key === 'j' || key === 'i')) {
        event.preventDefault()
        if (key === 'j') {
          toggleBottomCollapsed()
          log('event', 'Keyboard', '切换底部控制台 (Ctrl+J)', { collapsed: !bottomCollapsed })
        } else {
          toggleRightCollapsed()
          log('event', 'Keyboard', '切换右侧属性栏 (Ctrl+I)', { collapsed: !rightCollapsed })
        }
        return
      }

      if (event.key === 'F11') {
        event.preventDefault()
        toggleZenMode()
        log('event', 'Keyboard', '切换禅模式 (F11)')
        return
      }

      if (event.altKey && key === 'w') {
        event.preventDefault()
        toggleFloatingPanel()
        return
      }

      if (event.altKey && ['1', '2', '3'].includes(key)) {
        event.preventDefault()
        const panel = key === '1' ? 'analytics' : key === '2' ? 'basket' : 'clipboard'
        openFloatingPanel(panel)
      }
    }

    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleBottomCollapsed,
    toggleZenMode,
    resetLayout,
    toggleFloatingPanel,
    openFloatingPanel
  ])
}

export function WorkbenchShell(): ReactElement {
  const {
    leftCollapsed,
    rightCollapsed,
    bottomCollapsed,
    setLeftWidth,
    setRightWidth,
    setBottomHeight,
    toggleLeftCollapsed,
    toggleRightCollapsed,
    toggleBottomCollapsed
  } = useLayoutShallow((state) => ({
    leftCollapsed: state.leftCollapsed, rightCollapsed: state.rightCollapsed, bottomCollapsed: state.bottomCollapsed,
    setLeftWidth: state.setLeftWidth, setRightWidth: state.setRightWidth, setBottomHeight: state.setBottomHeight,
    toggleLeftCollapsed: state.toggleLeftCollapsed, toggleRightCollapsed: state.toggleRightCollapsed,
    toggleBottomCollapsed: state.toggleBottomCollapsed
  }))

  useWorkbenchShortcuts()

  return (
    <div data-workbench-shell className="flex flex-col h-screen w-screen overflow-hidden bg-[var(--ds-workspace)] text-[var(--ds-text-primary)] select-none font-sans relative">
      <TopBar />

      <div className="flex-1 flex min-h-0 w-full overflow-hidden relative">
        <LeftSidebar />

        {!leftCollapsed && (
          <SplitterHandle
            direction="vertical"
            label="拖动调整左侧栏宽度"
            onResize={(delta) => setLeftWidth((prev) => prev + delta)}
            onReset={() => setLeftWidth(268)}
            onToggleCollapse={toggleLeftCollapsed}
            collapseIcon={<ChevronLeft className="w-3 h-3" />}
            collapseTitle="收起左侧工程栏 (Ctrl+B)"
          />
        )}

        <div className="flex-1 flex flex-col min-w-0 min-h-0 overflow-hidden relative bg-[var(--ds-workspace)]">
          <CenterWorkspace />

          {!bottomCollapsed && (
            <SplitterHandle
              direction="horizontal"
              label="拖动调整底部控制台高度"
              onResize={(delta) => setBottomHeight((prev) => prev - delta)}
              onReset={() => setBottomHeight(220)}
              onToggleCollapse={toggleBottomCollapsed}
              collapseIcon={<ChevronDown className="w-3 h-3" />}
              collapseTitle="收起底部控制台 (Ctrl+J)"
            />
          )}

          <BottomDock />
        </div>

        {!rightCollapsed && (
          <SplitterHandle
            direction="vertical"
            label="拖动调整右侧栏宽度"
            onResize={(delta) => setRightWidth((prev) => prev - delta)}
            onReset={() => setRightWidth(320)}
            onToggleCollapse={toggleRightCollapsed}
            collapseIcon={<ChevronRight className="w-3 h-3" />}
            collapseTitle="收起右侧属性栏 (Ctrl+Shift+B)"
          />
        )}

        <RightSidebar />
      </div>

      <StatusBar />
      <SlotRenderer slotId="floating.panels" />
        <SlotRenderer slotId="overlay.root" />
    </div>
  )
}
