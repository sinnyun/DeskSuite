import React from 'react';
import { useExplorer } from '../context/ExplorerContext';
import { getFileIcon } from './FileTree';
import { formatBytes } from '../data/mockFiles';
import { ArrowUp, ArrowDown, Star, Folder, Zap } from 'lucide-react';
import { useVirtualizer } from '../../../core/useVirtualizer';
import { DesktopTagPill } from '../../../theme/components';

export const FileListView: React.FC = () => {
  const {
    currentFolderFiles,
    selectedFileIds,
    selectFile,
    navigateToFolder,
    sortField,
    sortOrder,
    setSortField,
    setSortOrder,
    toggleStar,
    virtualizationEnabled,
  } = useExplorer();

  const ROW_HEIGHT = 40;

  // Virtualizer hook for ultra-high performance with 10,000+ rows
  const {
    containerRef,
    virtualItems,
    startIndex,
    endIndex,
    isVirtualActive,
    visibleCount,
    domReductionRatio,
  } = useVirtualizer({
    count: currentFolderFiles.length,
    itemHeight: ROW_HEIGHT,
    overscan: 8,
    enabled: virtualizationEnabled,
  });

  const handleSort = (field: 'name' | 'size' | 'modifiedAt' | 'type') => {
    if (sortField === field) {
      setSortOrder(sortOrder === 'asc' ? 'desc' : 'asc');
    } else {
      setSortField(field);
      setSortOrder('asc');
    }
  };

  const renderSortIndicator = (field: 'name' | 'size' | 'modifiedAt' | 'type') => {
    if (sortField !== field) return null;
    return sortOrder === 'asc' ? (
      <ArrowUp className="w-3 h-3 text-[#5b5ce6] inline ml-1" />
    ) : (
      <ArrowDown className="w-3 h-3 text-[#5b5ce6] inline ml-1" />
    );
  };

  if (currentFolderFiles.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-full p-8 text-[#94a3b8]">
        <Folder className="w-10 h-10 text-[#cbd5e1] mb-2 stroke-1 opacity-50" />
        <span className="text-xs">此文件夹为空或无符合筛选条件的文件</span>
      </div>
    );
  }

  const topPadding = isVirtualActive ? startIndex * ROW_HEIGHT : 0;
  const bottomPadding = isVirtualActive
    ? Math.max(0, (currentFolderFiles.length - endIndex) * ROW_HEIGHT)
    : 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0 select-none bg-white dark:bg-[#161922]">
      {/* Virtualization Performance Banner */}
      {isVirtualActive && (
        <div className="shrink-0 px-4 py-1.5 bg-[#eef2ff] dark:bg-[#252846] border-b border-[#5b5ce6]/20 flex items-center justify-between text-xs text-[#5b5ce6] dark:text-[#7c7df6] font-mono">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#5b5ce6] shrink-0" />
            <span className="font-semibold">轻质感虚拟表格优化开启</span>
            <span className="opacity-40">·</span>
            <span>
              总计 <strong className="font-bold tabular-nums">{currentFolderFiles.length}</strong> 行
            </span>
            <span className="opacity-40">·</span>
            <span>
              DOM 仅挂载 <strong className="font-bold tabular-nums">{visibleCount}</strong> 行 (节省 {domReductionRatio}%)
            </span>
          </div>
          <span className="text-[10px] opacity-80 hidden sm:inline">
            60 FPS 滑动窗口渲染
          </span>
        </div>
      )}

      {/* Virtual Scroll Table Viewport */}
      <div ref={containerRef} className="flex-1 overflow-auto min-h-0 relative">
        <table className="w-full text-left text-xs border-collapse font-sans">
          <thead className="sticky top-0 bg-[#fafbfd] dark:bg-[#1a1e27] border-b border-[#e2e8f0] dark:border-[#2a3140] text-xs font-semibold text-[#64748b] dark:text-[#94a3b8] backdrop-blur-md z-10">
            <tr>
              <th
                onClick={() => handleSort('name')}
                className="py-2 px-4 cursor-pointer hover:text-[#1e293b] dark:hover:text-white"
              >
                名称 {renderSortIndicator('name')}
              </th>
              <th
                onClick={() => handleSort('type')}
                className="py-2 px-3 w-32 cursor-pointer hover:text-[#1e293b] dark:hover:text-white hidden sm:table-cell"
              >
                类型 {renderSortIndicator('type')}
              </th>
              <th
                onClick={() => handleSort('size')}
                className="py-2 px-4 w-28 text-right cursor-pointer hover:text-[#1e293b] dark:hover:text-white"
              >
                大小 {renderSortIndicator('size')}
              </th>
              <th
                onClick={() => handleSort('modifiedAt')}
                className="py-2 px-4 w-44 cursor-pointer hover:text-[#1e293b] dark:hover:text-white hidden md:table-cell"
              >
                修改时间 {renderSortIndicator('modifiedAt')}
              </th>
              <th className="py-2 px-3 w-16 text-center">收藏</th>
            </tr>
          </thead>

          <tbody className="divide-y divide-[#e2e8f0]/60 dark:divide-[#2a3140]/60">
            {/* Top Virtual Spacer */}
            {topPadding > 0 && (
              <tr style={{ height: `${topPadding}px` }} aria-hidden="true">
                <td colSpan={5} className="p-0 border-0" />
              </tr>
            )}

            {/* Rendered Virtual Rows */}
            {virtualItems.map(({ index }) => {
              const file = currentFolderFiles[index];
              if (!file) return null;

              const isSelected = selectedFileIds.includes(file.id);
              const isFolder = file.type === 'folder';

              return (
                <tr
                  key={file.id}
                  style={{ height: `${ROW_HEIGHT}px` }}
                  onClick={(e) => {
                    selectFile(file, e.metaKey || e.ctrlKey);
                  }}
                  onDoubleClick={() => {
                    if (isFolder) {
                      navigateToFolder(file);
                    }
                  }}
                  className={`transition-colors cursor-pointer group select-none ${
                    isSelected
                      ? 'bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6] font-medium'
                      : 'hover:bg-[#fafbfd] dark:hover:bg-[#1a1e27] text-[#1e293b] dark:text-[#f1f5f9]'
                  }`}
                >
                  {/* Name & Icon */}
                  <td className="py-1 px-4">
                    <div className="flex items-center gap-2.5 min-w-0">
                      <span className="shrink-0">{getFileIcon(file, 'w-4 h-4')}</span>
                      <span className="truncate">{file.name}</span>
                      {file.tags && file.tags[0] && (
                        <span className="hidden xl:inline shrink-0">
                          <DesktopTagPill label={file.tags[0]} variant="neutral" />
                        </span>
                      )}
                    </div>
                  </td>

                  {/* Type */}
                  <td className="py-1 px-3 text-[#64748b] dark:text-[#94a3b8] capitalize hidden sm:table-cell">
                    {file.extension ? `${file.extension.toUpperCase()} 文件` : isFolder ? '文件夹' : file.type}
                  </td>

                  {/* Size */}
                  <td className="py-1 px-4 text-right font-mono tabular-nums text-[#64748b] dark:text-[#94a3b8]">
                    {isFolder ? (file.children ? `${file.children.length} 项` : '—') : formatBytes(file.size)}
                  </td>

                  {/* Modified Date */}
                  <td className="py-1 px-4 font-mono tabular-nums text-[#64748b] dark:text-[#94a3b8] hidden md:table-cell text-[11px]">
                    {file.modifiedAt}
                  </td>

                  {/* Star Action */}
                  <td className="py-1 px-3 text-center">
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation();
                        toggleStar(file.id);
                      }}
                      title={file.isFavorite ? '取消收藏' : '添加收藏'}
                      className="p-1 rounded-md text-[#94a3b8] hover:text-amber-500 transition-colors cursor-pointer"
                    >
                      <Star
                        className={`w-3.5 h-3.5 ${
                          file.isFavorite ? 'text-amber-500 fill-amber-500' : 'text-[#94a3b8]/40'
                        }`}
                      />
                    </button>
                  </td>
                </tr>
              );
            })}

            {/* Bottom Virtual Spacer */}
            {bottomPadding > 0 && (
              <tr style={{ height: `${bottomPadding}px` }} aria-hidden="true">
                <td colSpan={5} className="p-0 border-0" />
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
};
