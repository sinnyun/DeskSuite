import React, { useState } from 'react';
import { useDebug } from '../context/DebugContext';
import { LogEntry, LogLevel } from '../../../types/workbench';
import { DesktopButton, DesktopIconButton, DesktopInput } from '../../../theme/components';
import {
  Trash2,
  Copy,
  Check,
  Download,
  Search,
  AlertCircle,
  AlertTriangle,
  Info,
  Activity,
  Terminal,
  Zap,
  ChevronRight,
  ChevronDown,
} from 'lucide-react';

export const DebugConsoleView: React.FC = () => {
  const {
    filteredLogs,
    activeLevel,
    setActiveLevel,
    countsByLevel,
    searchQuery,
    setSearchQuery,
    clearLogs,
    copyLogsToClipboard,
    exportLogs,
    simulateLog,
  } = useDebug();

  const [copied, setCopied] = useState(false);
  const [expandedLogIds, setExpandedLogIds] = useState<Set<string>>(new Set(['log-1']));

  const handleCopy = async () => {
    const success = await copyLogsToClipboard();
    if (success) {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    }
  };

  const toggleExpand = (id: string) => {
    setExpandedLogIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  };

  const levels: { id: LogLevel | 'all'; label: string; icon?: React.ReactNode }[] = [
    { id: 'all', label: '全部' },
    { id: 'info', label: '信息', icon: <Info className="w-3 h-3 text-[#5b5ce6]" /> },
    { id: 'warn', label: '警告', icon: <AlertTriangle className="w-3 h-3 text-[#d97706]" /> },
    { id: 'error', label: '错误', icon: <AlertCircle className="w-3 h-3 text-[#e11d48]" /> },
    { id: 'event', label: '事件', icon: <Zap className="w-3 h-3 text-[#059669]" /> },
    { id: 'lifecycle', label: '周期', icon: <Activity className="w-3 h-3 text-[#7c3aed]" /> },
  ];

  const getLevelBadge = (level: LogLevel) => {
    switch (level) {
      case 'error':
        return (
          <span className="font-mono text-[10px] uppercase font-bold text-[#e11d48] bg-rose-50 dark:bg-rose-950/40 px-2 py-0.5 rounded-full border border-rose-200 dark:border-rose-900/50">
            ERR
          </span>
        );
      case 'warn':
        return (
          <span className="font-mono text-[10px] uppercase font-bold text-[#d97706] bg-amber-50 dark:bg-amber-950/40 px-2 py-0.5 rounded-full border border-amber-200 dark:border-amber-900/50">
            WRN
          </span>
        );
      case 'event':
        return (
          <span className="font-mono text-[10px] uppercase font-bold text-[#059669] bg-emerald-50 dark:bg-emerald-950/40 px-2 py-0.5 rounded-full border border-emerald-200 dark:border-emerald-900/50">
            EVT
          </span>
        );
      case 'lifecycle':
        return (
          <span className="font-mono text-[10px] uppercase font-bold text-[#7c3aed] bg-purple-50 dark:bg-purple-950/40 px-2 py-0.5 rounded-full border border-purple-200 dark:border-purple-900/50">
            LC
          </span>
        );
      default:
        return (
          <span className="font-mono text-[10px] uppercase font-bold text-[#5b5ce6] bg-[#eef2ff] dark:bg-[#252846] px-2 py-0.5 rounded-full border border-[#5b5ce6]/25">
            INF
          </span>
        );
    }
  };

  return (
    <div className="flex flex-col h-full w-full select-none overflow-hidden font-sans text-xs bg-white dark:bg-[#161922]">
      {/* 1. Debug Filter & Actions Toolbar in FileAtlas Style */}
      <div className="flex flex-wrap items-center justify-between gap-2 px-3 py-1.5 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] shrink-0">
        {/* Left: Severity Level Filter Tabs */}
        <div className="flex items-center gap-1 overflow-x-auto no-scrollbar">
          {levels.map((item) => {
            const count = countsByLevel[item.id] || 0;
            const isActive = activeLevel === item.id;

            return (
              <button
                key={item.id}
                type="button"
                onClick={() => setActiveLevel(item.id)}
                className={`flex items-center gap-1.5 px-3 py-1 rounded-full text-xs transition-all cursor-pointer whitespace-nowrap ${
                  isActive
                    ? 'bg-[#5b5ce6] text-white font-semibold shadow-2xs'
                    : 'text-[#64748b] hover:text-[#1e293b] hover:bg-white dark:hover:bg-[#222834]'
                }`}
              >
                {item.icon}
                <span>{item.label}</span>
                <span className={`text-[10px] font-mono tabular-nums ${isActive ? 'text-white/80' : 'text-[#94a3b8]'}`}>
                  {count}
                </span>
              </button>
            );
          })}
        </div>

        {/* Center: Search Field */}
        <div className="w-40 sm:w-52">
          <DesktopInput
            icon={<Search className="w-3 h-3" />}
            placeholder="搜索调试日志..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            clearable
            onClear={() => setSearchQuery('')}
          />
        </div>

        {/* Right: Simulation Triggers & Export/Copy Actions */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Simulation Buttons */}
          <div className="hidden md:flex items-center gap-1 bg-black/[0.04] dark:bg-white/[0.05] p-0.5 rounded-full border border-[#e2e8f0] dark:border-[#2a3140]">
            <button
              type="button"
              onClick={() => simulateLog('warn')}
              title="模拟发出一条警告日志"
              className="px-2 py-0.5 rounded-full text-[11px] text-[#64748b] hover:text-[#1e293b] hover:bg-white dark:hover:bg-[#222834] transition-colors cursor-pointer"
            >
              +警告
            </button>
            <button
              type="button"
              onClick={() => simulateLog('error')}
              title="模拟发出一条异常日志"
              className="px-2 py-0.5 rounded-full text-[11px] text-[#64748b] hover:text-[#1e293b] hover:bg-white dark:hover:bg-[#222834] transition-colors cursor-pointer"
            >
              +异常
            </button>
            <button
              type="button"
              onClick={() => simulateLog('scan')}
              title="模拟发出一条文件扫描事件"
              className="px-2 py-0.5 rounded-full text-[11px] text-[#64748b] hover:text-[#1e293b] hover:bg-white dark:hover:bg-[#222834] transition-colors cursor-pointer"
            >
              +扫描
            </button>
          </div>

          <div className="h-4 w-px bg-[#e2e8f0] dark:bg-[#2a3140] hidden md:block" />

          {/* Copy Logs */}
          <DesktopButton
            size="xs"
            variant="default"
            icon={copied ? <Check className="w-3 h-3 text-[#059669]" /> : <Copy className="w-3 h-3" />}
            onClick={handleCopy}
            title="复制当前过滤的日志文本"
          >
            {copied ? '已复制' : '复制'}
          </DesktopButton>

          {/* Export JSON */}
          <DesktopButton
            size="xs"
            variant="default"
            icon={<Download className="w-3 h-3" />}
            onClick={() => exportLogs('json')}
            title="导出 JSON 格式日志"
          >
            导出
          </DesktopButton>

          {/* Clear Logs */}
          <DesktopIconButton
            size="xs"
            onClick={clearLogs}
            tooltip="清空日志面板"
            icon={<Trash2 className="w-3.5 h-3.5 text-[#64748b] hover:text-rose-500" />}
          />
        </div>
      </div>

      {/* 2. Log Stream List */}
      <div className="flex-1 overflow-auto divide-y divide-[#e2e8f0]/60 dark:divide-[#2a3140]/60 font-mono text-[11px] min-h-0 bg-white dark:bg-[#12151c]">
        {filteredLogs.length === 0 ? (
          <div className="flex flex-col items-center justify-center h-full p-8 text-[#94a3b8] text-center">
            <Terminal className="w-8 h-8 stroke-1 mb-2 opacity-50 text-[#5b5ce6]" />
            <span>无匹配的调试日志输出</span>
          </div>
        ) : (
          filteredLogs.map((log) => {
            const isExpanded = expandedLogIds.has(log.id);
            const hasPayload = log.payload !== undefined;

            return (
              <div
                key={log.id}
                className="flex flex-col px-3 py-1.5 hover:bg-[#fafbfd] dark:hover:bg-[#181c25] transition-colors"
              >
                <div className="flex items-start gap-2 min-w-0">
                  {/* Timestamp */}
                  <span className="text-[#94a3b8] tabular-nums shrink-0">
                    {log.timestamp}
                  </span>

                  {/* Level Badge */}
                  <span className="shrink-0">{getLevelBadge(log.level)}</span>

                  {/* Source Module */}
                  <span className="text-[#64748b] dark:text-[#94a3b8] font-semibold shrink-0">
                    [{log.source}]
                  </span>

                  {/* Message */}
                  <span className="text-[#1e293b] dark:text-[#f1f5f9] flex-1 break-words font-sans text-xs">
                    {log.message}
                  </span>

                  {/* Tags */}
                  {log.tags && log.tags.length > 0 && (
                    <div className="hidden lg:flex items-center gap-1 shrink-0">
                      {log.tags.map((t) => (
                        <span
                          key={t}
                          className="text-[10px] text-[#64748b] bg-[#f1f5f9] dark:bg-[#222834] px-2 py-0.2 rounded-full"
                        >
                          #{t}
                        </span>
                      ))}
                    </div>
                  )}

                  {/* Payload Expand Toggle */}
                  {hasPayload && (
                    <button
                      type="button"
                      onClick={() => toggleExpand(log.id)}
                      className="p-0.5 text-[#94a3b8] hover:text-[#1e293b] dark:hover:text-white rounded cursor-pointer shrink-0"
                      title={isExpanded ? '收起附加数据' : '展开附加数据'}
                    >
                      {isExpanded ? (
                        <ChevronDown className="w-3.5 h-3.5" />
                      ) : (
                        <ChevronRight className="w-3.5 h-3.5" />
                      )}
                    </button>
                  )}
                </div>

                {/* Expanded JSON / Data Viewer */}
                {hasPayload && isExpanded && (
                  <div className="mt-1.5 ml-14 p-2.5 rounded-xl bg-[#1e293b] text-[#93c5fd] text-[10px] overflow-auto shadow-inner">
                    <pre className="whitespace-pre-wrap">
                      {typeof log.payload === 'object'
                        ? JSON.stringify(log.payload, null, 2)
                        : String(log.payload)}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
