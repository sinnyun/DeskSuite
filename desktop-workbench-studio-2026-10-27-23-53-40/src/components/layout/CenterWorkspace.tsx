import React from 'react';
import { useLayout } from '../../core/LayoutContext';
import { SlotRenderer } from '../../core/SlotRegistry';
import { ThemeWorkspacePanel } from '../../theme/panels';

export const CenterWorkspace: React.FC = () => {
  const { activeWorkspaceView } = useLayout();

  return (
    <ThemeWorkspacePanel
      toolbar={
        <SlotRenderer
          slotId="workspace.toolbar"
          fallback={
            <div className="h-7 text-xs text-[#94a3b8] flex items-center">
              工作区工具栏托槽
            </div>
          }
        />
      }
    >
      <SlotRenderer
        slotId="workspace.views"
        props={{ activeView: activeWorkspaceView }}
        fallback={
          <div className="flex flex-col items-center justify-center h-full p-8 text-[#94a3b8] text-xs">
            暂无挂载的工作区视图
          </div>
        }
      />
    </ThemeWorkspacePanel>
  );
};
