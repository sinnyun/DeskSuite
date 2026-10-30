import type { ReactElement } from 'react'
import { Terminal } from 'lucide-react'
import { useLayout, useLogs, useUiKit } from '../../../workbench/sdk'

export function DebugConsoleActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeBottomTab, bottomCollapsed, openBottomTab, toggleBottomCollapsed } = useLayout()
  const logs = useLogs()
  const active = activeBottomTab === 'console' && !bottomCollapsed

  return (
    <ActivityButton
      icon={<Terminal className="w-4 h-4" />}
      label="控制台"
      active={active}
      badge={logs.length > 0 ? logs.length : undefined}
      tooltip="调试控制台（点击展开/折叠）"
      onClick={() => {
        if (active) toggleBottomCollapsed()
        else openBottomTab('console')
      }}
    />
  )
}
