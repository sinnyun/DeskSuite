import { useEffect, useMemo } from 'react'
import type { ReactElement } from 'react'
import { AlertCircle, Terminal } from 'lucide-react'
import { getService, logStore, useLayoutShallow, useLogs, useUiKit, type ContextMenuService } from '../../../workbench/sdk'
import { consoleViewStore, filterLogs, useConsoleView } from '../view'

export function ConsoleStatus(): ReactElement {
  const logs = useLogs()
  const { DesktopButton } = useUiKit()
  const view = useConsoleView()
  const { openFloatingPanel } = useLayoutShallow((state) => ({ openFloatingPanel: state.openFloatingPanel }))
  // 状态栏常驻，日志每追加一条都会重渲染；两条计数按日志与筛选状态记忆，避免每次渲染重扫整个缓冲。
  const { errors, filtered } = useMemo(() => ({
    errors: logs.filter((entry) => entry.level === 'error').length,
    filtered: filterLogs(logs, view).length
  }), [logs, view])
  const filtering = filtered !== logs.length

  useEffect(() => {
    const cm = getService<ContextMenuService>('contextMenu')
    if (!cm) return
    return cm.register('debug.status', () => [
      { id: 'open', label: '打开调试台', onSelect: () => openFloatingPanel('debug-console') },
      { id: 'clear', label: '清空日志', danger: true, disabled: !logs.length, onSelect: () => { if (window.confirm('清空全部调试日志？')) { logStore.clear(); consoleViewStore.reset() } } }
    ], { order: 10 })
  }, [openFloatingPanel, logs.length])

  return (
    <DesktopButton
      type="button"
      size="xs"
      variant="ghost"
      data-context-zone="debug.status"
      onClick={() => openFloatingPanel('debug-console')}
      title="打开调试控制台"
      className="gap-1.5 px-1"
    >
      <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] font-mono tabular-nums text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">
        <Terminal className="w-3 h-3" />
        {filtering ? `${filtered}/${logs.length}` : logs.length}
      </span>
      {errors > 0 && (
        <span className="flex items-center gap-1 px-2 py-0.5 rounded-md bg-[var(--ds-status-danger-soft)] dark:bg-[var(--ds-status-danger-soft)] font-mono tabular-nums text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]">
          <AlertCircle className="w-3 h-3" />
          {errors}
        </span>
      )}
    </DesktopButton>
  )
}
