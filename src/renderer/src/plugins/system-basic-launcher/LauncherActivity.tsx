import type { ReactElement } from 'react'
import { AppWindow } from 'lucide-react'
import { useLayout, useUiKit } from '../../workbench/sdk'

export function LauncherActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayout()
  const active = floatingPanelOpen && activeFloatingPanel === 'launcher'
  return <ActivityButton icon={<AppWindow className="w-4 h-4" />} label="启动台" active={active} tooltip="应用启动台" onClick={() => active ? closeFloatingPanel() : openFloatingPanel('launcher')} />
}
