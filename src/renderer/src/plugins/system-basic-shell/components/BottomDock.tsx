import type { ReactElement } from 'react'
import { ChevronDown } from 'lucide-react'
import {
  SlotRenderer,
  useContributions,
  useLayout,
  useUiKit
} from '../../../workbench/sdk'

export function BottomDock(): ReactElement | null {
  const { DesktopIconButton, DesktopTab } = useUiKit()
  const {
    bottomHeight,
    bottomCollapsed,
    toggleBottomCollapsed,
    activeBottomTab,
    openBottomTab
  } = useLayout()
  const tabs = useContributions('bottom.tabs')

  if (bottomCollapsed) return null

  return (
    <div
      style={{ height: `${bottomHeight}px` }}
      className="w-full bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-dark)] border-t border-[var(--ds-border)] dark:border-[var(--ds-border)] flex flex-col select-none shrink-0 overflow-hidden z-20 shadow-lg"
    >
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-raised)] shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabs.length > 0 ? (
            tabs.map((tab) => {
              const Label = tab.label
              return (
                <DesktopTab
                  key={tab.id}
                  active={activeBottomTab === tab.id}
                  icon={Label ? undefined : tab.icon}
                  badge={Label ? undefined : tab.badge}
                  label={Label ? <Label active={activeBottomTab === tab.id} /> : tab.title ?? tab.id}
                  onClick={() => openBottomTab(tab.id)}
                  className="shrink-0"
                />
              )
            })
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[var(--ds-text-primary)] dark:text-white">
              <span>调试输出</span>
            </div>
          )}
        </div>

        <div className="flex items-center gap-1.5">
          <SlotRenderer slotId="bottom.toolbar" className="flex items-center gap-1" />
          <DesktopIconButton
            size="xs"
            onClick={toggleBottomCollapsed}
            tooltip="折叠底部抽屉"
            icon={<ChevronDown className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      <div className="flex-1 overflow-auto min-h-0 bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-code)]">
        <SlotRenderer
          slotId="bottom.content"
          only={activeBottomTab}
          props={{ activeTab: activeBottomTab }}
          fallback={
            <div className="p-4 text-xs text-[var(--ds-text-subtle)] text-center">暂无挂载的底部控制台内容</div>
          }
        />
      </div>
    </div>
  )
}
