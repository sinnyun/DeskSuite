import type { ReactElement } from 'react'
import { Clipboard } from 'lucide-react'
import { useLayout, useUiKit } from '../../../workbench/sdk'

export function ClipboardActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayout()
  const active = floatingPanelOpen && activeFloatingPanel === 'clipboard'

  return (
    <ActivityButton
      icon={<Clipboard className="w-4 h-4" />}
      label="剪贴板"
      active={active}
      tooltip="剪贴板工作台（Alt+3）"
      onClick={() => {
        if (active) closeFloatingPanel()
        else openFloatingPanel('clipboard')
      }}
    />
  )
}
