import type { ReactElement } from 'react'
import { SlotRenderer } from '../../../workbench/sdk'

export function StatusBar(): ReactElement {
  return (
    <footer data-ds-type="meta" className="ds-type-meta h-8 w-full bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-dark)] border-t border-[var(--ds-border)] dark:border-[var(--ds-border)] flex items-center justify-between px-3 select-none shrink-0 font-sans shadow-xs z-30">
      <div className="flex items-center gap-2 min-w-0">
        <div data-ds-type="label" className="ds-type-label flex items-center gap-1.5 px-2 py-0.5 rounded-md bg-[var(--ds-surface-muted)]">
            <span className="w-2 h-2 rounded-full bg-emerald-600" />
          <span>核心引擎就绪</span>
        </div>
        <SlotRenderer
          slotId="statusbar.left"
          fallback={<span className="text-xs text-[var(--ds-text-subtle)]">工作台已加载</span>}
        />
      </div>

      <div className="flex items-center gap-2 shrink-0">
        <SlotRenderer slotId="statusbar.right" className="flex items-center gap-2" />
      </div>
    </footer>
  )
}
