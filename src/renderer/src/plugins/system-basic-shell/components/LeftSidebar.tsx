import type { ReactElement } from 'react'
import { SlotRenderer, useContributions, useLayoutShallow, useUiKit } from '../../../workbench/sdk'

export function LeftSidebar(): ReactElement {
  const { ThemeSidebarPanel } = useUiKit()
  const { leftWidth, leftCollapsed, toggleLeftCollapsed, activeLeftTab, openLeftTab } = useLayoutShallow((state) => ({
    leftWidth: state.leftWidth, leftCollapsed: state.leftCollapsed, toggleLeftCollapsed: state.toggleLeftCollapsed,
    activeLeftTab: state.activeLeftTab, openLeftTab: state.openLeftTab
  }))
  const tabs = useContributions('sidebar.left.tabs')

  return (
    <div className="flex h-full shrink-0 select-none overflow-hidden z-20">
        <nav className="w-14 py-2.5 flex flex-col items-center gap-1.5 border-r border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-subtle)] shrink-0 overflow-y-auto no-scrollbar">
        <SlotRenderer
          slotId="sidebar.activity"
          className="flex flex-col items-center gap-1.5 w-full px-1"
        />

        <div className="mt-auto pt-2 w-full flex flex-col items-center gap-1.5 px-1 shrink-0">
          <div className="w-6 h-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)]" />
          <SlotRenderer
            slotId="sidebar.activity.bottom"
            className="flex flex-col items-center gap-1.5 w-full"
          />
        </div>
      </nav>

      <ThemeSidebarPanel
        title="资源目录"
        tabs={tabs.map((tab) => ({
          id: tab.id,
          title: tab.title || '资源管理',
          icon: tab.icon,
          badge: tab.badge
        }))}
        activeTab={activeLeftTab}
        onTabChange={openLeftTab}
        collapsed={leftCollapsed}
        onToggleCollapse={toggleLeftCollapsed}
        width={leftWidth}
        side="left"
      >
        <SlotRenderer
          slotId="sidebar.left.content"
          only={activeLeftTab}
          props={{ activeTab: activeLeftTab }}
          fallback={
            <div className="p-4 text-xs text-[var(--ds-text-subtle)] text-center">暂无挂载的左侧插件内容</div>
          }
        />
      </ThemeSidebarPanel>
    </div>
  )
}
