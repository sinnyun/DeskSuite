import { Terminal } from 'lucide-react'
import { definePlugin } from '../../workbench/sdk'
import { DebugConsoleActivity } from './components/DebugConsoleActivity'
import { ConsolePanel } from './components/ConsolePanel'
import { ConsoleTabLabel } from './components/ConsoleTabLabel'
import { ConsoleToolbar } from './components/ConsoleToolbar'
import { ConsoleStatus } from './components/ConsoleStatus'

export default definePlugin({
  id: 'system-basic-debug-console',
  name: '调试控制台',
  version: '1.0.0',
  description: '汇集渲染进程与主进程日志，提供活动栏入口、底部抽屉、级别筛选、搜索、导出与状态计数',
  author: 'DeskSuite 内置',
  contributions: [
    {
      id: 'console.activity',
      slotId: 'sidebar.activity',
      order: 30,
      component: DebugConsoleActivity
    },
    {
      id: 'console',
      slotId: 'bottom.tabs',
      order: 10,
      title: '调试控制台',
      icon: <Terminal className="w-3.5 h-3.5" />,
      label: ConsoleTabLabel
    },
    {
      id: 'console',
      slotId: 'bottom.content',
      order: 10,
      component: ConsolePanel
    },
    {
      id: 'console.toolbar',
      slotId: 'bottom.toolbar',
      order: 10,
      component: ConsoleToolbar
    },
    {
      id: 'console.status',
      slotId: 'statusbar.right',
      order: 10,
      component: ConsoleStatus
    }
  ]
})
