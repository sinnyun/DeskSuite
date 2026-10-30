import React, { useState } from 'react';
import {
  Sun,
  Moon,
  ChevronDown,
  SlidersHorizontal,
  Minus,
  Square,
  X,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  PanelBottomClose,
  PanelBottomOpen,
  RotateCcw,
  Layers,
  FolderOpen,
  AppWindow,
  HelpCircle,
  Sparkles,
} from 'lucide-react';
import { useTheme } from '../../theme/ThemeContext';
import { useLayout } from '../../core/LayoutContext';
import { SlotRenderer } from '../../core/SlotRegistry';
import { DesktopIconButton } from '../../theme/components';

export const TopBar: React.FC = () => {
  const { isDark, setMode } = useTheme();
  const {
    leftCollapsed,
    toggleLeftCollapsed,
    rightCollapsed,
    toggleRightCollapsed,
    bottomCollapsed,
    toggleBottomCollapsed,
    zenMode,
    toggleZenMode,
    resetLayout,
    floatingPanelOpen,
    toggleFloatingPanel,
    openFloatingPanel,
  } = useLayout();

  const [activeMenu, setActiveMenu] = useState<string | null>(null);

  const menus = [
    {
      id: 'file',
      label: '文件(F)',
      items: [
        { label: '打开工作区目录...', shortcut: 'Ctrl+O', action: () => {} },
        { label: '新建文件暂存篮', shortcut: 'Ctrl+N', action: () => openFloatingPanel('basket') },
        { label: '导出项目元数据...', shortcut: 'Ctrl+E', action: () => openFloatingPanel('analytics') },
        { divider: true },
        { label: '重新载入当前工程', shortcut: 'Ctrl+R', action: () => window.location.reload() },
      ],
    },
    {
      id: 'edit',
      label: '编辑(E)',
      items: [
        { label: '打开剪贴板工作台', shortcut: 'Ctrl+Shift+V', action: () => openFloatingPanel('clipboard') },
        { label: '撤销上一步操作', shortcut: 'Ctrl+Z', action: () => {} },
        { label: '重做操作', shortcut: 'Ctrl+Y', action: () => {} },
        { divider: true },
        { label: '偏好与系统设置', shortcut: 'Ctrl+,', action: () => openFloatingPanel('database') },
      ],
    },
    {
      id: 'view',
      label: '视图(V)',
      items: [
        { label: leftCollapsed ? '展开左侧工程栏' : '折叠左侧工程栏', shortcut: 'Ctrl+B', action: toggleLeftCollapsed },
        { label: rightCollapsed ? '展开右侧属性面板' : '折叠右侧属性面板', shortcut: 'Ctrl+Shift+B', action: toggleRightCollapsed },
        { label: bottomCollapsed ? '展开底部调试控制台' : '折叠底部控制台', shortcut: 'Ctrl+`', action: toggleBottomCollapsed },
        { divider: true },
        { label: zenMode ? '退出全屏禅模式' : '进入全屏禅模式', shortcut: 'F11', action: toggleZenMode },
        { label: '重置所有框架到默认布局', shortcut: 'Ctrl+Alt+R', action: resetLayout },
      ],
    },
    {
      id: 'plugins',
      label: '插件(P)',
      items: [
        { label: '通用悬浮工作台', shortcut: 'Alt+W', action: () => toggleFloatingPanel() },
        { label: '资产统计分析插件', shortcut: 'Alt+1', action: () => openFloatingPanel('analytics') },
        { label: '文件暂存篮插件', shortcut: 'Alt+2', action: () => openFloatingPanel('basket') },
        { label: '剪贴板工作台插件', shortcut: 'Alt+3', action: () => openFloatingPanel('clipboard') },
        { label: '扩展插件市场...', shortcut: 'Alt+M', action: () => openFloatingPanel('market') },
        { divider: true },
        { label: '本地插件注册槽管理器', shortcut: 'Alt+S', action: () => {} },
      ],
    },
    {
      id: 'help',
      label: '帮助(H)',
      items: [
        { label: '快捷键与操作指南', shortcut: 'F1', action: () => {} },
        { label: '插件化架构与托槽开发规范', action: () => {} },
        { divider: true },
        { label: '关于 FileAtlas 桌面工作台 (v2.4.0)', action: () => {} },
      ],
    },
  ];

  return (
    <header className="h-11 w-full bg-white dark:bg-[#161922] border-b border-[#e2e8f0] dark:border-[#2a3140] flex items-center justify-between px-3 gap-2 select-none z-30 shrink-0 shadow-xs">
      {/* Zone 1: FileAtlas Brand Logo + Desktop Native Menus */}
      <div className="flex items-center gap-2 min-w-0">
        {/* Brand Icon */}
        <div className="flex items-center gap-2 shrink-0 pr-1">
          <div className="w-7 h-7 rounded-lg bg-[#5b5ce6] flex items-center justify-center text-white shadow-xs">
            <svg
              className="w-4 h-4 fill-none stroke-current stroke-2"
              viewBox="0 0 24 24"
              strokeLinecap="round"
              strokeLinejoin="round"
            >
              <polygon points="12 2 2 7 12 12 22 7 12 2" />
              <polyline points="2 17 12 22 22 17" />
              <polyline points="2 12 12 17 22 12" />
            </svg>
          </div>
          <span className="font-bold text-sm tracking-tight text-[#1e293b] dark:text-white">
            FileAtlas
          </span>
        </div>

        <div className="h-4 w-px bg-[#e2e8f0] dark:bg-[#2a3140] shrink-0" />

        {/* Application Menus (文件, 编辑, 视图, 插件, 帮助) */}
        <nav className="flex items-center gap-0.5">
          {menus.map((menu) => (
            <div key={menu.id} className="relative">
              <button
                type="button"
                onClick={() => setActiveMenu(activeMenu === menu.id ? null : menu.id)}
                onMouseEnter={() => {
                  if (activeMenu !== null) setActiveMenu(menu.id);
                }}
                className={`px-2.5 py-1 rounded-md text-xs font-medium transition-colors cursor-pointer ${
                  activeMenu === menu.id
                    ? 'bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6]'
                    : 'text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#222834]'
                }`}
              >
                {menu.label}
              </button>

              {activeMenu === menu.id && (
                <div
                  onMouseLeave={() => setActiveMenu(null)}
                  className="absolute left-0 top-full mt-1 w-56 rounded-xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-xl p-1 z-50 divide-y divide-[#f1f5f9] dark:divide-[#252b38]"
                >
                  <div className="py-0.5">
                    {menu.items.map((item, idx) => {
                      if ('divider' in item && item.divider) {
                        return <div key={idx} className="my-1 border-t border-[#f1f5f9] dark:border-[#252b38]" />;
                      }
                      return (
                        <button
                          key={idx}
                          type="button"
                          onClick={() => {
                            if ('action' in item && item.action) item.action();
                            setActiveMenu(null);
                          }}
                          className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg text-xs text-[#1e293b] dark:text-[#cbd5e1] hover:bg-[#eef2ff] hover:text-[#5b5ce6] dark:hover:bg-[#252846] dark:hover:text-[#7c7df6] transition-colors cursor-pointer"
                        >
                          <span>{item.label}</span>
                          {'shortcut' in item && item.shortcut && (
                            <span className="text-[10px] text-[#94a3b8] font-mono">{item.shortcut}</span>
                          )}
                        </button>
                      );
                    })}
                  </div>
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      {/* Zone 2: Registered App Action Slots */}
      <div className="flex items-center gap-1.5 min-w-0">
        <SlotRenderer slotId="top.actions" className="flex items-center gap-1.5" />
      </div>

      {/* Zone 3: App Operations, Floating Panel, Layout Docks & Window Controls */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Universal Floating Panel Button */}
        <button
          type="button"
          onClick={() => toggleFloatingPanel()}
          title={floatingPanelOpen ? '关闭通用悬浮面板' : '打开通用悬浮工作台 (可拖动、缩放、切换插件)'}
          className={`flex items-center gap-1.5 px-3 py-1 rounded-xl text-xs font-semibold border transition-all cursor-pointer ${
            floatingPanelOpen
              ? 'bg-[#5b5ce6] text-white border-[#5b5ce6] shadow-xs'
              : 'bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6] dark:text-[#7c7df6] border-[#5b5ce6]/25 hover:bg-[#5b5ce6] hover:text-white'
          }`}
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>悬浮面板</span>
        </button>

        {/* Reset Layout */}
        <button
          type="button"
          onClick={resetLayout}
          title="重置窗口布局"
          className="p-1.5 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white shadow-2xs cursor-pointer"
        >
          <RotateCcw className="w-3.5 h-3.5" />
        </button>

        {/* Layout Frame Toggles */}
        <div className="flex items-center bg-[#f1f5f9] dark:bg-[#222834] p-0.5 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140]">
          <DesktopIconButton
            size="xs"
            active={!leftCollapsed}
            onClick={toggleLeftCollapsed}
            tooltip={leftCollapsed ? '展开左侧栏' : '折叠左侧栏'}
            icon={leftCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          />
          <DesktopIconButton
            size="xs"
            active={!bottomCollapsed}
            onClick={toggleBottomCollapsed}
            tooltip={bottomCollapsed ? '展开底部控制台' : '折叠底部控制台'}
            icon={bottomCollapsed ? <PanelBottomOpen className="w-3.5 h-3.5" /> : <PanelBottomClose className="w-3.5 h-3.5" />}
          />
          <DesktopIconButton
            size="xs"
            active={!rightCollapsed}
            onClick={toggleRightCollapsed}
            tooltip={rightCollapsed ? '展开右侧信息栏' : '折叠右侧信息栏'}
            icon={rightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
          />
        </div>

        {/* Theme Toggle */}
        <button
          type="button"
          onClick={() => setMode(isDark ? 'light' : 'dark')}
          title="切换深浅主题"
          className="p-1.5 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white shadow-2xs cursor-pointer"
        >
          {isDark ? <Sun className="w-3.5 h-3.5 text-amber-400" /> : <Moon className="w-3.5 h-3.5 text-[#5b5ce6]" />}
        </button>

        <div className="h-4 w-px bg-[#e2e8f0] dark:bg-[#2a3140] shrink-0" />

        {/* Window Caption Buttons */}
        <div className="flex items-center shrink-0">
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-[#64748b] hover:text-[#1e293b] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] rounded-lg transition-colors cursor-pointer"
            title="最小化"
          >
            <Minus className="w-3 h-3" />
          </button>
          <button
            type="button"
            onClick={toggleZenMode}
            className="w-7 h-7 flex items-center justify-center text-[#64748b] hover:text-[#1e293b] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] rounded-lg transition-colors cursor-pointer"
            title={zenMode ? '还原窗口' : '最大化窗口'}
          >
            <Square className="w-2.5 h-2.5" />
          </button>
          <button
            type="button"
            className="w-7 h-7 flex items-center justify-center text-[#64748b] hover:text-white hover:bg-rose-500 rounded-lg transition-colors cursor-pointer"
            title="关闭窗口"
          >
            <X className="w-3 h-3" />
          </button>
        </div>
      </div>
    </header>
  );
};
