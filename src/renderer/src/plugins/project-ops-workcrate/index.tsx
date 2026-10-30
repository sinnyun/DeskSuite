import { definePlugin, log } from '../../workbench/sdk'
import { WorkCrateActivity } from './WorkCrateActivity'
import { WorkCratePanel } from './WorkCratePanel'

export default definePlugin({
  id: 'project-ops-workcrate',
  name: 'WorkCrate 工程资料箱',
  version: '1.0.0',
  description: '管理便携工程、原始文件引用、封面和项目资料',
  contributions: [
    { id: 'workcrate.activity', slotId: 'sidebar.activity', order: 55, component: WorkCrateActivity },
    { id: 'workcrate.panel', slotId: 'floating.panels', order: 55, component: WorkCratePanel }
  ],
  setup: () => { log('lifecycle', 'WorkCrate', 'WorkCrate 工程资料箱已加载') }
})
