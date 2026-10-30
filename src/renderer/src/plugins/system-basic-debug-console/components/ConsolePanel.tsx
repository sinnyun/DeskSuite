import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { ChevronDown, ChevronRight, FilterX } from 'lucide-react'
import { useLogs, useUiKit, type LogEntry, type LogLevel } from '../../../workbench/sdk'
import {
  LOG_LEVELS,
  consoleViewStore,
  filterLogs,
  logPayloadText,
  useConsoleView
} from '../view'

const LEVEL_STYLE: Record<LogLevel, string> = {
  info: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:bg-[var(--ds-accent-container)] dark:text-[var(--ds-accent-strong)]',
  warn: 'bg-[var(--ds-status-warning-soft)] text-[var(--ds-status-warning)] dark:bg-[var(--ds-status-warning-soft)] dark:text-[var(--ds-status-warning)]',
  error: 'bg-[var(--ds-status-danger-soft)] text-[var(--ds-status-danger)] dark:bg-[var(--ds-status-danger-soft)] dark:text-[var(--ds-status-danger)]',
  event: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]',
  lifecycle: 'bg-[var(--ds-status-success-soft)] text-[var(--ds-status-success)] dark:bg-[var(--ds-status-success-soft)] dark:text-[var(--ds-status-success)]'
}

const LEVEL_LABEL: Record<LogLevel, string> = {
  info: 'INFO',
  warn: 'WARN',
  error: 'ERROR',
  event: 'EVENT',
  lifecycle: 'BOOT'
}

const LEVEL_CHIP_LABEL: Record<LogLevel, string> = {
  info: '信息',
  warn: '警告',
  error: '错误',
  event: '事件',
  lifecycle: '启动'
}

const SOURCE_STYLE: Record<string, string> = {
  Workbench: 'text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)]',
  PluginLoader: 'text-[var(--ds-accent)]',
  Explorer: 'text-[var(--ds-status-info)] dark:text-[var(--ds-status-info)]',
  Inspector: 'text-[var(--ds-status-info)]',
  Clipboard: 'text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]',
  Insights: 'text-[var(--ds-accent)]',
  Main: 'text-[var(--ds-status-success)] dark:text-[var(--ds-status-success)]'
}

function LogRow({ entry }: { entry: LogEntry }): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const view = useConsoleView()
  const payload = logPayloadText(entry)
  const expanded = view.expanded.includes(entry.id)
  const compact = payload.replace(/\s+/g, ' ')

  return (
    <div className="flex items-start gap-2 px-3 py-1 border-b border-[var(--ds-border)] hover:bg-[var(--ds-hover-overlay)]">
      <span className="text-[var(--ds-text-subtle)] tabular-nums shrink-0 select-text">{entry.timestamp}</span>
      <span
        className={`shrink-0 px-1.5 rounded text-xs font-semibold leading-4 mt-0.5 ${LEVEL_STYLE[entry.level]}`}
      >
        {LEVEL_LABEL[entry.level]}
      </span>
      <span className={`shrink-0 font-semibold ${SOURCE_STYLE[entry.source] ?? 'text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]'}`}>
        {entry.source}
      </span>
      <div className="text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)] break-all select-text min-w-0 flex-1">
        <div className="flex items-start gap-1">
          {payload && (
            <DesktopIconButton
              size="xs"
              onClick={() => consoleViewStore.toggleExpanded(entry.id)}
              title={expanded ? '收起数据' : '展开数据'}
              icon={expanded ? <ChevronDown className="w-3 h-3" /> : <ChevronRight className="w-3 h-3" />}
              className="mt-0.5"
            />
          )}
          <span className="min-w-0">
            {entry.message}
            {payload && !expanded && (
              <span className="ml-2 text-[var(--ds-text-subtle)] dark:text-[var(--ds-text-muted)] break-all">
                {compact.length > 120 ? `${compact.slice(0, 120)}…` : compact}
              </span>
            )}
          </span>
        </div>
        {payload && expanded && (
          <pre className="mt-1 mb-1 rounded-lg border border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-code)] p-2 text-xs leading-relaxed whitespace-pre-wrap break-all text-[var(--ds-text-primary)] dark:text-[var(--ds-text-secondary)]">
            {payload}
          </pre>
        )}
      </div>
    </div>
  )
}

export function ConsolePanel(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopInput } = useUiKit()
  const logs = useLogs()
  const view = useConsoleView()
  const filtered = useMemo(() => filterLogs(logs, view), [logs, view])
  const counts = useMemo(() => {
    const result: Record<LogLevel, number> = {
      info: 0,
      warn: 0,
      error: 0,
      event: 0,
      lifecycle: 0
    }
    for (const entry of logs) result[entry.level] += 1
    return result
  }, [logs])
  const filtering = view.search.trim().length > 0 || view.levels.length !== LOG_LEVELS.length

  if (logs.length === 0) {
    return (
      <div className="flex items-center justify-center h-full p-6 text-xs text-[var(--ds-text-subtle)]">
        暂无日志，工作台与主进程的事件会实时汇集到这里
      </div>
    )
  }

  return (
    <div className="font-mono text-xs leading-relaxed">
      <div className="sticky top-0 z-10 flex flex-wrap items-center gap-1.5 px-3 py-1.5 bg-[var(--ds-surface)]/95 backdrop-blur-md border-b border-[var(--ds-border)]">
        {LOG_LEVELS.map((level) => (
          <DesktopButton
            key={level}
            size="xs"
            variant="pill"
            active={view.levels.includes(level)}
            onClick={() => consoleViewStore.toggleLevel(level)}
            className="text-xs"
          >
            {LEVEL_CHIP_LABEL[level]} {counts[level]}
          </DesktopButton>
        ))}
        <div className="ml-auto w-56 shrink-0">
          <DesktopInput
            placeholder="搜索日志、来源或数据…"
            value={view.search}
            clearable
            onClear={() => consoleViewStore.setSearch('')}
            onChange={(event) => consoleViewStore.setSearch(event.target.value)}
          />
        </div>
        {filtering && (
          <DesktopIconButton
            size="xs"
            icon={<FilterX className="w-3.5 h-3.5" />}
            tooltip="重置筛选"
            onClick={consoleViewStore.reset}
          />
        )}
        <span className="text-xs text-[var(--ds-text-subtle)] tabular-nums shrink-0">
          {filtered.length}/{logs.length}
        </span>
      </div>

      {filtered.length === 0 ? (
        <div className="flex items-center justify-center p-6 text-xs text-[var(--ds-text-subtle)]">
          没有符合筛选条件的日志
        </div>
      ) : (
        filtered.map((entry) => <LogRow key={entry.id} entry={entry} />)
      )}
    </div>
  )
}
