import type { ReactElement } from 'react'
import { ChevronDown, X } from 'lucide-react'
import type {
  DesktopButtonProps,
  DesktopCardButtonProps,
  DesktopCardProps,
  DesktopIconButtonProps,
  DesktopInputProps,
  DesktopSelectProps,
  DesktopTextareaProps,
  DesktopTabProps,
  DesktopTagPillProps
} from '../../workbench/sdk'

export function DesktopButton({
  children,
  variant = 'default',
  size = 'sm',
  icon,
  active = false,
  className = '',
  disabled,
  ...props
}: DesktopButtonProps): ReactElement {
  const primaryStyles =
    'bg-[var(--ds-accent)] hover:bg-[var(--ds-accent-hover)] text-white shadow-xs active:bg-[var(--ds-accent-active)] font-medium'
  const baseStyles =
    'inline-flex items-center justify-center font-medium transition-all duration-150 rounded-md cursor-pointer select-none whitespace-nowrap focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)]/40'
  const sizeStyles = {
    xs: 'px-[var(--ds-control-padding-xs)] text-[length:var(--ds-control-text-xs)] gap-[var(--ds-control-gap)] h-[var(--ds-control-xs)]',
    sm: 'px-[var(--ds-control-padding-sm)] text-[length:var(--ds-control-text-sm)] gap-[var(--ds-control-gap)] h-[var(--ds-control-sm)]',
    md: 'px-[var(--ds-control-padding-md)] text-[length:var(--ds-control-text-md)] gap-2 h-[var(--ds-control-md)]'
  }

  let variantStyle = ''
  if (variant === 'primary') {
    variantStyle = primaryStyles
  } else if (variant === 'pill') {
    variantStyle = active
      ? 'bg-[var(--ds-accent)] text-white shadow-xs font-semibold'
      : 'bg-[var(--ds-surface)] hover:bg-[var(--ds-surface-subtle)] text-[var(--ds-text-secondary)] border border-[var(--ds-border)]'
  } else if (variant === 'ghost') {
    variantStyle = active
      ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:bg-[var(--ds-accent-soft)] dark:text-[var(--ds-accent-strong)] font-semibold'
      : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-hover-overlay)]'
  } else if (variant === 'subtle') {
    variantStyle =
      'bg-[var(--ds-surface-muted)] hover:bg-[var(--ds-border)] text-[var(--ds-text-primary)] dark:bg-[var(--ds-surface-muted)] dark:hover:bg-[var(--ds-border)] dark:text-[var(--ds-text-secondary)] border border-[var(--ds-border)] dark:border-[var(--ds-border)]'
  } else if (variant === 'danger') {
    variantStyle =
      'bg-[var(--ds-status-danger-soft)] hover:bg-[var(--ds-status-danger-soft)] text-[var(--ds-status-danger)] dark:bg-[var(--ds-status-danger-soft)] dark:text-[var(--ds-status-danger)] border border-[var(--ds-status-danger)]/35 dark:border-[var(--ds-status-danger)]/35 active:bg-[var(--ds-status-danger-soft)]'
  } else {
    variantStyle = active
      ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] border border-[var(--ds-accent)]/30 dark:bg-[var(--ds-accent-soft)] dark:text-[var(--ds-accent-strong)] dark:border-[var(--ds-accent-strong)]/40 shadow-xs'
      : 'bg-[var(--ds-surface)] hover:bg-[var(--ds-surface-subtle)] text-[var(--ds-text-primary)] border border-[var(--ds-border)] shadow-xs active:scale-[0.98]'
  }

  const disabledStyle = disabled ? 'opacity-40 cursor-not-allowed pointer-events-none' : ''

  return (
    <button
      data-ds-type="control"
      className={`${baseStyles} ${sizeStyles[size]} ${variantStyle} ${disabledStyle} ${className}`}
      disabled={disabled}
      {...props}
    >
      {icon && <span className="shrink-0">{icon}</span>}
      {children}
    </button>
  )
}

