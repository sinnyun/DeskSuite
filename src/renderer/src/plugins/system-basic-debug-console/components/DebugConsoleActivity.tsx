import type { ReactElement } from 'react'
import { Terminal } from 'lucide-react'
import { useLayout, useLogs, useUiKit } from '../../../workbench/sdk'

export function DebugConsoleActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeFloatingPanel, toggleFloatingPanel } = useLayout()
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
