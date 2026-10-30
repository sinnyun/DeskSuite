import type { ReactElement } from 'react'
import { Copy, Download, Trash2 } from 'lucide-react'
import {
  call,
  log,
  logStore,
  useLogs,
  useUiKit
} from '../../../workbench/sdk'
import {
  consoleViewStore,
  filterLogs,
  logPayloadText,
  useConsoleView
} from '../view'

function serialize(entries: ReturnType<typeof filterLogs>): string {
  return [...entries]
    .reverse()
    .map((entry) => {
      const payload = logPayloadText(entry)
      return `${entry.timestamp} [${entry.level.toUpperCase()}] ${entry.source} ${entry.message}${payload ? ` ${payload.replace(/\s+/g, ' ')}` : ''}`
    })
    .join('\n')
}

export function ConsoleToolbar(): ReactElement {
  const { DesktopButton } = useUiKit()
  const logs = useLogs()
  const view = useConsoleView()
  const filtered = filterLogs(logs, view)

  const copyFiltered = async (): Promise<void> => {
    if (filtered.length === 0) {
      log('warn', 'DebugConsole', '当前筛选结果为空，没有可复制的日志')
      return
    }
    try {
      await call('clipboard', 'writeText', serialize(filtered))
      log('event', 'DebugConsole', `已复制 ${filtered.length} 条日志到剪贴板`)
    } catch (error) {
      log('error', 'DebugConsole', '复制日志失败', String(error))
    }
  }

  const exportJson = async (): Promise<void> => {
    if (filtered.length === 0) {
      log('warn', 'DebugConsole', '当前筛选结果为空，没有可导出的日志')
      return
    }
    try {
      const saved = await call<string | null>(
        'filesystem',
        'saveText',
        'desksuite-日志.json',
        JSON.stringify([...filtered].reverse(), null, 2),
        'json'
      )
      if (saved) log('event', 'DebugConsole', `已导出 ${filtered.length} 条日志：${saved}`)
    } catch (error) {
      log('error', 'DebugConsole', '导出日志失败', String(error))
    }
  }

  return (
    <div className="flex items-center gap-1">
      <DesktopButton
        size="xs"
        variant="ghost"
        icon={<Copy className="w-3 h-3" />}
        onClick={() => void copyFiltered()}
      >
        复制{filtered.length !== logs.length ? ` ${filtered.length}` : ''}
      </DesktopButton>
      <DesktopButton
        size="xs"
        variant="ghost"
        icon={<Download className="w-3 h-3" />}
        onClick={() => void exportJson()}
      >
        导出
      </DesktopButton>
      <DesktopButton
        size="xs"
        variant="ghost"
        icon={<Trash2 className="w-3 h-3" />}
        onClick={() => {
          logStore.clear()
          consoleViewStore.reset()
          log('lifecycle', 'DebugConsole', '调试日志已清空')
        }}
      >
        清空
      </DesktopButton>
    </div>
  )
}
