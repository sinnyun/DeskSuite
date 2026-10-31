import type { ReactElement } from 'react'
import { Folder } from 'lucide-react'
import { useLayoutShallow, useUiKit } from '../../../workbench/sdk'

export function ExplorerActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeLeftTab, leftCollapsed, openLeftTab, toggleLeftCollapsed } = useLayoutShallow((state) => ({ activeLeftTab: state.activeLeftTab, leftCollapsed: state.leftCollapsed, openLeftTab: state.openLeftTab, toggleLeftCollapsed: state.toggleLeftCollapsed }))
  const active = activeLeftTab === 'files' && !leftCollapsed

  return (
    <ActivityButton
      icon={<Folder className="w-4 h-4" />}
      label="文件"
      active={active}
      tooltip="文件浏览器（点击展开/折叠）"
      onClick={() => {
        if (active) toggleLeftCollapsed()
        else openLeftTab('files')
      }}
    />
  )
}
