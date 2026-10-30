import { definePlugin } from '../../workbench/sdk'
import { WindowControls } from './components/WindowControls'

export default definePlugin({
  id: 'system-basic-window-controls',
  name: '窗口控制按钮',
  version: '1.0.0',
  description: '无边框窗口的最小化/最大化/关闭按钮，并同步窗口状态',
  contributions: [
    {
      id: 'window.controls',
      slotId: 'top.window_controls',
      order: 10,
      component: WindowControls
    }
  ]
})
