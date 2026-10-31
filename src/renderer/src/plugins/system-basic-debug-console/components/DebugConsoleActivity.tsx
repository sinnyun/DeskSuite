import type { ReactElement } from 'react'
import { Terminal } from 'lucide-react'
import { useLayoutShallow, useLogs, useUiKit } from '../../../workbench/sdk'

export function DebugConsoleActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeFloatingPanel, toggleFloatingPanel } = useLayoutShallow((state) => ({ activeFloatingPanel: state.activeFloatingPanel, toggleFloatingPanel: state.toggleFloatingPanel }))
  const logs = useLogs()
  const active = activeFloatingPanel === 'debug-console'

  return (
    <ActivityButton
      icon={<Terminal className="w-4 h-4" />}
      label="调试"
      active={active}
      badge={logs.length > 0 ? logs.length : undefined}
      tooltip="打开或关闭调试信息悬浮面板"
      onClick={() => toggleFloatingPanel('debug-console')}
    />
  )
}