export function DesktopIconButton({
  icon,
  active = false,
  variant = 'default',
  tooltip,
  size = 'sm',
  className = '',
  ...props
}: DesktopIconButtonProps): ReactElement {
  const sizeStyles = {
    xs: 'w-[var(--ds-control-xs)] h-[var(--ds-control-xs)] p-1 text-[length:var(--ds-control-text-xs)] rounded-[var(--ds-radius-control)]',
    sm: 'w-[var(--ds-control-sm)] h-[var(--ds-control-sm)] p-1.5 text-[length:var(--ds-control-text-sm)] rounded-[var(--ds-radius-control)]',
    md: 'w-[var(--ds-control-md)] h-[var(--ds-control-md)] p-2 text-[length:var(--ds-control-text-md)] rounded-[var(--ds-radius-control)]'
  }
  const activeStyles = variant === 'danger'
    ? 'text-[var(--ds-status-danger)] hover:bg-[var(--ds-status-danger-soft)] active:scale-95'
    : active
      ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:bg-[var(--ds-accent-soft)] dark:text-[var(--ds-accent-strong)] shadow-xs font-semibold'
      : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-surface-muted)] active:scale-95'

  return (
    <button
      type="button"
      title={tooltip}
      className={`inline-flex items-center justify-center transition-all cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)]/40 disabled:cursor-not-allowed disabled:opacity-40 ${sizeStyles[size]} ${activeStyles} ${className}`}
      {...props}
    >
      {icon}
    </button>
  )
}

export function DesktopInput({
  icon,
  clearable,
  onClear,
  shortcutHint,
  className = '',
  value,
  onChange,
  ...props
}: DesktopInputProps): ReactElement {
  return (
    <div className={`relative flex items-center w-full ${className}`}>
      {icon && (
        <span className="absolute left-3 text-[var(--ds-text-subtle)] dark:text-[var(--ds-text-muted)] pointer-events-none shrink-0">
          {icon}
        </span>
      )}
      <input
        type="text"
        data-ds-type="control"
        value={value}
        onChange={onChange}
        className={`w-full h-[var(--ds-control-sm)] text-[length:var(--ds-control-text-sm)] rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-subtle)] shadow-2xs focus:outline-none focus:border-[var(--ds-accent)] focus:ring-2 focus:ring-[var(--ds-accent)]/20 transition-all ${
          icon ? 'pl-8.5' : 'pl-3'
        } ${shortcutHint || clearable ? 'pr-12' : 'pr-3'}`}
        {...props}
      />
      {clearable && value && (
        <button
          type="button"
          onClick={onClear}
          className="absolute right-2.5 text-xs text-[var(--ds-text-subtle)] hover:text-[var(--ds-text-primary)] dark:hover:text-white p-0.5 rounded cursor-pointer"
        >
            <X className="h-3 w-3" />
        </button>
      )}
      {shortcutHint && !value && (
        <span className="absolute right-2.5 text-xs font-mono text-[var(--ds-text-subtle)] dark:text-[var(--ds-text-muted)] bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] px-1.5 py-0.5 rounded-md border border-[var(--ds-border)] dark:border-[var(--ds-border)] pointer-events-none">
          {shortcutHint}
        </span>
      )}
    </div>
  )
}

export function DesktopTextarea({ className = '', ...props }: DesktopTextareaProps): ReactElement {
  return (
    <textarea
      data-ds-type="body"
      className={`rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-[length:var(--ds-control-text-sm)] leading-relaxed text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-subtle)] shadow-2xs transition-colors focus:border-[var(--ds-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-accent)]/20 disabled:cursor-not-allowed disabled:bg-[var(--ds-surface-muted)] disabled:text-[var(--ds-text-muted)] ${className}`}
      {...props}
    />
  )
}

export function DesktopCard({
  children,
  selected = false,
  interactive = false,
  className = '',
  ...props
}: DesktopCardProps): ReactElement {
  return (
    <div
      className={`rounded-2xl border transition-all duration-150 ${
        selected
        ? 'bg-[var(--ds-surface)] border-[var(--ds-accent)] ring-2 ring-[var(--ds-accent)]/25 shadow-sm'
        : 'bg-[var(--ds-surface)] border-[var(--ds-border)] shadow-xs'
      } ${
        interactive
          ? 'cursor-pointer hover:border-[var(--ds-accent)]/60 dark:hover:border-[var(--ds-accent-strong)]/60 hover:shadow-md hover:-translate-y-0.5 active:scale-[0.99] active:translate-y-0'
          : ''
      } ${className}`}
      {...props}
    >
      {children}
    </div>
  )
}

