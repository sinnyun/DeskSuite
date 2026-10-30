/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useEffect } from 'react';
import { ThemeProvider } from './theme/ThemeContext';
import { LayoutProvider, useLayout } from './core/LayoutContext';
import { SlotRegistryProvider } from './core/SlotRegistry';
import { WorkbenchLayout } from './components/layout/WorkbenchLayout';
import { fileExplorerPlugin } from './plugins/file-explorer';
import { debugConsolePlugin } from './plugins/debug-console';
import { ExplorerProvider } from './plugins/file-explorer/context/ExplorerContext';
import { DebugProvider, useDebug } from './plugins/debug-console/context/DebugContext';

// Keyboard shortcut listener for native desktop feel
const WorkbenchKeyboardShortcuts: React.FC = () => {
  const { toggleLeftCollapsed, toggleRightCollapsed, toggleBottomCollapsed } = useLayout();
  const { addLog } = useDebug();

  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Check Cmd / Ctrl key
      const isModifier = e.metaKey || e.ctrlKey;

      if (isModifier && e.key.toLowerCase() === 'b') {
        e.preventDefault();
        toggleLeftCollapsed();
        addLog('event', 'KeyboardHandler', '快捷键触发: 切换左侧栏折叠状态 (Ctrl/Cmd+B)');
      } else if (isModifier && e.key.toLowerCase() === 'j') {
        e.preventDefault();
        toggleBottomCollapsed();
        addLog('event', 'KeyboardHandler', '快捷键触发: 切换底部控制台折叠状态 (Ctrl/Cmd+J)');
      } else if (isModifier && e.key.toLowerCase() === 'i') {
        e.preventDefault();
        toggleRightCollapsed();
        addLog('event', 'KeyboardHandler', '快捷键触发: 切换右侧属性栏折叠状态 (Ctrl/Cmd+I)');
      }
    };

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleLeftCollapsed, toggleRightCollapsed, toggleBottomCollapsed, addLog]);

  return null;
};

export default function App() {
  const plugins = [fileExplorerPlugin, debugConsolePlugin];

  return (
    <ThemeProvider>
      <LayoutProvider>
        <SlotRegistryProvider initialPlugins={plugins}>
          <ExplorerProvider>
            <DebugProvider>
              <WorkbenchKeyboardShortcuts />
              <WorkbenchLayout />
            </DebugProvider>
          </ExplorerProvider>
        </SlotRegistryProvider>
      </LayoutProvider>
    </ThemeProvider>
  );
}
