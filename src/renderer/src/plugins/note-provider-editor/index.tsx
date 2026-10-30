import { definePlugin } from '../../workbench/sdk'
import { NoteEditor } from './NoteEditor'

export default definePlugin({
  id: 'note-provider-editor',
  name: '笔记编辑器内核',
  version: '1.0.0',
  description: '以 Milkdown Crepe 向笔记界面提供所见即所得的 Markdown 编辑组件',
  author: 'DeskSuite 内置',
  services: {
    noteEditor: NoteEditor
  }
})
