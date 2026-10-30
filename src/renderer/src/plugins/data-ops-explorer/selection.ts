import type { MouseEvent } from 'react'
import type { SelectionMode } from './store'

export function selectionModeFromEvent(event: MouseEvent): SelectionMode {
  if (event.metaKey || event.ctrlKey) return 'toggle'
  if (event.shiftKey) return 'range'
  return 'replace'
}
