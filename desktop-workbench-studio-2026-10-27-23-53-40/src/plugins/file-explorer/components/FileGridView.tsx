import React, { useMemo } from 'react';
import { useExplorer } from '../context/ExplorerContext';
import { getFileIcon } from './FileTree';
import { formatBytes } from '../data/mockFiles';
import { Star, Folder, ChevronDown, Zap } from 'lucide-react';
import { DesktopCard, DesktopTagPill } from '../../../theme/components';
import { useVirtualizer } from '../../../core/useVirtualizer';

export const FileGridView: React.FC = () => {
  const {
    currentFolderFiles,
    selectedFileIds,
    selectFile,
    navigateToFolder,
    toggleStar,
    virtualizationEnabled,
    datasetMode,
  } = useExplorer();

  // Folder quick cards for top row (matching FileAtlas screenshot)
  const quickFolders = [
    { id: 'qf-dev', name: '.dev-support', path: '/.dev-support', active: false },
    { id: 'qf-01', name: '01-small', path: '/01-small', active: true },
    { id: 'qf-02', name: '02-mixed-formats', path: '/02-mixed-formats', active: false },
    { id: 'qf-03', name: '03-nested', path: '/03-nested', active: false },
    { id: 'qf-04', name: '04-no-thumbnail', path: '/04-no-thumbnail', active: false },
  ];

  // Grid chunking for virtual row rendering
  const COLUMNS = 4;
  const ROW_HEIGHT = 240;

  const chunkedRows = useMemo(() => {
    const rows = [];
    for (let i = 0; i < currentFolderFiles.length; i += COLUMNS) {
      rows.push(currentFolderFiles.slice(i, i + COLUMNS));
    }
    return rows;
  }, [currentFolderFiles, COLUMNS]);

  const {
    containerRef,
    virtualItems,
    startIndex,
    endIndex,
    isVirtualActive,
    visibleCount,
    domReductionRatio,
  } = useVirtualizer({
    count: chunkedRows.length,
    itemHeight: ROW_HEIGHT,
    overscan: 3,
    enabled: virtualizationEnabled,
  });

  const getPillVariant = (
    tag: string
  ): 'blue' | 'purple' | 'amber' | 'emerald' | 'rose' | 'neutral' => {
    const t = tag.toLowerCase();
    if (t.includes('投放') || t.includes('渠道') || t.includes('react') || t.includes('code')) return 'blue';
    if (t.includes('设计') || t.includes('资产') || t.includes('ui') || t.includes('brand')) return 'purple';
    if (t.includes('主视觉') || t.includes('背景') || t.includes('theme') || t.includes('banner')) return 'amber';
    if (t.includes('文档') || t.includes('规范') || t.includes('readme')) return 'emerald';
    return 'neutral';
  };

  const topPadding = isVirtualActive ? startIndex * ROW_HEIGHT : 0;
  const bottomPadding = isVirtualActive
    ? Math.max(0, (chunkedRows.length - endIndex) * ROW_HEIGHT)
    : 0;

  return (
    <div className="w-full h-full flex flex-col min-h-0 select-none bg-[#f2f4f8] dark:bg-[#11141a]">
      {/* Virtualization Performance Banner */}
      {isVirtualActive && (
        <div className="shrink-0 px-4 py-1.5 bg-[#eef2ff] dark:bg-[#252846] border-b border-[#5b5ce6]/20 flex items-center justify-between text-xs text-[#5b5ce6] dark:text-[#7c7df6] font-mono">
          <div className="flex items-center gap-1.5">
            <Zap className="w-3.5 h-3.5 text-[#5b5ce6] shrink-0" />
            <span className="font-semibold">轻质感卡片虚拟行优化已启用</span>
            <span className="opacity-40">·</span>
            <span>总计 {currentFolderFiles.length} 项</span>
            <span className="opacity-40">·</span>
            <span>仅挂载 {visibleCount * COLUMNS} 卡片 (DOM 节省 {domReductionRatio}%)</span>
          </div>
          <span className="text-[10px] opacity-80 hidden sm:inline">
            60 FPS 平滑滚动
          </span>
        </div>
      )}

      {/* Main Scrollable Canvas */}
      <div ref={containerRef} className="flex-1 overflow-auto min-h-0 p-4 space-y-6">
        {/* 1. FileAtlas Top Quick Folder Cards Row */}
        {datasetMode === 'default' && (
          <div className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-5 gap-3.5">
            {quickFolders.map((f) => (
              <div
                key={f.id}
                onClick={() => {
                  const target = currentFolderFiles.find((item) => item.name === f.name);
                  if (target) navigateToFolder(target);
                }}
                className={`group flex flex-col items-center justify-center p-4 rounded-2xl bg-white dark:bg-[#1a1e27] border transition-all cursor-pointer shadow-xs hover:shadow-md hover:-translate-y-0.5 ${
                  f.active
                    ? 'border-[#5b5ce6] ring-2 ring-[#5b5ce6]/25 dark:border-[#7c7df6]'
                    : 'border-[#e2e8f0] dark:border-[#2a3140] hover:border-[#5b5ce6]/50'
                }`}
              >
                <div className="w-12 h-10 flex items-center justify-center text-[#f59e0b] mb-2 group-hover:scale-105 transition-transform">
                  <svg
                    className="w-10 h-8 fill-none stroke-[#f59e0b] stroke-[1.8]"
                    viewBox="0 0 24 24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                </div>
                <span className="text-xs font-semibold text-[#1e293b] dark:text-white truncate max-w-full text-center">
                  {f.name}
                </span>
              </div>
            ))}
          </div>
        )}

        {/* 2. FileAtlas Section Groups (e.g. 当前文件夹 · 1 项, .dev-support · 1 项) */}
        <div className="space-y-4">
          {/* Section Header */}
          <div className="flex items-center gap-1.5 text-xs font-semibold text-[#475569] dark:text-[#94a3b8] pt-1">
            <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8]" />
            <span>当前文件夹</span>
            <span className="text-[#94a3b8]">·</span>
            <span className="text-[#94a3b8] font-normal">{currentFolderFiles.length} 项</span>
          </div>

          {/* Virtual Rows or Normal Grid */}
          {topPadding > 0 && <div style={{ height: `${topPadding}px` }} aria-hidden="true" />}

          <div className="flex flex-col gap-4">
            {virtualItems.map(({ index }) => {
              const rowFiles = chunkedRows[index];
              if (!rowFiles) return null;

              return (
                <div
                  key={`grid-row-${index}`}
                  style={{ minHeight: `${ROW_HEIGHT - 16}px` }}
                  className="grid grid-cols-2 sm:grid-cols-3 md:grid-cols-4 gap-4"
                >
                  {rowFiles.map((file) => {
                    const isSelected = selectedFileIds.includes(file.id);
                    const isFolder = file.type === 'folder';

                    // Default FileAtlas demo tags with dot
                    const tags =
                      file.tags && file.tags.length > 0
                        ? file.tags
                        : ['投放渠道', '设计资产'];

                    const ext = (file.extension || (isFolder ? 'DIR' : 'FILE')).toUpperCase();

                    return (
                      <DesktopCard
                        key={file.id}
                        selected={isSelected}
                        interactive
                        onClick={(e) => selectFile(file, e.metaKey || e.ctrlKey)}
                        onDoubleClick={() => {
                          if (isFolder) navigateToFolder(file);
                        }}
                        className="group relative flex flex-col p-3.5 gap-2.5 transition-all"
                      >
                        {/* Thumbnail / Icon Container with Extension Pill Badge */}
                        <div className="relative w-full h-28 rounded-xl bg-[#f8fafc] dark:bg-[#151821] flex items-center justify-center overflow-hidden border border-[#edf2f7] dark:border-[#222834]">
                          {/* File extension badge in top right (TXT, PNG, etc.) */}
                          <span className="absolute top-2 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono font-bold bg-white/90 dark:bg-black/60 text-[#475569] dark:text-[#cbd5e1] shadow-2xs border border-[#e2e8f0]/60 dark:border-white/10">
                            {ext}
                          </span>

                          {file.thumbnail ? (
                            <img
                              src={file.thumbnail}
                              alt={file.name}
                              className="w-full h-full object-cover group-hover:scale-105 transition-transform duration-300"
                            />
                          ) : isFolder ? (
                            <div className="w-12 h-10 flex items-center justify-center text-[#f59e0b] group-hover:scale-110 transition-transform">
                              <svg
                                className="w-10 h-8 fill-[#fffbeb] stroke-[#f59e0b] stroke-[1.8]"
                                viewBox="0 0 24 24"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                              </svg>
                            </div>
                          ) : (
                            <div className="p-3 text-[#94a3b8] group-hover:scale-110 transition-transform">
                              <svg
                                className="w-10 h-10 stroke-current stroke-[1.5] fill-none"
                                viewBox="0 0 24 24"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
                                <polyline points="14 2 14 8 20 8" />
                                <line x1="16" y1="13" x2="8" y2="13" />
                                <line x1="16" y1="17" x2="8" y2="17" />
                                <polyline points="10 9 9 9 8 9" />
                              </svg>
                            </div>
                          )}
                        </div>

                        {/* Title & Size Metadata */}
                        <div className="flex flex-col min-w-0">
                          <span className="text-xs font-semibold text-[#1e293b] dark:text-white truncate group-hover:text-[#5b5ce6] transition-colors">
                            {file.name}
                          </span>
                          <span className="text-[10px] text-[#94a3b8] font-mono mt-0.5 tabular-nums">
                            {file.dimensions || (isFolder ? `${file.children?.length || 0} 项` : formatBytes(file.size))}
                          </span>
                        </div>

                        {/* FileAtlas Tag Capsules (• 投放渠道, • 设计资产) */}
                        <div className="flex items-center gap-1.5 flex-wrap pt-1">
                          {tags.slice(0, 3).map((tag) => (
                            <DesktopTagPill
                              key={tag}
                              label={tag}
                              variant={getPillVariant(tag)}
                            />
                          ))}
                        </div>

                        {/* Favorite Star */}
                        <button
                          type="button"
                          onClick={(e) => {
                            e.stopPropagation();
                            toggleStar(file.id);
                          }}
                          title={file.isFavorite ? '取消收藏' : '添加收藏'}
                          className="absolute top-3 left-3 p-1 rounded-full bg-white/90 dark:bg-black/60 opacity-0 group-hover:opacity-100 transition-opacity hover:text-amber-500 cursor-pointer shadow-xs"
                        >
                          <Star
                            className={`w-3.5 h-3.5 ${
                              file.isFavorite ? 'text-amber-500 fill-amber-500 opacity-100' : 'text-[#94a3b8]'
                            }`}
                          />
                        </button>
                      </DesktopCard>
                    );
                  })}
                </div>
              );
            })}
          </div>

          {bottomPadding > 0 && <div style={{ height: `${bottomPadding}px` }} aria-hidden="true" />}
        </div>
      </div>
    </div>
  );
};
