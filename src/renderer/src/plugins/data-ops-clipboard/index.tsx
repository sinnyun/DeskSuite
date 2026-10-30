import { definePlugin, log } from '../../workbench/sdk'
import { ClipboardActivity } from './components/ClipboardActivity'
import { ClipboardPanel } from './components/ClipboardPanel'

export default definePlugin({
  id: 'data-ops-clipboard',
  name: '剪贴板工作台',
  version: '1.0.0',
  description: '读取/写入系统剪贴板，支持图片、收藏与持久化分类历史',
  contributions: [
    {
      id: 'clipboard.activity',
      slotId: 'sidebar.activity',
      order: 40,
      component: ClipboardActivity
    },
    {
      id: 'clipboard.panel',
      slotId: 'floating.panels',
      order: 22,
      component: ClipboardPanel
    }
  ],
  setup: () => {
    log('lifecycle', 'Clipboard', '剪贴板工作台插件已加载')
  }
})
