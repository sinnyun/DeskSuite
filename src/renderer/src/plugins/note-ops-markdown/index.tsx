import { definePlugin, log } from '../../workbench/sdk'
import { NotesActivity } from './NotesActivity'
import { NotesPanel } from './NotesPanel'

export default definePlugin({
  id: 'note-ops-markdown',
  name: 'Markdown 笔记',
  version: '1.0.0',
  description: '编辑、预览和整理本地 Markdown 笔记',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'notes.activity', slotId: 'sidebar.activity', order: 38, component: NotesActivity },
    { id: 'notes.panel', slotId: 'floating.panels', order: 36, component: NotesPanel }
  ],
  setup: () => {
    log('lifecycle', 'Notes', 'Markdown 笔记插件已加载')
  }
})
