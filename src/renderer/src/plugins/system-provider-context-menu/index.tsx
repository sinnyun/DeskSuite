import { definePlugin } from '../../workbench/sdk'
import type { ContextMenuContext, ContextMenuEntry, ContextMenuService } from '../../workbench/sdk'
import { DESKTOP_MENU_ZONE, TEXT_MENU_ZONE, desktopMenuEntries, isEditableTarget, textMenuEntries } from './builtin'
import { ContextMenuOverlay } from './overlay'
import { closeContextMenu, collectZoneEntries, getMenuState, openContextMenu, registerZoneHandler } from './store'

const contextMenuService: ContextMenuService = {
  register: (zoneId, handler, options) => registerZoneHandler(zoneId, handler, options?.order ?? 100),
  open: (zoneId, x, y, context) => {
    const target = context?.target ?? document.elementFromPoint(x, y) ?? document.body
    const request: ContextMenuContext = { zoneId, target, clientX: x, clientY: y }
    const entries = collectZoneEntries(request)
    if (!entries.length) return false
    openContextMenu(zoneId, x, y, entries, target)
    return true
  }
}

export default definePlugin({
  id: 'system-provider-context-menu',
  name: '右键菜单引擎',
  version: '1.0.0',
  description: '提供全局右键菜单引擎：区域注册、组合式菜单构建、键盘导航与内置兜底菜单',
  author: 'DeskSuite 内置',
  core: true,
  contributions: [
    {
      id: 'context-menu.overlay',
      slotId: 'overlay.root',
      order: 30,
      component: ContextMenuOverlay
    }
  ],
  services: {
    contextMenu: contextMenuService
  },
  setup: setupContextMenuEngine
})

function setupContextMenuEngine(): () => void {
  const onContextMenu = (event: MouseEvent): void => {
    if (!(event.target instanceof Element)) return
    if (getMenuState() && event.target.closest('[data-context-menu-level]')) {
      event.preventDefault()
      closeContextMenu()
      return
    }
    const zoneEl = event.target.closest('[data-context-zone]')
    const zoneId = zoneEl?.getAttribute('data-context-zone') ?? ''
    const context: ContextMenuContext = {
      zoneId: zoneId || DESKTOP_MENU_ZONE,
      target: event.target,
      clientX: event.clientX,
      clientY: event.clientY
    }
    let entries: ContextMenuEntry[] = zoneId ? collectZoneEntries(context) : []
    if (!entries.length) entries = collectZoneEntries({ ...context, zoneId: TEXT_MENU_ZONE })
    if (!entries.length && isEditableTarget(event.target)) entries = textMenuEntries(event.target)
    if (!entries.length) entries = collectZoneEntries({ ...context, zoneId: DESKTOP_MENU_ZONE })
    if (!entries.length) {
      event.preventDefault()
      return
    }
    event.preventDefault()
    openContextMenu(context.zoneId, event.clientX, event.clientY, entries, event.target)
  }

  const offDesktopFallback = registerZoneHandler(DESKTOP_MENU_ZONE, () => desktopMenuEntries())

  document.addEventListener('contextmenu', onContextMenu, true)

  const offDebugChannel = window.bridge.onEvent((channel, payload) => {
    if (channel !== 'dev:context-menu') return
    const data = payload as { zoneId?: string; x?: number; y?: number; selector?: string }
    if (!data?.zoneId) return
    const x = typeof data.x === 'number' ? data.x : Math.round(window.innerWidth / 2) - 90
    const y = typeof data.y === 'number' ? data.y : Math.round(window.innerHeight / 2) - 60
    const zoneEl = document.querySelector(`[data-context-zone="${CSS.escape(data.zoneId)}"]`)
    const selectorEl = data.selector ? document.querySelector(data.selector) : null
    const target = selectorEl ?? zoneEl ?? document.elementFromPoint(x, y) ?? document.body
    if (contextMenuService.open(data.zoneId, x, y, { target })) return
    contextMenuService.open(DESKTOP_MENU_ZONE, x, y)
  })

  return () => {
    document.removeEventListener('contextmenu', onContextMenu, true)
    offDebugChannel()
    offDesktopFallback()
    closeContextMenu()
  }
}
