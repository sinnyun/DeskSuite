import type { ReactElement } from 'react'
import { Info } from 'lucide-react'
import {
  SlotRenderer,
  useContributions,
  useLayout,
  useUiKit
} from '../../../workbench/sdk'

export function RightSidebar(): ReactElement {
  const { ThemeSidebarPanel, DesktopIconButton } = useUiKit()
  const {
    rightWidth,
    rightCollapsed,
    toggleRightCollapsed,
    openRightTab,
    activeRightTab
  } = useLayout()
  const tabs = useContributions('sidebar.right.tabs')

  if (rightCollapsed) {
    return (
      <aside className="w-12 bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-dark)] border-l border-[var(--ds-border)] dark:border-[var(--ds-border)] flex flex-col items-center py-3 gap-2 select-none shrink-0 z-10 shadow-xs">
        <DesktopIconButton
          size="sm"
          onClick={toggleRightCollapsed}
          tooltip="展开右侧检查器"
          icon={<Info className="w-4 h-4" />}
        />

        <div className="w-6 h-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)] my-1" />

        {tabs.map((tab) => (
          <DesktopIconButton
            key={tab.id}
            size="sm"
            active={activeRightTab === tab.id}
            onClick={() => openRightTab(tab.id)}
            tooltip={tab.title}
            icon={tab.icon || <Info className="w-4 h-4" />}
          />
        ))}
      </aside>
    )
  }

  return (
    <ThemeSidebarPanel
      title="属性信息"
      tabs={tabs.map((tab) => ({
        id: tab.id,
        title: tab.title || '属性信息',
        icon: tab.icon,
        badge: tab.badge
      }))}
      activeTab={activeRightTab}
      onTabChange={openRightTab}
      collapsed={rightCollapsed}
      onToggleCollapse={toggleRightCollapsed}
      width={rightWidth}
      side="right"
    >
      <SlotRenderer
        slotId="sidebar.right.content"
        only={activeRightTab}
        props={{ activeTab: activeRightTab }}
        fallback={
          <div className="p-4 text-xs text-[var(--ds-text-subtle)] text-center">暂无挂载的右侧插件内容</div>
        }
      />
    </ThemeSidebarPanel>
  )
}
