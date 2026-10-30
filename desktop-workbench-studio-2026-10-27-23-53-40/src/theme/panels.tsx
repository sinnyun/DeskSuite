import React, { useState, useRef, useEffect } from 'react';
import {
  ChevronDown,
  ChevronRight,
  ChevronLeft,
  X,
  Minus,
  Square,
  Maximize2,
  Minimize2,
  GripHorizontal,
} from 'lucide-react';

/* -------------------------------------------------------------------------- */
/* 1. ThemeActivityRail - 永久显示的折叠图标导轨 (Permanent Slim Plugin Rail)      */
/* -------------------------------------------------------------------------- */

export interface ActivityRailItem {
  id: string;
  label: string;
  icon: React.ReactNode;
  badge?: string | number;
  active?: boolean;
  tooltip?: string;
  onClick?: () => void;
}

export interface ThemeActivityRailProps {
  items: ActivityRailItem[];
  bottomItems?: ActivityRailItem[];
  className?: string;
}

export const ThemeActivityRail: React.FC<ThemeActivityRailProps> = ({
  items,
  bottomItems,
  className = '',
}) => {
  return (
    <nav
      aria-label="插件快捷导轨"
      className={`w-12 py-2.5 flex flex-col items-center justify-between border-r border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#13161d] shrink-0 select-none z-20 ${className}`}
    >
      {/* Top Plugin Icons Stream */}
      <div className="flex flex-col items-center gap-1.5 w-full px-1">
        {items.map((item) => {
          const isActive = !!item.active;
          return (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.tooltip || item.label}
              className={`relative group w-9 h-9 flex flex-col items-center justify-center rounded-xl transition-all cursor-pointer ${
                isActive
                  ? 'bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6] dark:text-[#7c7df6] shadow-2xs font-semibold'
                  : 'text-[#64748b] dark:text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#1a1e27]'
              }`}
            >
              <span className="shrink-0 transition-transform group-hover:scale-105">
                {item.icon}
              </span>
              <span className="text-[9px] scale-[0.8] leading-none mt-0.5 max-w-[34px] truncate">
                {item.label}
              </span>

              {/* Active Indicator Bar on Left */}
              {isActive && (
                <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[#5b5ce6] dark:bg-[#7c7df6]" />
              )}

              {/* Notification Badge */}
              {item.badge !== undefined && (
                <span className="absolute -top-1 -right-1 px-1 py-0.2 min-w-4 text-[9px] font-mono font-bold bg-[#5b5ce6] text-white rounded-full text-center shadow-xs">
                  {item.badge}
                </span>
              )}
            </button>
          );
        })}
      </div>

      {/* Bottom Fixed Plugin Icons */}
      {bottomItems && bottomItems.length > 0 && (
        <div className="flex flex-col items-center gap-1.5 w-full px-1 pt-2 border-t border-[#e2e8f0] dark:border-[#2a3140]">
          {bottomItems.map((item) => (
            <button
              key={item.id}
              type="button"
              onClick={item.onClick}
              title={item.tooltip || item.label}
              className="w-9 h-9 flex items-center justify-center rounded-xl text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white hover:bg-[#f1f5f9] dark:hover:bg-[#1a1e27] transition-colors cursor-pointer"
            >
              {item.icon}
            </button>
          ))}
        </div>
      )}
    </nav>
  );
};

/* -------------------------------------------------------------------------- */
/* 2. ThemeSidebarPanel - 通用侧边面板 (Collapsible Sidebar Panel Container)   */
/* -------------------------------------------------------------------------- */

