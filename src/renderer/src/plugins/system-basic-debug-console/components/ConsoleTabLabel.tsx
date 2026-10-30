import type { ReactElement } from 'react'
import { AlertCircle, Terminal } from 'lucide-react'
import { useLogs, type SlotLabelProps } from '../../../workbench/sdk'

export function ConsoleTabLabel({ active }: SlotLabelProps): ReactElement {
  const logs = useLogs()
  const errors = logs.filter((entry) => entry.level === 'error').length

  return (
    <span className={`flex items-center gap-1.5 ${active ? '' : 'text-inherit'}`}>
      <Terminal className="w-3.5 h-3.5" />
      <span>调试控制台</span>
      {errors > 0 && (
        <span className="flex items-center gap-0.5 px-1.5 py-0.2 text-xs font-mono rounded-full bg-[var(--ds-status-danger-soft)] text-[var(--ds-status-danger)]">
          <AlertCircle className="w-2.5 h-2.5" />
          {errors}
        </span>
      )}
    </span>
  )
}
