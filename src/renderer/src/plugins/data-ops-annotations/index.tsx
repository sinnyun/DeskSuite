import { Tags } from 'lucide-react'
import { definePlugin, log } from '../../workbench/sdk'
import { TagPage } from './TagPage'
import { annotationStore } from './service'

export default definePlugin({
  id: 'data-ops-annotations',
  name: '收藏与标签',
  version: '1.0.0',
  description: '管理收藏、评分、备注与层级标签',
  author: 'DeskSuite 内置',
  contributions: [
    {
      id: 'annotations',
      slotId: 'sidebar.left.tabs',
      order: 30,
      title: '标签',
      icon: <Tags className="w-3.5 h-3.5" />
    },
    {
      id: 'annotations',
      slotId: 'sidebar.left.content',
      order: 30,
      component: TagPage
    }
  ],
  services: { annotations: annotationStore },
  setup: () => {
    const dispose = annotationStore.start()
    log('lifecycle', 'Annotations', '收藏与标签服务已加载')
    return dispose
  }
})
