import { definePlugin } from '../../workbench/sdk'
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
  ]
})
