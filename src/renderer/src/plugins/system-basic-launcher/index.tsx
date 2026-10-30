import { definePlugin, log } from '../../workbench/sdk'
import { LauncherActivity } from './LauncherActivity'
import { LauncherPanel } from './LauncherPanel'

export default definePlugin({
  id: 'system-basic-launcher',
  name: '应用启动台',
  version: '1.0.0',
  description: '搜索并启动开始菜单快捷方式与已安装应用',
  contributions: [
    { id: 'launcher.activity', slotId: 'sidebar.activity', order: 45, component: LauncherActivity },
    { id: 'launcher.panel', slotId: 'floating.panels', order: 25, component: LauncherPanel }
  ],
  setup: () => { log('lifecycle', 'Launcher', '应用启动台插件已加载') }
})
