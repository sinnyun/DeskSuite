import React from 'react';
import { PluginDefinition } from '../../types/workbench';
import { DebugConsoleView } from './components/DebugConsoleView';
import { useDebug } from './context/DebugContext';
import { Terminal, AlertTriangle, AlertCircle, CheckCircle } from 'lucide-react';

const DebugBottomTabLabel: React.FC = () => {
  const { countsByLevel } = useDebug();
  return (
    <div className="flex items-center gap-1.5">
      <Terminal className="w-3.5 h-3.5" />
      <span>调试输出</span>
      {countsByLevel.error > 0 && (
        <span className="px-1.5 py-0.2 text-[10px] font-mono rounded bg-rose-500 text-white font-bold">
          {countsByLevel.error}
        </span>
      )}
    </div>
  );
};

const DebugStatusIndicator: React.FC = () => {
  const { countsByLevel } = useDebug();

  return (
    <div className="flex items-center gap-2 font-mono text-[11px]">
      {countsByLevel.error > 0 ? (
        <span className="flex items-center gap-1 text-rose-500 font-semibold">
          <AlertCircle className="w-3 h-3" />
          <span>{countsByLevel.error} 错误</span>
        </span>
      ) : countsByLevel.warn > 0 ? (
        <span className="flex items-center gap-1 text-amber-500 font-semibold">
          <AlertTriangle className="w-3 h-3" />
          <span>{countsByLevel.warn} 警告</span>
        </span>
      ) : (
        <span className="flex items-center gap-1 text-emerald-500">
          <CheckCircle className="w-3 h-3" />
          <span>正常</span>
        </span>
      )}
    </div>
  );
};

export const debugConsolePlugin: PluginDefinition = {
  id: 'plugin-debug-console',
  name: '调试与运行状态控制台',
  version: '1.0.0',
  description: '提供运行调试信息分类筛选、搜索、导出、复制以及交互模拟',
  author: 'Workbench Core',
  enabled: true,
  contributions: [
    // 1. Bottom Dock Tab Slot
    {
      id: 'debug-tab',
      slotId: 'bottom.tabs',
      pluginId: 'plugin-debug-console',
      title: '调试控制台',
      order: 10,
      render: () => <DebugBottomTabLabel />,
    },

    // 2. Bottom Dock Content Slot
    {
      id: 'debug-content',
      slotId: 'bottom.content',
      pluginId: 'plugin-debug-console',
      order: 10,
      render: () => <DebugConsoleView />,
    },

    // 3. Status Bar Indicator Slot
    {
      id: 'debug-status',
      slotId: 'statusbar.right',
      pluginId: 'plugin-debug-console',
      order: 20,
      render: () => <DebugStatusIndicator />,
    },
  ],
};
