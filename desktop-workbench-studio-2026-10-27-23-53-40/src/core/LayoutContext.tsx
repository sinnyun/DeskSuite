import React, { createContext, useContext, useEffect, useState } from 'react';
import { LayoutState } from '../types/workbench';

interface LayoutContextType extends LayoutState {
  setLeftWidth: (width: number | ((prev: number) => number)) => void;
  setRightWidth: (width: number | ((prev: number) => number)) => void;
  setBottomHeight: (height: number | ((prev: number) => number)) => void;
  setLeftCollapsed: (collapsed: boolean) => void;
  toggleLeftCollapsed: () => void;
  setRightCollapsed: (collapsed: boolean) => void;
  toggleRightCollapsed: () => void;
  setBottomCollapsed: (collapsed: boolean) => void;
  toggleBottomCollapsed: () => void;
  setActiveLeftTab: (tabId: string) => void;
  setActiveRightTab: (tabId: string) => void;
  setActiveBottomTab: (tabId: string) => void;
  setActiveWorkspaceView: (viewId: string) => void;
  toggleZenMode: () => void;
  applyPreset: (preset: 'default' | 'developer' | 'inspect' | 'zen') => void;
  resetLayout: () => void;

  // Floating Panel Controls
  floatingPanelOpen: boolean;
  floatingPanelTab: string;
  openFloatingPanel: (tab?: string) => void;
  closeFloatingPanel: () => void;
  toggleFloatingPanel: (tab?: string) => void;
  setFloatingPanelTab: (tab: string) => void;
}

const DEFAULT_LAYOUT: LayoutState = {
  leftWidth: 260,
  rightWidth: 310,
  bottomHeight: 210,
  leftCollapsed: false,
  rightCollapsed: false,
  bottomCollapsed: false,
  activeLeftTab: 'files',
  activeRightTab: 'inspector',
  activeBottomTab: 'console',
  activeWorkspaceView: 'grid',
  zenMode: false,
  floatingPanelOpen: false,
  floatingPanelTab: 'clipboard',
};

const LayoutContext = createContext<LayoutContextType | undefined>(undefined);

