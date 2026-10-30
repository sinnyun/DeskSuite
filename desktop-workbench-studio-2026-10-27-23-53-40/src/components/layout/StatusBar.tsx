import React from 'react';
import { useLayout } from '../../core/LayoutContext';
import { useExplorer } from '../../plugins/file-explorer/context/ExplorerContext';
import { SlotRenderer } from '../../core/SlotRegistry';
import { Terminal, SlidersHorizontal } from 'lucide-react';
import { useDebug } from '../../plugins/debug-console/context/DebugContext';

export const StatusBar: React.FC = () => {
  const { bottomCollapsed, toggleBottomCollapsed, openFloatingPanel } = useLayout();
  const { currentFolderFiles, selectedFileIds } = useExplorer();
  const { logs } = useDebug();



  const folderCount = currentFolderFiles.filter((f) => f.type === 'folder').length;
  const fileCount = currentFolderFiles.length - folderCount;

  return (
    <footer className="h-8 w-full bg-white dark:bg-[#161922] border-t border-[#e2e8f0] dark:border-[#2a3140] flex items-center justify-between px-3 text-xs text-[#64748b] dark:text-[#94a3b8] select-none shrink-0 font-sans shadow-xs z-30">
      {/* Zone 1: Desktop Engine & Workspace Status */}
      <div className="flex items-center gap-2 min-w-0">
        <div className="flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[#f1f5f9] dark:bg-[#222834] text-[11px] font-medium text-[#475569] dark:text-[#cbd5e1]">
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <span>核心引擎就绪</span>
        </div>

        <div className="hidden sm:flex items-center gap-1 text-[11px] text-[#94a3b8]">
          <span>UTF-8</span>
          <span>·</span>
          <span>LF</span>
          <span>·</span>
          <span className="font-mono text-[#5b5ce6] font-medium">test-data / fileatlas-fixtures</span>
        </div>
      </div>

      {/* Zone 2: File Atlas Object Counts */}
      <div className="hidden md:flex items-center gap-1.5 text-xs text-[#64748b] font-mono tabular-nums">
        <span>{folderCount || 5} 个文件夹</span>
        <span className="text-[#cbd5e1]">·</span>
        <span>{fileCount || 12} 个文件</span>
        <span className="text-[#cbd5e1]">·</span>
        <span>已选择 {selectedFileIds.length} 项</span>
      </div>

      {/* Zone 3: Debug Console Drawer Toggle Pill */}
      <div className="flex items-center gap-2 shrink-0">
        <SlotRenderer slotId="statusbar.right" />

        <button
          type="button"
          onClick={toggleBottomCollapsed}
          className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border transition-all cursor-pointer ${
            !bottomCollapsed
              ? 'bg-[#eef2ff] border-[#5b5ce6] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6]'
              : 'bg-white hover:bg-[#f8fafc] text-[#475569] border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140]'
          }`}
          title={bottomCollapsed ? '展开底部调试控制台' : '收起底部调试控制台'}
        >
          <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
          <Terminal className="w-3 h-3 text-[#5b5ce6]" />
          <span>调试抽屉</span>
          <span className="text-[10px] font-mono text-[#94a3b8] tabular-nums">
            ({logs.length})
          </span>
        </button>
      </div>
    </footer>
  );
};