export function DesktopCardButton({ selected = false, className = '', disabled, ...props }: DesktopCardButtonProps): ReactElement {
  return (
    <button
      type="button"
      disabled={disabled}
      className={`min-w-0 rounded-[var(--ds-radius-card)] border text-left transition-colors duration-150 focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-focus-ring)] disabled:cursor-not-allowed disabled:opacity-50 ${selected ? 'border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] ring-1 ring-[var(--ds-focus-ring)]' : 'border-[var(--ds-border)] bg-[var(--ds-surface)] hover:border-[var(--ds-accent)]/60'} ${className}`}
      {...props}
    />
  )
}

export function DesktopTagPill({
  label,
  variant = 'blue',
  className = '',
  onClick
}: DesktopTagPillProps): ReactElement {
  const pillVariants: Record<string, string> = {
    blue: 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] border-[var(--ds-accent)]/20',
    amber:
      'bg-[var(--ds-status-warning-soft)] text-[var(--ds-status-warning)] border-[var(--ds-status-warning)]/25',
    emerald:
      'bg-[var(--ds-status-success-soft)] text-[var(--ds-status-success)] border-[var(--ds-status-success)]/25',
    rose: 'bg-[var(--ds-status-danger-soft)] text-[var(--ds-status-danger)] border-[var(--ds-status-danger)]/25',
    neutral: 'bg-[var(--ds-surface-muted)] text-[var(--ds-text-secondary)] border-[var(--ds-border)]'
  }

  return (
    <span
      data-ds-type="label"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 px-2.5 py-0.5 rounded-full text-xs font-medium border leading-none transition-all ${
        pillVariants[variant] || pillVariants.neutral
      } ${onClick ? 'cursor-pointer hover:brightness-95 active:scale-95' : ''} ${className}`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current opacity-90" />
      <span>{label}</span>
    </span>
  )
}

export function DesktopTab({
  label,
  icon,
  badge,
  active = false,
  tone = 'pill',
  onClick,
  className = '',
  title
}: DesktopTabProps): ReactElement {
  const toneStyles =
    tone === 'solid'
      ? active
        ? 'bg-[var(--ds-accent)] text-white shadow-2xs'
        : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] hover:bg-[var(--ds-surface-muted)] dark:hover:bg-[var(--ds-surface-muted)] dark:text-[var(--ds-text-subtle)] dark:hover:text-white'
      : active
        ? 'bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)] shadow-2xs border border-[var(--ds-accent)]/30'
        : 'text-[var(--ds-text-muted)] hover:text-[var(--ds-text-primary)] dark:text-[var(--ds-text-subtle)] dark:hover:text-white border border-transparent'

  return (
    <button
      type="button"
      onClick={onClick}
      title={title}
      aria-pressed={active}
      data-ds-type="label"
      className={`flex items-center gap-1.5 px-3 py-1 text-xs font-semibold rounded-full transition-all cursor-pointer whitespace-nowrap ${toneStyles} ${className}`}
    >
      {icon && <span className="w-3.5 h-3.5 shrink-0">{icon}</span>}
      <span className="truncate">{label}</span>
      {badge !== undefined && (
        <span className="px-1.5 py-0.2 text-xs font-mono rounded-full bg-[var(--ds-badge-surface)]">
          {badge}
        </span>
      )}
    </button>
  )
}

export function DesktopSelect({
  value,
  options,
  onChange,
  icon,
  title,
  className = '',
  ...props
}: DesktopSelectProps): ReactElement {
  return (
    <div
      className={`relative inline-flex items-center h-[var(--ds-control-sm)] rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] bg-[var(--ds-surface)] text-[length:var(--ds-control-text-sm)] shadow-2xs ${className}`}
    >
      {icon && (
        <span className="absolute left-2.5 text-[var(--ds-text-subtle)] pointer-events-none">{icon}</span>
      )}
      <select
        value={value}
        title={title}
        onChange={(event) => onChange(event.target.value)}
        className={`h-full w-full appearance-none bg-transparent text-[var(--ds-text-primary)] cursor-pointer focus:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ds-accent)]/30 rounded-md ${
          icon ? 'pl-8' : 'pl-3'
        } pr-7`}
        {...props}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
      <ChevronDown className="absolute right-2 w-3.5 h-3.5 text-[var(--ds-text-subtle)] pointer-events-none" />
    </div>
  )
}
