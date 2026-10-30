import { useEffect, type ReactElement } from 'react'
import { FolderKanban } from 'lucide-react'
import { useLayout, useUiKit } from '../../workbench/sdk'

export function WorkCrateActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayout()
  const active = floatingPanelOpen && activeFloatingPanel === 'workcrate'
    useEffect(() => window.bridge.onEvent((channel) => {
      if (channel === 'workcrate:panel-open') openFloatingPanel('workcrate')
    }), [openFloatingPanel])
  return <ActivityButton icon={<FolderKanban className="h-4 w-4" />} label="工程资料箱" active={active} tooltip="WorkCrate 工程与文件集合" onClick={() => active ? closeFloatingPanel() : openFloatingPanel('workcrate')} />
}
