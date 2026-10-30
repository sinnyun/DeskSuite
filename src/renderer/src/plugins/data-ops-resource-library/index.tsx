import { definePlugin } from '../../workbench/sdk'
import { ResourceActivity, ResourcePanel } from './ResourcePanel'

export default definePlugin({
  id: 'data-ops-resource-library', name: '资源链接', version: '1.0.0',
  description: '登记本地资源，查看统一链接及图片/音视频加载结果', author: 'DeskSuite 内置',
  contributions: [
    { id: 'resources.activity', slotId: 'sidebar.activity', order: 34, component: ResourceActivity },
    { id: 'resources.panel', slotId: 'floating.panels', order: 35, component: ResourcePanel }
  ]
})
