import React, { useRef, useState } from 'react';

interface SplitterHandleProps {
  direction: 'horizontal' | 'vertical'; // 'vertical' = separates columns (horizontal resize); 'horizontal' = separates rows (vertical resize)
  onResize: (delta: number) => void;
  onReset?: () => void;
  onToggleCollapse?: () => void;
  collapsed?: boolean;
  className?: string;
  label?: string;
}

export const SplitterHandle: React.FC<SplitterHandleProps> = ({
  direction,
  onResize,
  onReset,
  onToggleCollapse,
  collapsed = false,
  className = '',
  label,
}) => {
  const [isDragging, setIsDragging] = useState(false);
  const startPosRef = useRef<number>(0);

  const handlePointerDown = (e: React.PointerEvent<HTMLDivElement>) => {
    if (e.button !== 0) return;
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    startPosRef.current = direction === 'vertical' ? e.clientX : e.clientY;
  };

  const handlePointerMove = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const currentPos = direction === 'vertical' ? e.clientX : e.clientY;
    const delta = currentPos - startPosRef.current;
    if (delta !== 0) {
      onResize(delta);
      startPosRef.current = currentPos;
    }
  };

  const handlePointerUp = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  const isCol = direction === 'vertical';

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={isCol ? 'vertical' : 'horizontal'}
      title={label || (isCol ? '双击恢复默认宽度，拖动调整大小' : '双击恢复默认高度，拖动调整大小')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      className={`group relative select-none transition-colors duration-150 z-20 ${
        isCol
          ? 'w-1.5 hover:w-1.5 cursor-col-resize flex flex-col items-center justify-center'
          : 'h-1.5 hover:h-1.5 cursor-row-resize flex items-center justify-center'
      } ${
        isDragging
          ? 'bg-[#5b5ce6]'
          : 'bg-[#e2e8f0] dark:bg-[#2a3140] hover:bg-[#5b5ce6]/80'
      } ${className}`}
    >
      {/* Visual Grip dots / bar */}
      <div
        className={`pointer-events-none rounded-full transition-opacity ${
          isCol ? 'w-0.5 h-6' : 'h-0.5 w-6'
        } ${
          isDragging
            ? 'bg-white opacity-100'
            : 'bg-[#94a3b8] dark:bg-[#64748b] opacity-60 group-hover:opacity-100 group-hover:bg-white'
        }`}
      />

      {/* Collapse button overlay on hover if toggle supplied */}
      {onToggleCollapse && (
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onToggleCollapse();
          }}
          title={collapsed ? '展开面板' : '折叠面板'}
          className={`absolute opacity-0 group-hover:opacity-100 transition-opacity bg-[#1e293b] text-white dark:bg-[#222834] rounded p-0.5 text-[9px] shadow-sm z-30 ${
            isCol ? '-top-3 left-1/2 -translate-x-1/2' : '-left-3 top-1/2 -translate-y-1/2'
          }`}
        >
          {isCol ? (collapsed ? '▶' : '◀') : collapsed ? '▲' : '▼'}
        </button>
      )}
    </div>
  );
};
