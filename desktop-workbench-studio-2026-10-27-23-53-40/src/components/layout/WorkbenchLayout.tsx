import React from 'react';
import { useLayout } from '../../core/LayoutContext';
import { TopBar } from './TopBar';
import { LeftSidebar } from './LeftSidebar';
import { CenterWorkspace } from './CenterWorkspace';
import { RightSidebar } from './RightSidebar';
import { BottomDock } from './BottomDock';
import { StatusBar } from './StatusBar';
import { SplitterHandle } from './SplitterHandle';
import { UniversalFloatingWindow } from '../floating/UniversalFloatingWindow';

export const WorkbenchLayout: React.FC = () => {
  const {
    leftCollapsed,
    setLeftWidth,
    rightCollapsed,
    setRightWidth,
    bottomCollapsed,
    setBottomHeight,
  } = useLayout();

  return (
    <div className="flex flex-col h-screen w-screen overflow-hidden bg-[#f2f4f8] dark:bg-[#11141a] text-[#1e293b] dark:text-[#f1f5f9] select-none font-sans relative">
      {/* 1. FileAtlas Top Bar */}
      <TopBar />

      {/* 2. Middle Body: Left (Permanent Rail + Secondary Drawer) + Center + Right */}
      <div className="flex-1 flex min-h-0 w-full overflow-hidden relative">
        {/* Left Sidebar Frame (Permanent Activity Rail + Expandable Drawer) */}
        <LeftSidebar />

        {/* Left Splitter Handle (active when expandable drawer not collapsed) */}
        {!leftCollapsed && (
          <SplitterHandle
            direction="vertical"
            label="拖动调整左侧栏宽度"
            onResize={(delta) => setLeftWidth((prev) => prev + delta)}
            onReset={() => setLeftWidth(260)}
          />
        )}

        {/* Center Region (Workspace Canvas + Horizontal Splitter + Bottom Dock) */}
        <div className="flex-1 flex flex-col min-w-0 h-full overflow-hidden relative bg-[#f2f4f8] dark:bg-[#11141a]">
          {/* Main Center Workspace */}
          <CenterWorkspace />

          {/* Bottom Splitter Handle (active when bottom dock not collapsed) */}
          {!bottomCollapsed && (
            <SplitterHandle
              direction="horizontal"
              label="拖动调整底部控制台高度"
              onResize={(delta) => setBottomHeight((prev) => prev - delta)}
              onReset={() => setBottomHeight(210)}
            />
          )}

          {/* Bottom Dock Frame */}
          <BottomDock />
        </div>

        {/* Right Splitter Handle (active when not collapsed) */}
        {!rightCollapsed && (
          <SplitterHandle
            direction="vertical"
            label="拖动调整右侧栏宽度"
            onResize={(delta) => setRightWidth((prev) => prev - delta)}
            onReset={() => setRightWidth(310)}
          />
        )}

        {/* Right Sidebar Frame */}
        <RightSidebar />
      </div>

      {/* 3. Status Bar */}
      <StatusBar />

      {/* 4. Universal Floating Panel (通用可拖拽调整大小的悬浮面板) */}
      <UniversalFloatingWindow />
    </div>
  );
};