export const LayoutProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [layout, setLayout] = useState<LayoutState>(() => {
    try {
      const saved = localStorage.getItem('desktop_wb_layout');
      if (saved) {
        return { ...DEFAULT_LAYOUT, ...JSON.parse(saved) };
      }
    } catch {
      // ignore
    }
    return DEFAULT_LAYOUT;
  });

  const [floatingPanelOpen, setFloatingPanelOpen] = useState<boolean>(false);
  const [floatingPanelTab, setFloatingPanelTabState] = useState<string>('clipboard');

  useEffect(() => {
    try {
      localStorage.setItem('desktop_wb_layout', JSON.stringify(layout));
    } catch {
      // ignore
    }
  }, [layout]);

  const setLeftWidth = (width: number | ((prev: number) => number)) => {
    setLayout((prev) => {
      const nextVal = typeof width === 'function' ? width(prev.leftWidth) : width;
      const clamped = Math.max(180, Math.min(500, nextVal));
      return { ...prev, leftWidth: clamped };
    });
  };

  const setRightWidth = (width: number | ((prev: number) => number)) => {
    setLayout((prev) => {
      const nextVal = typeof width === 'function' ? width(prev.rightWidth) : width;
      const clamped = Math.max(220, Math.min(560, nextVal));
      return { ...prev, rightWidth: clamped };
    });
  };

  const setBottomHeight = (height: number | ((prev: number) => number)) => {
    setLayout((prev) => {
      const nextVal = typeof height === 'function' ? height(prev.bottomHeight) : height;
      const clamped = Math.max(120, Math.min(520, nextVal));
      return { ...prev, bottomHeight: clamped };
    });
  };

  const setLeftCollapsed = (collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, leftCollapsed: collapsed }));
  };

  const toggleLeftCollapsed = () => {
    setLayout((prev) => ({ ...prev, leftCollapsed: !prev.leftCollapsed }));
  };

  const setRightCollapsed = (collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, rightCollapsed: collapsed }));
  };

  const toggleRightCollapsed = () => {
    setLayout((prev) => ({ ...prev, rightCollapsed: !prev.rightCollapsed }));
  };

  const setBottomCollapsed = (collapsed: boolean) => {
    setLayout((prev) => ({ ...prev, bottomCollapsed: collapsed }));
  };

  const toggleBottomCollapsed = () => {
    setLayout((prev) => ({ ...prev, bottomCollapsed: !prev.bottomCollapsed }));
  };

  const setActiveLeftTab = (tabId: string) => {
    setLayout((prev) => ({ ...prev, activeLeftTab: tabId, leftCollapsed: false }));
  };

  const setActiveRightTab = (tabId: string) => {
    setLayout((prev) => ({ ...prev, activeRightTab: tabId, rightCollapsed: false }));
  };

  const setActiveBottomTab = (tabId: string) => {
    setLayout((prev) => ({ ...prev, activeBottomTab: tabId, bottomCollapsed: false }));
  };

  const setActiveWorkspaceView = (viewId: string) => {
    setLayout((prev) => ({ ...prev, activeWorkspaceView: viewId }));
  };

  const openFloatingPanel = (tab?: string) => {
    if (tab) setFloatingPanelTabState(tab);
    setFloatingPanelOpen(true);
  };

  const closeFloatingPanel = () => {
    setFloatingPanelOpen(false);
  };

  const toggleFloatingPanel = (tab?: string) => {
    if (floatingPanelOpen && (!tab || tab === floatingPanelTab)) {
      setFloatingPanelOpen(false);
    } else {
      if (tab) setFloatingPanelTabState(tab);
      setFloatingPanelOpen(true);
    }
  };

  const setFloatingPanelTab = (tab: string) => {
    setFloatingPanelTabState(tab);
  };

  const toggleZenMode = () => {
    setLayout((prev) => {
      const nextZen = !prev.zenMode;
      return {
        ...prev,
        zenMode: nextZen,
        leftCollapsed: nextZen,
        rightCollapsed: nextZen,
        bottomCollapsed: nextZen,
      };
    });
  };

  const applyPreset = (preset: 'default' | 'developer' | 'inspect' | 'zen') => {
    if (preset === 'zen') {
      setLayout((prev) => ({
        ...prev,
        zenMode: true,
        leftCollapsed: true,
        rightCollapsed: true,
        bottomCollapsed: true,
      }));
    } else if (preset === 'developer') {
      setLayout((prev) => ({
        ...prev,
        zenMode: false,
        leftCollapsed: false,
        leftWidth: 240,
        rightCollapsed: true,
        bottomCollapsed: false,
        bottomHeight: 280,
      }));
    } else if (preset === 'inspect') {
      setLayout((prev) => ({
        ...prev,
        zenMode: false,
        leftCollapsed: false,
        leftWidth: 220,
        rightCollapsed: false,
        rightWidth: 360,
        bottomCollapsed: true,
      }));
    } else {
      setLayout((prev) => ({
        ...DEFAULT_LAYOUT,
        activeWorkspaceView: prev.activeWorkspaceView,
      }));
    }
  };

  const resetLayout = () => {
    setLayout(DEFAULT_LAYOUT);
    setFloatingPanelOpen(false);
  };

  return (
    <LayoutContext.Provider
      value={{
        ...layout,
        setLeftWidth,
        setRightWidth,
        setBottomHeight,
        setLeftCollapsed,
        toggleLeftCollapsed,
        setRightCollapsed,
        toggleRightCollapsed,
        setBottomCollapsed,
        toggleBottomCollapsed,
        setActiveLeftTab,
        setActiveRightTab,
        setActiveBottomTab,
        setActiveWorkspaceView,
        toggleZenMode,
        applyPreset,
        resetLayout,
        floatingPanelOpen,
        floatingPanelTab,
        openFloatingPanel,
        closeFloatingPanel,
        toggleFloatingPanel,
        setFloatingPanelTab,
      }}
    >
      {children}
    </LayoutContext.Provider>
  );
};

export const useLayout = (): LayoutContextType => {
  const context = useContext(LayoutContext);
  if (!context) {
    throw new Error('useLayout must be used within a LayoutProvider');
  }
  return context;
};
