import type { ReactElement } from 'react'
import { PanelsTopLeft } from 'lucide-react'
import { useLayoutShallow, useUiKit } from '../../workbench/sdk'

export function WhiteboardActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeFloatingPanel, toggleFloatingPanel } = useLayoutShallow((state) => ({ activeFloatingPanel: state.activeFloatingPanel, toggleFloatingPanel: state.toggleFloatingPanel }))
  const active = activeFloatingPanel === 'whiteboard'
  return (
    <ActivityButton
      icon={<PanelsTopLeft className="w-4 h-4" />}
      label="白板"
      active={active}
      onClick={() => toggleFloatingPanel('whiteboard')}
    />
  )
}
