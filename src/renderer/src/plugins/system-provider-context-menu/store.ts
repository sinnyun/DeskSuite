import type { ContextMenuContext, ContextMenuEntry, ContextMenuZoneHandler } from '../../workbench/sdk'

interface RegisteredHandler {
  handler: ContextMenuZoneHandler
  order: number
}

const zoneHandlers = new Map<string, RegisteredHandler[]>()

export function registerZoneHandler(zoneId: string, handler: ContextMenuZoneHandler, order = 100): () => void {
  const list = zoneHandlers.get(zoneId) ?? []
  list.push({ handler, order })
  zoneHandlers.set(zoneId, list)
  return () => {
    const current = zoneHandlers.get(zoneId)
    if (!current) return
    const next = current.filter((item) => item.handler !== handler)
    if (next.length) zoneHandlers.set(zoneId, next)
    else zoneHandlers.delete(zoneId)
  }
}

export function hasZoneHandler(zoneId: string): boolean {
  return (zoneHandlers.get(zoneId)?.length ?? 0) > 0
}

export function collectZoneEntries(context: ContextMenuContext): ContextMenuEntry[] {
  const list = [...(zoneHandlers.get(context.zoneId) ?? [])].sort((a, b) => a.order - b.order)
  const entries: ContextMenuEntry[] = []
  for (const { handler } of list) {
    let produced: ContextMenuEntry[] | null = null
    try {
      produced = handler(context)
    } catch (error) {
      console.error(`[context-menu] zone handler failed: ${context.zoneId}`, error)
    }
    if (produced && produced.length > 0) {
      if (entries.length > 0) entries.push({ separator: true })
      entries.push(...produced)
    }
  }
  return entries
}

export interface ContextMenuState {
  seq: number
  zoneId: string
  x: number
  y: number
  entries: ContextMenuEntry[]
  target: Element
}

let menuState: ContextMenuState | null = null
const menuListeners = new Set<() => void>()

function emit(): void {
  for (const listener of menuListeners) listener()
}

export function getMenuState(): ContextMenuState | null {
  return menuState
}

export function subscribeMenu(listener: () => void): () => void {
  menuListeners.add(listener)
  return () => menuListeners.delete(listener)
}

export function openContextMenu(zoneId: string, x: number, y: number, entries: ContextMenuEntry[], target: Element): void {
  menuState = { seq: (menuState?.seq ?? 0) + 1, zoneId, x, y, entries, target }
  emit()
}

export function closeContextMenu(): void {
  if (!menuState) return
  menuState = null
  emit()
}
