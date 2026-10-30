import React from 'react';
import { useExplorer } from '../context/ExplorerContext';
import { getFileIcon } from './FileTree';
import { formatBytes } from '../data/mockFiles';
import { DesktopButton, DesktopCard } from '../../../theme/components';
import { Copy, Star, ZoomIn, ZoomOut, Maximize, FileText, Code2, Image } from 'lucide-react';

export const FileGalleryView: React.FC = () => {
  const { currentFolderFiles, selectedFile, selectFile, toggleStar } = useExplorer();
  const [zoomLevel, setZoomLevel] = React.useState<number>(100);

  const activeItem = selectedFile || currentFolderFiles[0];

  if (!activeItem) {
    return (
      <div className="flex items-center justify-center h-full text-xs text-[#5c5c5c] dark:text-[#a0a0a0]">
        暂无文件可供画廊浏览
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden bg-[#fbfbfb] dark:bg-[#1a1a1a] font-sans">
      {/* 1. Main Inspection Stage */}
      <div className="flex-1 flex flex-col items-center justify-center p-6 relative min-h-0 overflow-hidden">
        {/* Windows 11 Gallery Controls Overlay */}
        <div className="absolute top-4 right-4 flex items-center gap-1.5 z-10 bg-white/95 dark:bg-[#2b2b2b]/95 backdrop-blur-md p-1 rounded-lg border border-black/[0.08] dark:border-white/[0.08] shadow-[0_2px_8px_rgba(0,0,0,0.06)]">
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.max(50, z - 25))}
            className="p-1 text-[#5c5c5c] dark:text-[#a0a0a0] hover:text-[#0067c0] dark:hover:text-[#60cdff] rounded cursor-pointer transition-colors"
            title="缩小"
          >
            <ZoomOut className="w-3.5 h-3.5" />
          </button>
          <span className="text-[11px] font-mono tabular-nums px-1.5 text-[#5c5c5c] dark:text-[#a0a0a0]">
            {zoomLevel}%
          </span>
          <button
            type="button"
            onClick={() => setZoomLevel((z) => Math.min(200, z + 25))}
            className="p-1 text-[#5c5c5c] dark:text-[#a0a0a0] hover:text-[#0067c0] dark:hover:text-[#60cdff] rounded cursor-pointer transition-colors"
            title="放大"
          >
            <ZoomIn className="w-3.5 h-3.5" />
          </button>
          <div className="h-3 w-px bg-black/[0.1] dark:bg-white/[0.1] mx-0.5" />
          <button
            type="button"
            onClick={() => setZoomLevel(100)}
            className="p-1 text-[#5c5c5c] dark:text-[#a0a0a0] hover:text-[#0067c0] dark:hover:text-[#60cdff] rounded cursor-pointer transition-colors"
            title="重置缩放"
          >
            <Maximize className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Dynamic Canvas Preview */}
        <div className="flex-1 flex items-center justify-center w-full h-full overflow-hidden">
          {activeItem.thumbnail ? (
            <div
              style={{ transform: `scale(${zoomLevel / 100})` }}
              className="transition-transform duration-150 max-h-full max-w-full rounded-xl shadow-[0_8px_24px_rgba(0,0,0,0.12)] overflow-hidden border border-black/[0.08] dark:border-white/[0.08]"
            >
              <img
                src={activeItem.thumbnail}
                alt={activeItem.name}
                className="max-h-[380px] object-contain rounded-xl"
              />
            </div>
          ) : activeItem.contentPreview ? (
            <div
              style={{ transform: `scale(${zoomLevel / 100})` }}
              className="w-full max-w-xl max-h-[360px] overflow-auto p-4 rounded-xl bg-[#1e1e1e] text-[#d4d4d4] font-mono text-xs border border-black/20 dark:border-white/10 shadow-[0_8px_24px_rgba(0,0,0,0.2)]"
            >
              <div className="flex items-center justify-between pb-2 mb-2 border-b border-white/[0.08] text-[11px] text-[#8a8a8a]">
                <span className="flex items-center gap-1.5">
                  <Code2 className="w-3.5 h-3.5 text-[#60cdff]" />
                  {activeItem.name}
                </span>
                <span>{activeItem.lineCount || 0} 行代码</span>
              </div>
              <pre className="whitespace-pre-wrap leading-relaxed text-[#d4d4d4]">
                {activeItem.contentPreview}
              </pre>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-8 rounded-xl border border-dashed border-black/[0.12] dark:border-white/[0.12] bg-white/70 dark:bg-[#2b2b2b]/70 max-w-sm text-center shadow-xs">
              {getFileIcon(activeItem, 'w-14 h-14 mb-3')}
              <span className="font-semibold text-sm text-[#1b1b1b] dark:text-white">
                {activeItem.name}
              </span>
              <span className="text-xs text-[#5c5c5c] dark:text-[#a0a0a0] font-mono mt-1">
                {formatBytes(activeItem.size)} · {activeItem.modifiedAt}
              </span>
            </div>
          )}
        </div>

        {/* Caption Bar */}
        <div className="mt-2 flex items-center gap-2.5 text-xs text-[#5c5c5c] dark:text-[#a0a0a0]">
          <span className="font-semibold text-[#1b1b1b] dark:text-white">
            {activeItem.name}
          </span>
          <span>·</span>
          <span className="font-mono tabular-nums">{formatBytes(activeItem.size)}</span>
          {activeItem.dimensions && (
            <>
              <span>·</span>
              <span className="font-mono">{activeItem.dimensions}</span>
            </>
          )}
          <span>·</span>
          <span>{activeItem.modifiedAt}</span>
        </div>
      </div>

      {/* 2. Bottom Filmstrip Thumbnail Navigation */}
      <div className="h-20 bg-white/95 dark:bg-[#202020]/95 border-t border-black/[0.08] dark:border-white/[0.08] px-3 py-2 flex items-center gap-2 overflow-x-auto shrink-0 no-scrollbar">
        {currentFolderFiles.map((file) => {
          const isSelected = activeItem.id === file.id;

          return (
            <button
              key={`thumb-${file.id}`}
              type="button"
              onClick={() => selectFile(file)}
              className={`h-15 w-18 shrink-0 rounded-lg border flex flex-col items-center justify-center p-1 cursor-pointer transition-all ${
                isSelected
                  ? 'border-[#0067c0] dark:border-[#60cdff] bg-[#ebf3fc] dark:bg-[#1a3850]/50 ring-2 ring-[#0067c0]/30 shadow-xs'
                  : 'border-black/[0.06] dark:border-white/[0.06] bg-[#f9f9f9] dark:bg-[#282828] hover:border-black/[0.12]'
              }`}
            >
              {file.thumbnail ? (
                <img
                  src={file.thumbnail}
                  alt={file.name}
                  className="w-full h-8 object-cover rounded-md"
                />
              ) : (
                <div className="h-8 flex items-center justify-center">
                  {getFileIcon(file, 'w-6 h-6')}
                </div>
              )}
              <span className="text-[10px] font-sans truncate w-full text-center mt-1 text-[#1b1b1b] dark:text-[#e0e0e0]">
                {file.name}
              </span>
            </button>
          );
        })}
      </div>
    </div>
  );
};
