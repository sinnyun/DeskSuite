import React, { createContext, useContext, useEffect, useState } from 'react';
import { LogEntry, LogLevel } from '../../../types/workbench';

interface DebugContextType {
  logs: LogEntry[];
  addLog: (
    level: LogLevel,
    source: string,
    message: string,
    payload?: Record<string, unknown> | string | number | boolean | null,
    tags?: string[]
  ) => void;
  clearLogs: () => void;
  activeLevel: LogLevel | 'all';
  setActiveLevel: (level: LogLevel | 'all') => void;
  searchQuery: string;
  setSearchQuery: (query: string) => void;
  filteredLogs: LogEntry[];
  countsByLevel: Record<LogLevel | 'all', number>;
  copyLogsToClipboard: () => Promise<boolean>;
  exportLogs: (format: 'json' | 'txt') => void;
  simulateLog: (type: 'info' | 'warn' | 'error' | 'event' | 'scan') => void;
}

const INITIAL_LOGS: LogEntry[] = [
  {
    id: 'log-1',
    timestamp: '14:22:01.102',
    level: 'lifecycle',
    source: 'WorkbenchCore',
    message: 'Desktop Workbench Studio 内核启动完成，就绪监听插件挂载',
    payload: { version: '1.0.0', platform: 'React 19 / Web' },
    tags: ['kernel', 'init'],
  },
  {
    id: 'log-2',
    timestamp: '14:22:01.140',
    level: 'info',
    source: 'SlotRegistry',
    message: '成功注册托槽系统：14 个插槽就绪，策略为基于优先级的声明式注入',
    tags: ['slots', 'registry'],
  },
  {
    id: 'log-3',
    timestamp: '14:22:01.185',
    level: 'info',
    source: 'ThemeEngine',
    message: '统一主题引擎初始化完成，已适配系统外观并挂载 Fluent/macOS 视觉令牌',
    payload: { activeMode: 'dark', accent: 'blue' },
    tags: ['theme', 'fluent'],
  },
  {
    id: 'log-4',
    timestamp: '14:22:01.210',
    level: 'lifecycle',
    source: 'PluginManager',
    message: '加载内置插件: plugin-file-explorer v1.0.0 (5 个托槽扩展点)',
    tags: ['plugin', 'explorer'],
  },
  {
    id: 'log-5',
    timestamp: '14:22:01.320',
    level: 'event',
    source: 'FileSystem',
    message: '挂载本地驱动器成功: C: (系统盘), D: (开发盘), Cloud: (云端盘)',
    payload: { totalDrives: 3, mountedPaths: ['/', '/src', '/assets', '/docs'] },
    tags: ['fs', 'mount'],
  },
  {
    id: 'log-6',
    timestamp: '14:22:02.005',
    level: 'info',
    source: 'LayoutEngine',
    message: '初始化拖动框架与折叠托架布局，激活双向指针捕获监听器',
    tags: ['layout', 'splitters'],
  },
  {
    id: 'log-7',
    timestamp: '14:22:04.412',
    level: 'warn',
    source: 'AssetLoader',
    message: '检测到大尺寸纹理图像 assets/desktop_workbench_cover.png，已启用渐进式缓存',
    payload: { dimensions: '1920x1080', size: '485 KB' },
    tags: ['cache', 'perf'],
  },
];

const DebugContext = createContext<DebugContextType | undefined>(undefined);

