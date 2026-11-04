import { useEffect, useState, useSyncExternalStore } from 'react'
import type { FormEvent, KeyboardEvent, ReactElement } from 'react'
import type { DesktopPromptOptions } from '../../workbench/sdk'
import { DesktopButton } from './components'
import { finishPrompt, getActivePrompt, subscribeDialogs } from './dialogs'

export function DialogHost(): ReactElement | null {
  const pending = useSyncExternalStore(subscribeDialogs, getActivePrompt)
  const [value, setValue] = useState('')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setValue(pending?.options.value ?? '')
    setError(null)
  }, [pending])

  useEffect(() => {
    if (!pending) return
    const onKey = (event: globalThis.KeyboardEvent): void => {
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finishPrompt(null)
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [pending])

  if (!pending) return null
  const options: DesktopPromptOptions = pending.options

  const submit = (): void => {
    const text = value.trim()
    if (options.validate) {
      const problem = options.validate(text)
      if (problem) {
        setError(problem)
        return
      }
    }
    finishPrompt(text)
  }

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement | HTMLTextAreaElement>): void => {
    if (event.key === 'Enter' && !event.shiftKey && !options.multiline) {
      event.preventDefault()
      submit()
    }
  }

  return (
    <div className="pointer-events-auto fixed inset-0 z-[140] flex items-center justify-center bg-black/35 p-4" data-prompt-open="true">
      <form
        onSubmit={(event: FormEvent) => {
          event.preventDefault()
          submit()
        }}
        className="flex w-[440px] max-w-[calc(100vw-32px)] flex-col gap-3 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-4 shadow-2xl dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"
      >
        <h2 className="text-sm font-semibold" data-prompt-title={options.title}>{options.title}</h2>
        {options.label && <label className="text-xs text-[var(--ds-text-muted)]">{options.label}</label>}
        {options.multiline ? (
          <textarea
            autoFocus
            data-prompt-input="true"
            value={value}
            placeholder={options.placeholder}
            rows={5}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="w-full resize-none rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-subtle)] shadow-2xs focus:border-[var(--ds-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-accent)]/20 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"
          />
        ) : (
          <input
            autoFocus
            data-prompt-input="true"
            value={value}
            placeholder={options.placeholder}
            onFocus={(event) => event.target.select()}
            onChange={(event) => setValue(event.target.value)}
            onKeyDown={onKeyDown}
            className="h-[var(--ds-control-md)] w-full rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-sm text-[var(--ds-text-primary)] placeholder:text-[var(--ds-text-subtle)] shadow-2xs focus:border-[var(--ds-accent)] focus:outline-none focus:ring-2 focus:ring-[var(--ds-accent)]/20 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"
          />
        )}
        {error && <p role="alert" className="text-xs text-[var(--ds-status-danger)]">{error}</p>}
        <div className="flex justify-end gap-2">
          <DesktopButton type="button" size="sm" onClick={() => finishPrompt(null)}>取消</DesktopButton>
          <DesktopButton type="submit" size="sm" variant="primary">{options.confirmText ?? '确定'}</DesktopButton>
        </div>
      </form>
    </div>
  )
}
