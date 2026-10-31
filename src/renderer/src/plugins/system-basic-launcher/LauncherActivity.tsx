import type { ReactElement } from 'react'
import { AppWindow } from 'lucide-react'
import { useLayoutShallow, useUiKit } from '../../workbench/sdk'

export function LauncherActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel, openFloatingPanel: state.openFloatingPanel }))
  const active = floatingPanelOpen && activeFloatingPanel === 'launcher'
  return <ActivityButton icon={<AppWindow className="w-4 h-4" />} label="启动台" active={active} tooltip="应用启动台" onClick={() => active ? closeFloatingPanel() : openFloatingPanel('launcher')} />
}
