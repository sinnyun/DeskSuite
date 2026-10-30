import React from 'react';
import { useLayout } from '../../core/LayoutContext';
import { useSlotRegistry, SlotRenderer } from '../../core/SlotRegistry';
import { ThemeSidebarPanel } from '../../theme/panels';
import { Info } from 'lucide-react';

export const RightSidebar: React.FC = () => {
  const { rightWidth, rightCollapsed, toggleRightCollapsed, activeRightTab, setActiveRightTab } =
    useLayout();
  const { getSlotContributions } = useSlotRegistry();

  const tabContributions = getSlotContributions('sidebar.right.tabs');

  if (rightCollapsed) {
    return (
      <aside className="w-12 bg-white dark:bg-[#161922] border-l border-[#e2e8f0] dark:border-[#2a3140] flex flex-col items-center py-3 gap-2 select-none shrink-0 z-10 shadow-xs">
        <button
          type="button"
          onClick={toggleRightCollapsed}
          title="展开右侧检查器"
          className="p-2 rounded-xl text-[#64748b] hover:text-[#5b5ce6] hover:bg-[#eef2ff] dark:hover:bg-[#252846] transition-colors cursor-pointer"
        >
          <Info className="w-4 h-4 text-[#5b5ce6]" />
        </button>

        <div className="w-6 h-px bg-[#e2e8f0] dark:bg-[#2a3140] my-1" />

        {tabContributions.map((tab) => (
          <button
            key={tab.id}
            type="button"
            onClick={() => {
              setActiveRightTab(tab.id);
              toggleRightCollapsed();
            }}
            title={tab.title}
            className={`p-2 rounded-xl transition-all cursor-pointer ${
              activeRightTab === tab.id
                ? 'bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6] dark:text-[#7c7df6]'
                : 'text-[#94a3b8] hover:text-[#1e293b]'
            }`}
          >
            {tab.icon || <Info className="w-4 h-4" />}
          </button>
        ))}
      </aside>
    );
  }

  const tabs =
    tabContributions.length > 0
      ? tabContributions.map((t) => ({
          id: t.id,
          title: t.title || '属性信息',
          icon: t.icon,
        }))
      : [{ id: 'inspector', title: '属性信息', icon: <Info className="w-3.5 h-3.5" /> }];

  return (
    <ThemeSidebarPanel
      title="属性信息"
      tabs={tabs}
      activeTab={activeRightTab}
      onTabChange={setActiveRightTab}
      collapsed={rightCollapsed}
      onToggleCollapse={toggleRightCollapsed}
      width={rightWidth}
      side="right"
    >
      <SlotRenderer
        slotId="sidebar.right.content"
        props={{ activeTab: activeRightTab }}
        fallback={
          <div className="p-4 text-xs text-[#94a3b8] text-center">暂无挂载的右侧插件内容</div>
        }
      />
    </ThemeSidebarPanel>
  );
};
