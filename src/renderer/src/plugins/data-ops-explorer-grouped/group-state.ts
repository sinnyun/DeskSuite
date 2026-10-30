export type GroupBy = 'kind' | 'modifiedMinute' | 'rating' | 'folder'

export interface GroupOptions {
  groupBy: GroupBy
  includeChildren: boolean
}

const listeners = new Set<() => void>()
let snapshot: GroupOptions = { groupBy: 'kind', includeChildren: false }

export const groupOptionsStore = {
  getSnapshot: (): GroupOptions => snapshot,
  subscribe(listener: () => void): () => void {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  set(patch: Partial<GroupOptions>): void {
    snapshot = { ...snapshot, ...patch }
    for (const listener of listeners) listener()
  }
}
