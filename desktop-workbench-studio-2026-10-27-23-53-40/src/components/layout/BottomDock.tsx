import React from 'react';
import { useLayout } from '../../core/LayoutContext';
import { useSlotRegistry, SlotRenderer } from '../../core/SlotRegistry';
import { DesktopIconButton } from '../../theme/components';
import { ChevronDown, Terminal } from 'lucide-react';

export const BottomDock: React.FC = () => {
  const { bottomHeight, bottomCollapsed, toggleBottomCollapsed, activeBottomTab, setActiveBottomTab } =
    useLayout();
  const { getSlotContributions } = useSlotRegistry();

  const tabContributions = getSlotContributions('bottom.tabs');

  if (bottomCollapsed) {
    return null;
  }

  return (
    <div
      style={{ height: `${bottomHeight}px` }}
      className="w-full bg-white dark:bg-[#161922] border-t border-[#e2e8f0] dark:border-[#2a3140] flex flex-col select-none shrink-0 overflow-hidden z-20 shadow-lg"
    >
      {/* Bottom Dock Header with FileAtlas Tabs */}
      <div className="flex items-center justify-between px-3 py-1.5 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabContributions.length > 0 ? (
            tabContributions.map((tab) => (
              <button
                key={tab.id}
                type="button"
                onClick={() => setActiveBottomTab(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                  activeBottomTab === tab.id
                    ? 'bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6] dark:text-[#7c7df6] shadow-2xs border border-[#5b5ce6]/30'
                    : 'text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white'
                }`}
              >
                {tab.icon && <span className="w-3.5 h-3.5 shrink-0">{tab.icon}</span>}
                <span>{tab.title}</span>
                {tab.badge !== undefined && (
                  <span className="px-1.5 py-0.2 text-[10px] font-mono rounded-full bg-black/[0.06] dark:bg-white/[0.1]">
                    {tab.badge}
                  </span>
                )}
              </button>
            ))
          ) : (
            <div className="flex items-center gap-1.5 text-xs font-semibold text-[#1e293b] dark:text-white">
              <Terminal className="w-3.5 h-3.5 text-[#5b5ce6]" />
              <span>调试输出</span>
            </div>
          )}
        </div>

        {/* Toolbar & Collapse Button */}
        <div className="flex items-center gap-1.5">
          <SlotRenderer slotId="bottom.toolbar" className="flex items-center gap-1" />
          <DesktopIconButton
            size="xs"
            onClick={toggleBottomCollapsed}
            tooltip="折叠调试抽屉"
            icon={<ChevronDown className="w-3.5 h-3.5" />}
          />
        </div>
      </div>

      {/* Bottom Content Slot */}
      <div className="flex-1 overflow-auto min-h-0 bg-white dark:bg-[#12151c]">
        <SlotRenderer
          slotId="bottom.content"
          props={{ activeTab: activeBottomTab }}
          fallback={
            <div className="p-4 text-xs text-[#94a3b8] text-center">暂无挂载的底部控制台内容</div>
          }
        />
      </div>
    </div>
  );
};
