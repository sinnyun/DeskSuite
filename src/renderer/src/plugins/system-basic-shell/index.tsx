import { definePlugin, getService, layoutStore, themeStore } from '../../workbench/sdk'
import type { ContextMenuEntry, ContextMenuService } from '../../workbench/sdk'
import { WorkbenchShell } from './components/WorkbenchShell'

export default definePlugin({
  id: 'system-basic-shell',
  name: '工作台外壳框架',
  version: '1.0.0',
  description: '顶栏、活动栏、左右侧栏、中央工作区、底部抽屉、状态栏与分栏拖拽骨架',
  author: 'DeskSuite 内置',
  core: true,
  contributions: [
    {
      id: 'shell.root',
      slotId: 'app.root',
      order: 0,
      component: WorkbenchShell
    }
  ],
  setup: setupShellMenus
})

function setupShellMenus(): (() => void) | undefined {
  const contextMenu = getService<ContextMenuService>('contextMenu')
  if (!contextMenu) return undefined

  const disposers = [
    contextMenu.register('shell.top', ({ target }) => {
      if (!target.closest('[data-context-zone="shell.top"]')) return null
      const layout = layoutStore.getState()
      const entries: ContextMenuEntry[] = [
        { id: 'palette', label: '命令面板', shortcut: 'Ctrl+K', onSelect: () => layoutStore.getState().openFloatingPanel('commands') },
        { id: 'settings', label: '打开设置', shortcut: 'Ctrl+,', onSelect: () => layoutStore.getState().openFloatingPanel('settings') },
        { id: 'launcher', label: '打开启动台', shortcut: 'Ctrl+Shift+P', onSelect: () => layoutStore.getState().openFloatingPanel('launcher') },
        { separator: true },
        { id: 'toggle-left', label: layout.leftCollapsed ? '展开左侧栏' : '折叠左侧栏', shortcut: 'Ctrl+B', onSelect: () => layoutStore.getState().toggleLeftCollapsed() },
        { id: 'toggle-right', label: layout.rightCollapsed ? '展开右侧栏' : '折叠右侧栏', shortcut: 'Ctrl+Shift+B', onSelect: () => layoutStore.getState().toggleRightCollapsed() },
        { id: 'toggle-bottom', label: layout.bottomCollapsed ? '展开底部坞' : '折叠底部坞', shortcut: 'Ctrl+J', onSelect: () => layoutStore.getState().toggleBottomCollapsed() },
        { separator: true },
        { id: 'toggle-zen', label: '切换专注模式', shortcut: 'F11', checked: layout.zenMode, onSelect: () => layoutStore.getState().toggleZenMode() },
        { id: 'toggle-theme', label: '切换明暗主题', shortcut: 'Ctrl+Shift+L', checked: themeStore.getState().mode === 'dark', onSelect: () => themeStore.getState().setMode(themeStore.getState().mode === 'dark' ? 'light' : 'dark') },
        { id: 'reset-layout', label: '重置工作台布局', shortcut: 'Ctrl+Alt+R', onSelect: () => layoutStore.getState().resetLayout() },
        { separator: true },
        { id: 'reload-renderer', label: '重新载入界面', shortcut: 'Ctrl+R', danger: true, onSelect: () => window.location.reload() }
      ]
      return entries
    }),
    contextMenu.register('shell.activity', ({ target }) => {
      if (!target.closest('[data-context-zone="shell.activity"]')) return null
      const hit = target.closest('[data-activity-label]')
      const label = hit?.getAttribute('data-activity-label') ?? ''
      const entries: ContextMenuEntry[] = []
      if (hit instanceof HTMLElement && label) {
        entries.push({
          id: 'toggle-activity',
          label: hit.getAttribute('aria-pressed') === 'true' ? `隐藏「${label}」` : `打开「${label}」`,
          onSelect: () => hit.click()
        }, { separator: true })
      }
      entries.push(
        { id: 'toggle-left', label: layoutStore.getState().leftCollapsed ? '展开左侧栏' : '折叠左侧栏', shortcut: 'Ctrl+B', onSelect: () => layoutStore.getState().toggleLeftCollapsed() },
        { id: 'palette', label: '打开命令面板', shortcut: 'Ctrl+K', onSelect: () => layoutStore.getState().openFloatingPanel('commands') }
      )
      return entries
    }),
    contextMenu.register('shell.tabs', ({ target }) => {
      if (!target.closest('[data-context-zone="shell.tabs"]')) return null
      const region = target.closest('[data-sidebar-region]')?.getAttribute('data-sidebar-region') ?? 'left'
      const tabId = target.closest('[data-tab-id]')?.getAttribute('data-tab-id') ?? ''
      const layout = layoutStore.getState()
      const entries: ContextMenuEntry[] = []
      if (tabId) {
        entries.push({
          id: 'open-tab',
          label: '切换到此页签',
          onSelect: () => {
            if (region === 'right') layoutStore.getState().openRightTab(tabId)
            else if (region === 'bottom') layoutStore.getState().openBottomTab(tabId)
            else layoutStore.getState().openLeftTab(tabId)
          }
        }, { separator: true })
      }
      if (region === 'bottom') {
        entries.push({ id: 'toggle-dock', label: layout.bottomCollapsed ? '展开底部坞' : '折叠底部坞', shortcut: 'Ctrl+J', onSelect: () => layoutStore.getState().toggleBottomCollapsed() })
      } else {
        entries.push({ id: 'toggle-sidebar', label: layout[region === 'right' ? 'rightCollapsed' : 'leftCollapsed'] ? '展开侧栏' : '折叠侧栏', shortcut: region === 'right' ? 'Ctrl+Shift+B' : 'Ctrl+B', onSelect: () => (region === 'right' ? layoutStore.getState().toggleRightCollapsed() : layoutStore.getState().toggleLeftCollapsed()) })
      }
      entries.push({ id: 'reset-layout', label: '重置工作台布局', shortcut: 'Ctrl+Alt+R', onSelect: () => layoutStore.getState().resetLayout() })
      return entries
    })
  ]

  return () => {
    for (const dispose of disposers) dispose()
  }
}
