import { createContext, useContext } from 'react'
import type { ReactElement, ReactNode } from 'react'
import type { ExplorerStore } from './store'

const PaneStoreContext = createContext<ExplorerStore | null>(null)

export function PaneStoreProvider({
  store,
  children
}: {
  store: ExplorerStore
  children: ReactNode
}): ReactElement {
  return <PaneStoreContext.Provider value={store}>{children}</PaneStoreContext.Provider>
}

export function usePaneStoreContext(): ExplorerStore | null {
  return useContext(PaneStoreContext)
}
