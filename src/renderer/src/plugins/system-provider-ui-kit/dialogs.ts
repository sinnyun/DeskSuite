import type { DesktopPromptOptions } from '../../workbench/sdk'

interface PendingPrompt {
  options: DesktopPromptOptions
  resolve: (value: string | null) => void
}

let queue: PendingPrompt[] = []
const listeners = new Set<() => void>()

export function subscribeDialogs(listener: () => void): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getActivePrompt(): PendingPrompt | null {
  return queue[0] ?? null
}

function emit(): void {
  for (const listener of listeners) listener()
}

export function openPrompt(options: DesktopPromptOptions): Promise<string | null> {
  return new Promise((resolve) => {
    queue = [...queue, { options, resolve }]
    emit()
  })
}

export function finishPrompt(value: string | null): void {
  const current = queue[0]
  if (!current) return
  queue = queue.slice(1)
  emit()
  current.resolve(value)
}
