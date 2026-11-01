import { definePlugin, log } from '../../workbench/sdk'
import { DebugConsoleActivity } from './components/DebugConsoleActivity'
import { ConsolePanel } from './components/ConsolePanel'
import { ConsoleStatus } from './components/ConsoleStatus'
import { consoleViewCommandSchema, consoleViewStore } from './view'

export default definePlugin({
  id: 'system-basic-debug-console',
  name: '调试控制台',
  version: '1.0.0',
  description: '汇集操作、IPC、广播与 MCP 调用链，提供分类筛选、载荷检查、搜索与导出',
  author: 'DeskSuite 内置',
  contributions: [
    {
      id: 'console.activity',
      slotId: 'sidebar.activity',
      order: 30,
      component: DebugConsoleActivity
    },
    {
      id: 'debug-console.panel',
      slotId: 'floating.panels',
      order: 88,
      component: ConsolePanel
    },
    {
      id: 'console.status',
      slotId: 'statusbar.right',
      order: 10,
      component: ConsoleStatus
    }
  ],
  setup: () => window.bridge.onEvent((channel, payload) => {
    if (channel !== 'debug-console:view') return
    const parsed = consoleViewCommandSchema.safeParse(payload)
    if (!parsed.success) {
      log('warn', 'DebugConsole', '收到无效的调试面板筛选指令', { issues: parsed.error.issues.map((issue) => issue.message) })
      return
    }
    consoleViewStore.applyCommand(parsed.data)
  })
})
