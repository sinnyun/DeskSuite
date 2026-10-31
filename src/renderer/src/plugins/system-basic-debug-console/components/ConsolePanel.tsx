import { useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { ChevronDown, ChevronRight, FilterX } from 'lucide-react'
import { useLayout, useLogs, useUiKit, type LogCategory, type LogEntry, type LogLevel } from '../../../workbench/sdk'
import {
  LOG_CATEGORIES,
  LOG_LEVELS,
  consoleViewStore,
  filterLogs,
  logPayloadText,
  useConsoleView
} from '../view'
import { formatMessage, levelLabel, phaseLabel, sourceLabel } from '../labels'
import { ConsoleToolbar } from './ConsoleToolbar'

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]',
  warn: 'bg-[var(--ds-status-warning-soft)] text-[var(--ds-status-warning)]',
  error: 'bg-[var(--ds-status-danger-soft)] text-[var(--ds-status-danger)]',
  event: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]',
  lifecycle: 'bg-[var(--ds-status-success-soft)] text-[var(--ds-status-success)]'
}

const CATEGORY_LABEL: Record<LogCategory, string> = {
  action: '操作', transfer: '传输', processing: '处理', result: '结果', system: '系统'
}

interface LogGroup {
  id: string
  traceId?: string
  entries: LogEntry[]
}

function groupEntries(entries: LogEntry[]): LogGroup[] {
  const groups = new Map<string, LogGroup>()
  for (const entry of entries) {
    const key = entry.traceId ? `trace:${entry.traceId}` : `entry:${entry.id}`
    const existing = groups.get(key)
    if (existing) existing.entries.push(entry)
    else groups.set(key, { id: key, traceId: entry.traceId, entries: [entry] })
  }
  return [...groups.values()]
}

function LogRow({ entry }: { entry: LogEntry }): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const view = useConsoleView()
  const payload = logPayloadText(entry)
  const expanded = view.expanded.includes(entry.id)
  const compact = payload.replace(/\s+/g, ' ')

  return (
    <div className="flex items-start gap-2 px-3 py-1.5 border-b border-[var(--ds-border)] hover:bg-[var(--ds-hover-overlay)]">
      <span className="text-[var(--ds-text-subtle)] tabular-nums shrink-0 select-text">{entry.timestamp}</span>
      <span className={`shrink-0 px-1.5 rounded text-[10px] font-semibold leading-4 mt-0.5 ${LEVEL_STYLE[entry.level]}`}>
        {levelLabel(entry.level)}
      </span>
      <span title={`原始来源：${entry.source}`} className="shrink-0 text-[var(--ds-text-secondary)] font-semibold">{sourceLabel(entry.source)}</span>
      <div className="text-[var(--ds-text-primary)] break-all select-text min-w-0 flex-1">
        <div className="flex items-start gap-1">
          {payload && <DesktopIconButton size="xs" onClick={() => consoleViewStore.toggleExpanded(entry.id)} title={expanded ? '收起载荷' : '展开载荷'} icon={expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />} className="mt-0.5" />}
          <span className="min-w-0">
            <span title={`原始记录：${entry.message}`}>{formatMessage(entry.message)}</span>
            {entry.phase && <span className="ml-1.5 text-[var(--ds-text-subtle)]">· {phaseLabel(entry.phase)}</span>}
            {entry.durationMs !== undefined && <span className="ml-1.5 text-[var(--ds-text-subtle)] tabular-nums">耗时 {entry.durationMs} 毫秒</span>}
            {payload && !expanded && <span className="ml-2 text-[var(--ds-text-subtle)] break-all">{compact.length > 180 ? `${compact.slice(0, 180)}…` : compact}</span>}
          </span>
        </div>
        {payload && expanded && <pre className="mt-1 mb-1 max-h-72 overflow-auto rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-2 text-xs leading-relaxed whitespace-pre-wrap break-all text-[var(--ds-text-secondary)]">{payload}</pre>}
      </div>
    </div>
  )
}

function TraceGroup({ group }: { group: LogGroup }): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const view = useConsoleView()
  const expanded = view.expanded.includes(group.id)
  const latest = group.entries[0]
  const errorCount = group.entries.filter((entry) => entry.status === 'error' || entry.level === 'error').length
  const messageSummary = formatMessage(latest.message).replace(/ · (请求|返回|失败)$/, '')
  const summary = group.traceId
    ? latest.source === 'IPC' || latest.source === 'MCP' ? messageSummary : `${sourceLabel(latest.source)} · ${messageSummary}`
    : formatMessage(latest.message)

  if (!group.traceId) return <LogRow entry={latest} />

  return (
    <div className="border-b border-[var(--ds-border)]">
      <div className="flex items-center gap-2 px-2 py-1.5 bg-[var(--ds-surface-subtle)]/70 hover:bg-[var(--ds-hover-overlay)]">
        <DesktopIconButton size="xs" onClick={() => consoleViewStore.toggleExpanded(group.id)} title={expanded ? '折叠调用链' : '展开调用链'} icon={expanded ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />} />
        <span title={latest.message} className="text-[var(--ds-text-primary)] truncate flex-1">{summary}</span>
        <span className="text-[var(--ds-text-subtle)] tabular-nums shrink-0">{group.entries.length} 个阶段</span>
        {errorCount > 0 && <span className="text-[var(--ds-status-danger)] shrink-0">{errorCount} 错误</span>}
        <span className="font-mono text-[10px] text-[var(--ds-text-subtle)] shrink-0 select-text">{group.traceId}</span>
      </div>
      {expanded && <div className="pl-3">{group.entries.map((entry) => <LogRow key={entry.id} entry={entry} />)}</div>}
    </div>
  )
}

