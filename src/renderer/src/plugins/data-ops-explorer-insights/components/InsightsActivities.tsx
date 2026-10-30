import type { ReactElement } from 'react'
import { Archive, ChartNoAxesColumn } from 'lucide-react'
import { useLayout, useUiKit } from '../../../workbench/sdk'
import { useBasket } from '../basket'

export function InsightsActivities(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayout()
  const basket = useBasket()

  const toggle = (id: string): void => {
    if (floatingPanelOpen && activeFloatingPanel === id) closeFloatingPanel()
    else openFloatingPanel(id)
  }

  return (
    <>
      <ActivityButton
        icon={<ChartNoAxesColumn className="w-4 h-4" />}
        label="统计"
        active={floatingPanelOpen && activeFloatingPanel === 'analytics'}
        tooltip="资产统计分析（Alt+1）"
        onClick={() => toggle('analytics')}
      />
      <ActivityButton
        icon={<Archive className="w-4 h-4" />}
        label="暂存"
        active={floatingPanelOpen && activeFloatingPanel === 'basket'}
        badge={basket.length > 0 ? basket.length : undefined}
        tooltip="文件暂存篮（Alt+2）"
        onClick={() => toggle('basket')}
      />
    </>
  )
}
