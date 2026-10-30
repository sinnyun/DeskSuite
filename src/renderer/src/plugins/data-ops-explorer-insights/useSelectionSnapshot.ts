import { useSyncExternalStore } from 'react'
import { getService, type SelectionService, type SelectionSnapshot } from '../../workbench/sdk'

const EMPTY: SelectionSnapshot = { path: null, entries: [], selected: [] }

function noopSubscribe(): () => void {
  return () => {}
}

function emptySnapshot(): SelectionSnapshot {
  return EMPTY
}

export function useSelectionSnapshot(): SelectionSnapshot {
  const service = getService<SelectionService>('selection')
  return useSyncExternalStore(
    service ? service.subscribe : noopSubscribe,
    service ? service.getSnapshot : emptySnapshot
  )
}
