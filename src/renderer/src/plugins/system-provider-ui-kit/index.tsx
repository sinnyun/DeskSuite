import { definePlugin, getService } from '../../workbench/sdk'
import type { ContextMenuService } from '../../workbench/sdk'
import { DialogHost } from './dialog'
import { uiKit } from './kit'

export default definePlugin({
  id: 'system-provider-ui-kit',
  name: '公共 UI 原语',
  version: '1.0.0',
  description: '向其他渲染层插件提供按钮、输入、下拉、页签、标签、侧栏/工作区/悬浮面板等主题化 UI 原语',
  author: 'DeskSuite 内置',
  core: true,
  contributions: [
    {
      id: 'ui-kit.dialogs',
      slotId: 'overlay.root',
      order: 40,
      component: DialogHost
    }
  ],
  services: {
    ui: uiKit
  },
  setup: setupUiKit
})

function setupUiKit(): (() => void) | undefined {
  const contextMenu = getService<ContextMenuService>('contextMenu')
  if (!contextMenu) return undefined
  return contextMenu.register('ui.panel', ({ target }) => {
    const header = target.closest('[data-context-zone="ui.panel"]')
    if (!header) return null
    const title = header.getAttribute('data-panel-title') ?? ''
    return [
      {
        id: 'close-panel',
        label: '关闭面板',
        shortcut: 'Esc',
        onSelect: () => {
          header.querySelector<HTMLButtonElement>('[data-panel-close]')?.click()
        }
      },
      {
        id: 'copy-panel-title',
        label: '复制面板标题',
        disabled: !title,
        onSelect: () => {
          void navigator.clipboard.writeText(title)
        }
      }
    ]
  })
}