export interface ThemeSidebarPanelProps {
  title?: string;
  tabs?: { id: string; title: string; icon?: React.ReactNode; badge?: string | number }[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  headerActions?: React.ReactNode;
  collapsed?: boolean;
  onToggleCollapse?: () => void;
  width?: number;
  side?: 'left' | 'right';
  className?: string;
  children: React.ReactNode;
  footer?: React.ReactNode;
}

export const ThemeSidebarPanel: React.FC<ThemeSidebarPanelProps> = ({
  title,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  collapsed = false,
  onToggleCollapse,
  width = 260,
  side = 'left',
  className = '',
  children,
  footer,
}) => {
  if (collapsed) {
    return null;
  }

  const borderClass =
    side === 'left'
      ? 'border-r border-[#e2e8f0] dark:border-[#2a3140]'
      : 'border-l border-[#e2e8f0] dark:border-[#2a3140]';

  return (
    <aside
      style={{ width: `${width}px` }}
      className={`h-full bg-white dark:bg-[#161922] ${borderClass} flex flex-col select-none shrink-0 overflow-hidden shadow-xs ${className}`}
    >
      {/* Header Bar */}
      <div className="flex items-center justify-between px-3 py-2 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#161922] shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabs && tabs.length > 0 ? (
            tabs.map((tab) => {
              const isActive = activeTab === tab.id;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => onTabChange?.(tab.id)}
                  className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer ${
                    isActive
                      ? 'bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6] dark:text-[#7c7df6] shadow-2xs border border-[#5b5ce6]/25'
                      : 'text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white'
                  }`}
                >
                  {tab.icon && <span className="w-3.5 h-3.5 shrink-0">{tab.icon}</span>}
                  <span className="truncate">{tab.title}</span>
                  {tab.badge !== undefined && (
                    <span className="px-1.5 py-0.2 text-[10px] font-mono rounded-full bg-black/[0.06] dark:bg-white/[0.1]">
                      {tab.badge}
                    </span>
                  )}
                </button>
              );
            })
          ) : (
            <span className="text-xs font-semibold text-[#1e293b] dark:text-white">
              {title}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {headerActions}
          {onToggleCollapse && (
            <button
              type="button"
              onClick={onToggleCollapse}
              title={side === 'left' ? '折叠左侧面板' : '折叠右侧面板'}
              className="p-1 rounded-lg text-[#94a3b8] hover:text-[#1e293b] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] transition-colors cursor-pointer"
            >
              {side === 'left' ? (
                <ChevronLeft className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          )}
        </div>
      </div>

      {/* Main Content Viewport */}
      <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-[#fafbfd] dark:bg-[#161922]">
        {children}
      </div>

      {/* Optional Footer */}
      {footer && (
        <div className="shrink-0 p-2 border-t border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#161922]">
          {footer}
        </div>
      )}
    </aside>
  );
};

/* -------------------------------------------------------------------------- */
/* 3. ThemeWorkspacePanel - 通用中间工作区面板 (Workspace Canvas Container)    */
/* -------------------------------------------------------------------------- */

export interface ThemeWorkspacePanelProps {
  toolbar?: React.ReactNode;
  children: React.ReactNode;
  className?: string;
}

export const ThemeWorkspacePanel: React.FC<ThemeWorkspacePanelProps> = ({
  toolbar,
  children,
  className = '',
}) => {
  return (
    <main className={`flex-1 flex flex-col min-w-0 h-full bg-[#f2f4f8] dark:bg-[#11141a] overflow-hidden select-none ${className}`}>
      {toolbar && (
        <div className="shrink-0 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-white/80 dark:bg-[#161922]/80 backdrop-blur-md px-3 py-2 z-10">
          {toolbar}
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0 relative">
        {children}
      </div>
    </main>
  );
};

/* -------------------------------------------------------------------------- */
/* 4. ThemeCollapsibleSection - 通用折叠卡片组件 (Accordion Section with guides)*/
/* -------------------------------------------------------------------------- */

export interface ThemeCollapsibleSectionProps {
  title: string;
  icon?: React.ReactNode;
  defaultOpen?: boolean;
  isOpen?: boolean;
  onToggle?: () => void;
  badge?: string | number;
  action?: React.ReactNode;
  hasDashedIndent?: boolean;
  className?: string;
  children: React.ReactNode;
}

export const ThemeCollapsibleSection: React.FC<ThemeCollapsibleSectionProps> = ({
  title,
  icon,
  defaultOpen = true,
  isOpen: controlledIsOpen,
  onToggle: controlledOnToggle,
  badge,
  action,
  hasDashedIndent = false,
  className = '',
  children,
}) => {
  const [internalOpen, setInternalOpen] = useState(defaultOpen);
  const isOpen = controlledIsOpen !== undefined ? controlledIsOpen : internalOpen;

  const handleToggle = () => {
    if (controlledOnToggle) {
      controlledOnToggle();
    } else {
      setInternalOpen(!internalOpen);
    }
  };

  return (
    <div className={`flex flex-col text-xs select-none ${className}`}>
      {/* Section Header */}
      <div
        onClick={handleToggle}
        className="flex items-center justify-between px-2 py-1.5 rounded-xl font-semibold text-[#475569] dark:text-[#94a3b8] cursor-pointer hover:bg-[#f1f5f9] dark:hover:bg-[#1f2430] hover:text-[#1e293b] transition-colors group"
      >
        <div className="flex items-center gap-1.5 truncate">
          {isOpen ? (
            <ChevronDown className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#5b5ce6]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[#94a3b8] group-hover:text-[#5b5ce6]" />
          )}
          {icon && <span className="shrink-0">{icon}</span>}
          <span className="truncate">{title}</span>
          {badge !== undefined && (
            <span className="font-mono text-[10px] text-[#94a3b8] bg-[#f1f5f9] dark:bg-[#222834] px-1.5 py-0.2 rounded-full">
              {badge}
            </span>
          )}
        </div>

        {action && (
          <div
            onClick={(e) => e.stopPropagation()}
            className="shrink-0 flex items-center"
          >
            {action}
          </div>
        )}
      </div>

      {/* Section Content */}
      {isOpen && (
        <div
          className={`mt-1 flex flex-col gap-1 ${
            hasDashedIndent
              ? 'relative ml-4 pl-3.5 border-l border-dashed border-[#cbd5e1] dark:border-[#475569]'
              : ''
          }`}
        >
          {children}
        </div>
      )}
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* 5. ThemeFloatingPanel - 通用可拖动调整大小的悬浮面板 (Universal Floating Panel) */
/* -------------------------------------------------------------------------- */

export interface ThemeFloatingPanelProps {
  id?: string;
  title: string;
  icon?: React.ReactNode;
  badge?: string;
  isOpen: boolean;
  onClose: () => void;
  initialX?: number;
  initialY?: number;
  initialWidth?: number;
  initialHeight?: number;
  minWidth?: number;
  minHeight?: number;
  tabs?: { id: string; label: string; icon?: React.ReactNode }[];
  activeTab?: string;
  onTabChange?: (tabId: string) => void;
  headerActions?: React.ReactNode;
  className?: string;
  children: React.ReactNode;
}

export const ThemeFloatingPanel: React.FC<ThemeFloatingPanelProps> = ({
  title,
  icon,
  badge,
  isOpen,
  onClose,
  initialX = 140,
  initialY = 75,
  initialWidth = 520,
  initialHeight = 440,
  minWidth = 340,
  minHeight = 260,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  className = '',
  children,
}) => {
  const [position, setPosition] = useState({ x: initialX, y: initialY });
  const [size, setSize] = useState({ width: initialWidth, height: initialHeight });
  const [isMaximized, setIsMaximized] = useState(false);
  const [isDragging, setIsDragging] = useState(false);
  const [isResizing, setIsResizing] = useState(false);

  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 });
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 });

  // Dragging logic
  const handlePointerDownDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    if (e.button !== 0) return;
    // Don't drag if clicking buttons or inputs inside header
    if ((e.target as HTMLElement).closest('button, input, [role="button"]')) return;

    e.currentTarget.setPointerCapture(e.pointerId);
    setIsDragging(true);
    dragStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      posX: position.x,
      posY: position.y,
    };
  };

  const handlePointerMoveDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isDragging) return;
    const dx = e.clientX - dragStartRef.current.x;
    const dy = e.clientY - dragStartRef.current.y;

