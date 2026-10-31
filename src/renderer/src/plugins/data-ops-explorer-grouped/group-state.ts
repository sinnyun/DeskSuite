import { createStore } from 'zustand/vanilla'

export type GroupBy = 'kind' | 'modifiedMinute' | 'rating' | 'folder'

export interface GroupOptions {
  groupBy: GroupBy
  includeChildren: boolean
}

interface GroupOptionsState extends GroupOptions {
  set(patch: Partial<GroupOptions>): void
}

export const groupOptionsStore = createStore<GroupOptionsState>((set) => ({
  groupBy: 'kind',
  includeChildren: false,
  set: (patch) => set(patch)
}))

export function getGroupOptions(): GroupOptions {
  const { groupBy, includeChildren } = groupOptionsStore.getState()
  return { groupBy, includeChildren }
}
