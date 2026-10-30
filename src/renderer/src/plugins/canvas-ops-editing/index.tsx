import { definePlugin } from '../../workbench/sdk'
import { getCanvas } from './contract'
import { registerEditing } from './commands'

export default definePlugin({
  id: 'canvas-ops-editing',
  name: '画板编辑工具',
  version: '2.0.0',
  author: 'DeskSuite 内置',
  description: '图形、文本、分组、排列、参考线、书签与裁剪命令',
  setup: () => {
    const canvas = getCanvas()
    return canvas ? registerEditing(canvas) : undefined
  }
})