    const newX = Math.max(10, Math.min(window.innerWidth - 80, dragStartRef.current.posX + dx));
    const newY = Math.max(10, Math.min(window.innerHeight - 80, dragStartRef.current.posY + dy));
    setPosition({ x: newX, y: newY });
  };

  const handlePointerUpDrag = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isDragging) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsDragging(false);
    }
  };

  // Resizing logic
  const handlePointerDownResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isMaximized) return;
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    setIsResizing(true);
    resizeStartRef.current = {
      x: e.clientX,
      y: e.clientY,
      width: size.width,
      height: size.height,
    };
  };

  const handlePointerMoveResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (!isResizing) return;
    const dw = e.clientX - resizeStartRef.current.x;
    const dh = e.clientY - resizeStartRef.current.y;

    const newWidth = Math.max(minWidth, Math.min(window.innerWidth - position.x - 20, resizeStartRef.current.width + dw));
    const newHeight = Math.max(minHeight, Math.min(window.innerHeight - position.y - 20, resizeStartRef.current.height + dh));
    setSize({ width: newWidth, height: newHeight });
  };

  const handlePointerUpResize = (e: React.PointerEvent<HTMLDivElement>) => {
    if (isResizing) {
      try {
        e.currentTarget.releasePointerCapture(e.pointerId);
      } catch {
        // ignore
      }
      setIsResizing(false);
    }
  };

  if (!isOpen) return null;

  const panelStyle = isMaximized
    ? { top: '48px', left: '48px', right: '10px', bottom: '32px', width: 'auto', height: 'auto' }
    : { top: `${position.y}px`, left: `${position.x}px`, width: `${size.width}px`, height: `${size.height}px` };

  return (
    <div
      style={panelStyle}
      className={`fixed z-50 flex flex-col rounded-2xl bg-white/95 dark:bg-[#161922]/95 backdrop-blur-xl border border-[#e2e8f0] dark:border-[#2a3140] shadow-2xl overflow-hidden select-none animate-in fade-in zoom-in-95 duration-150 ${className}`}
    >
      {/* Title Bar (Draggable Area) */}
      <div
        onPointerDown={handlePointerDownDrag}
        onPointerMove={handlePointerMoveDrag}
        onPointerUp={handlePointerUpDrag}
        className="h-10 px-3.5 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] flex items-center justify-between cursor-move shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-[#94a3b8] opacity-60" />
          {icon && <span className="text-[#5b5ce6] shrink-0">{icon}</span>}
          <span className="font-bold text-xs text-[#1e293b] dark:text-white truncate">
            {title}
          </span>
          {badge && (
            <span className="px-2 py-0.5 rounded-full text-[10px] font-semibold bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6] border border-[#5b5ce6]/20">
              {badge}
            </span>
          )}
        </div>

        {/* Header Actions & Window Controls */}
        <div className="flex items-center gap-1.5 shrink-0">
          {headerActions}

          <button
            type="button"
            onClick={() => setIsMaximized(!isMaximized)}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-[#64748b] hover:text-[#1e293b] hover:bg-black/[0.05] dark:hover:bg-white/[0.08] transition-colors cursor-pointer"
            title={isMaximized ? '还原窗口' : '最大化窗口'}
          >
            {isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />}
          </button>

          <button
            type="button"
            onClick={onClose}
            className="w-6 h-6 flex items-center justify-center rounded-lg text-[#64748b] hover:text-white hover:bg-rose-500 transition-colors cursor-pointer"
            title="关闭悬浮面板"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Tabs Strip (if provided) */}
      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#161922] overflow-x-auto no-scrollbar shrink-0">
          {tabs.map((tab) => {
            const isActive = activeTab === tab.id;
            return (
              <button
                key={tab.id}
                type="button"
                onClick={() => onTabChange?.(tab.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs font-semibold transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#5b5ce6] text-white shadow-2xs'
                    : 'text-[#64748b] hover:text-[#1e293b] hover:bg-[#f1f5f9] dark:hover:bg-[#222834]'
                }`}
              >
                {tab.icon}
                <span>{tab.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Main Body Content */}
      <div className="flex-1 overflow-auto min-h-0 relative p-3">
        {children}
      </div>

      {/* Bottom Resize Handle */}
      {!isMaximized && (
        <div
          onPointerDown={handlePointerDownResize}
          onPointerMove={handlePointerMoveResize}
          onPointerUp={handlePointerUpResize}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 text-[#94a3b8] hover:text-[#5b5ce6]"
          title="拖动调整面板大小"
        >
          <svg className="w-3 h-3 fill-current opacity-60" viewBox="0 0 10 10">
            <path d="M9 1L1 9M9 5L5 9M9 9L9 9" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </div>
      )}
    </div>
  );
};
