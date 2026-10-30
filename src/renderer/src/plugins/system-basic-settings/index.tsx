import { definePlugin } from '../../workbench/sdk'
import { SettingsActivity } from './settings'
import { SettingsPanel } from './settings'

export default definePlugin({
  id: 'system-basic-settings',
  name: '设置',
  version: '1.0.0',
  description: '按主进程 Zod schema 展示并保存程序设置',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'settings.open', slotId: 'sidebar.activity.bottom', order: 100, component: SettingsActivity },
    { id: 'settings.panel', slotId: 'floating.panels', order: 90, component: SettingsPanel }
  ]
})