export const DebugProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [logs, setLogs] = useState<LogEntry[]>(INITIAL_LOGS);
  const [activeLevel, setActiveLevel] = useState<LogLevel | 'all'>('all');
  const [searchQuery, setSearchQuery] = useState<string>('');

  const addLog = (
    level: LogLevel,
    source: string,
    message: string,
    payload?: Record<string, unknown> | string | number | boolean | null,
    tags?: string[]
  ) => {
    const now = new Date();
    const timeStr = `${String(now.getHours()).padStart(2, '0')}:${String(now.getMinutes()).padStart(
      2,
      '0'
    )}:${String(now.getSeconds()).padStart(2, '0')}.${String(now.getMilliseconds()).padStart(3, '0')}`;

    const newEntry: LogEntry = {
      id: `log-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`,
      timestamp: timeStr,
      level,
      source,
      message,
      payload,
      tags,
    };

    setLogs((prev) => [newEntry, ...prev]);
  };

  const clearLogs = () => {
    setLogs([]);
  };

  const countsByLevel: Record<LogLevel | 'all', number> = {
    all: logs.length,
    info: logs.filter((l) => l.level === 'info').length,
    warn: logs.filter((l) => l.level === 'warn').length,
    error: logs.filter((l) => l.level === 'error').length,
    event: logs.filter((l) => l.level === 'event').length,
    lifecycle: logs.filter((l) => l.level === 'lifecycle').length,
  };

  const filteredLogs = logs.filter((item) => {
    if (activeLevel !== 'all' && item.level !== activeLevel) return false;
    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      const matchMsg = item.message.toLowerCase().includes(q);
      const matchSrc = item.source.toLowerCase().includes(q);
      const matchTags = item.tags?.some((t) => t.toLowerCase().includes(q));
      if (!matchMsg && !matchSrc && !matchTags) return false;
    }
    return true;
  });

  const copyLogsToClipboard = async (): Promise<boolean> => {
    try {
      const text = filteredLogs
        .map(
          (l) =>
            `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}]: ${l.message} ${
              l.payload ? JSON.stringify(l.payload) : ''
            }`
        )
        .join('\n');
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      return false;
    }
  };

  const exportLogs = (format: 'json' | 'txt') => {
    let content = '';
    let mimeType = 'text/plain';
    let filename = `workbench-debug-${Date.now()}.${format}`;

    if (format === 'json') {
      content = JSON.stringify(filteredLogs, null, 2);
      mimeType = 'application/json';
    } else {
      content = filteredLogs
        .map(
          (l) =>
            `[${l.timestamp}] [${l.level.toUpperCase()}] [${l.source}]: ${l.message} ${
              l.payload ? JSON.stringify(l.payload) : ''
            }`
        )
        .join('\n');
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
    URL.revokeObjectURL(url);
  };

  const simulateLog = (type: 'info' | 'warn' | 'error' | 'event' | 'scan') => {
    if (type === 'warn') {
      addLog('warn', 'MemoryWatcher', '高频事件触发检测：帧率稳定在 60fps，未发生漏帧', {
        bufferSize: '12.4 MB',
      });
    } else if (type === 'error') {
      addLog(
        'error',
        'PluginSecurity',
        '捕获到沙箱边界未授权调用尝试：外部插件缺少 IPC_STORAGE 权限',
        { code: 'ERR_UNAUTHORIZED_PERM', target: '/system/secure_key' }
      );
    } else if (type === 'scan') {
      addLog('event', 'FileWatcher', '磁盘扫描完成：共检索 12 个工程文件，索引表已刷新', {
        indexedCount: 12,
        durationMs: 4.8,
      });
    } else if (type === 'event') {
      addLog('event', 'SlotDispatcher', '用户切换工作区托槽视图为 [Gallery View]', {
        previous: 'list',
        current: 'gallery',
      });
    } else {
      addLog('info', 'SystemProbe', '诊断探测正常：所有托槽与主题组件响应良好', {
        timestamp: Date.now(),
      });
    }
  };

  return (
    <DebugContext.Provider
      value={{
        logs,
        addLog,
        clearLogs,
        activeLevel,
        setActiveLevel,
        searchQuery,
        setSearchQuery,
        filteredLogs,
        countsByLevel,
        copyLogsToClipboard,
        exportLogs,
        simulateLog,
      }}
    >
      {children}
    </DebugContext.Provider>
  );
};

export const useDebug = (): DebugContextType => {
  const context = useContext(DebugContext);
  if (!context) {
    throw new Error('useDebug must be used within a DebugProvider');
  }
  return context;
};