export function ConsolePanel(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopInput, DesktopSelect, ThemeFloatingPanel } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayout()
  const logs = useLogs()
  const view = useConsoleView()
  const filtered = useMemo(() => filterLogs(logs, view), [logs, view])
  const groups = useMemo(() => groupEntries(filtered), [filtered])
  const [visibleLimit, setVisibleLimit] = useState(500)
  const visibleGroups = groups.slice(0, visibleLimit)
  const sources = useMemo(() => [...new Set(logs.map((entry) => entry.source))].sort((a, b) => a.localeCompare(b)), [logs])
  const counts = useMemo(() => {
    const levels: Record<LogLevel, number> = { info: 0, warn: 0, error: 0, event: 0, lifecycle: 0 }
    const categories: Record<LogCategory, number> = { action: 0, transfer: 0, processing: 0, result: 0, system: 0 }
    for (const entry of logs) {
      levels[entry.level] += 1
      categories[entry.category ?? 'system'] += 1
    }
    return { levels, categories }
  }, [logs])
  const filtering = view.search.trim().length > 0 || view.source !== '*' || view.levels.length !== LOG_LEVELS.length || view.categories.length !== LOG_CATEGORIES.length
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'debug-console'

  return (
    <ThemeFloatingPanel title="程序调试信息" persistenceKey="debug-console" icon={<span className="font-mono text-sm">&gt;_</span>} badge={`${groups.length} 组`} isOpen={isOpen} onClose={closeFloatingPanel} initialX={64} initialY={62} initialWidth={1320} initialHeight={820} minWidth={900} minHeight={560} headerActions={<ConsoleToolbar />}>
      <div className="flex h-full min-h-0 flex-col overflow-hidden font-mono text-xs leading-relaxed">
        <div className="sticky top-0 z-10 shrink-0 space-y-1.5 pb-2 bg-[var(--ds-surface)]">
          <div className="flex flex-wrap items-center gap-1">
            {LOG_CATEGORIES.map((category) => <DesktopButton key={category} size="xs" variant="pill" active={view.categories.includes(category)} onClick={() => consoleViewStore.toggleCategory(category)}>{CATEGORY_LABEL[category]} {counts.categories[category]}</DesktopButton>)}
            <span className="mx-1 h-4 border-l border-[var(--ds-border)]" />
            {LOG_LEVELS.map((level) => <DesktopButton key={level} size="xs" variant="pill" active={view.levels.includes(level)} onClick={() => consoleViewStore.toggleLevel(level)}>{levelLabel(level)} {counts.levels[level]}</DesktopButton>)}
          </div>
          <div className="flex items-center gap-2">
            <DesktopSelect aria-label="按来源筛选" value={view.source} options={[{ value: '*', label: '全部来源' }, ...sources.map((source, index) => ({ value: source, label: sourceLabel(source, index) }))]} onChange={consoleViewStore.setSource} className="w-36 shrink-0" />
            <div className="min-w-48 flex-1">
              <DesktopInput placeholder="搜索来源、服务/方法、内容、关联 ID…" value={view.search} clearable onClear={() => consoleViewStore.setSearch('')} onChange={(event) => consoleViewStore.setSearch(event.target.value)} />
            </div>
            {filtering && <DesktopIconButton size="xs" icon={<FilterX className="w-3.5 h-3.5" />} tooltip="重置筛选" onClick={consoleViewStore.reset} />}
            <span className="text-[var(--ds-text-subtle)] tabular-nums shrink-0">{groups.length} 组 / {filtered.length} 条</span>
          </div>
        </div>
        <div className="flex-1 min-h-0 overflow-auto rounded-lg border border-[var(--ds-border)]">
          {logs.length === 0 ? <div className="flex h-full items-center justify-center p-6 text-[var(--ds-text-subtle)]">暂无调试信息。调用应用服务或执行 MCP 工具后，操作与数据流会显示在这里。</div>
            : filtered.length === 0 ? <div className="flex h-full items-center justify-center p-6 text-[var(--ds-text-subtle)]">没有符合筛选条件的记录</div>
              : <>
                {visibleGroups.map((group) => <TraceGroup key={group.id} group={group} />)}
                {groups.length > visibleGroups.length && <div className="flex justify-center p-2"><DesktopButton size="xs" variant="ghost" onClick={() => setVisibleLimit((limit) => limit + 500)}>加载更早记录（{groups.length - visibleGroups.length} 组）</DesktopButton></div>}
              </>}
        </div>
      </div>
    </ThemeFloatingPanel>
  )
}
