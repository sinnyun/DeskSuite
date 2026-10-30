import { definePlugin, log } from '../../workbench/sdk'
import { WhiteboardActivity } from './WhiteboardActivity'
import { WhiteboardPanel } from './WhiteboardPanel'

export default definePlugin({
  id: 'canvas-ops-whiteboard',
  name: '白板',
  version: '2.0.0',
  description: 'LeaferJS 资源画板，支持图形、图片、视频与持久化',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'whiteboard.activity', slotId: 'sidebar.activity', order: 32, component: WhiteboardActivity },
    { id: 'whiteboard.panel', slotId: 'floating.panels', order: 34, component: WhiteboardPanel }
  ],
  setup: () => {
    log('lifecycle', 'Whiteboard', '白板插件已加载')
  }
})
