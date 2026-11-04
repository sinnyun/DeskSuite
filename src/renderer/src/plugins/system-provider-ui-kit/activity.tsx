import type { ReactElement } from 'react'
import type { ActivityButtonProps } from '../../workbench/sdk'

export function ActivityButton({
  icon,
  label,
  active = false,
  badge,
  tooltip,
  onClick
}: ActivityButtonProps): ReactElement {
  return (
    <button
      type="button"
      onClick={onClick}
      data-activity-label={label}
      title={tooltip || label}
        className={`relative group w-12 min-h-12 h-auto py-1 flex flex-col items-center justify-center rounded-md transition-all cursor-pointer ${
        active
          ? 'bg-[var(--ds-accent)] dark:bg-[var(--ds-accent)] text-white dark:text-white shadow-sm font-semibold'
          : 'text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)] hover:text-[var(--ds-text-primary)] dark:hover:text-white hover:bg-[var(--ds-surface-muted)] dark:hover:bg-[var(--ds-surface-raised)]'
      }`}
    >
      <span className="shrink-0 transition-transform group-hover:scale-105">{icon}</span>
        <span className="mt-0.5 max-w-[44px] text-center text-xs leading-tight">{label}</span>
      {active && (
        <span className="absolute left-0 top-2 bottom-2 w-0.5 rounded-r bg-[var(--ds-accent)] dark:bg-[var(--ds-accent-strong)]" />
      )}
      {badge !== undefined && (
          <span className="absolute -top-1 -right-1 px-1 py-0.2 min-w-4 text-xs font-mono font-bold bg-[var(--ds-accent)] text-white rounded-full text-center shadow-xs">
          {badge}
        </span>
      )}
    </button>
  )
}
