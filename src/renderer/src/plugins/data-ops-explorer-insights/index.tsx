import { definePlugin, log } from '../../workbench/sdk'
import { basketStore } from './basket'
import { InsightsActivities } from './components/InsightsActivities'
import { AnalyticsPanel } from './components/AnalyticsPanel'
import { BasketPanel } from './components/BasketPanel'

export default definePlugin({
  id: 'data-ops-explorer-insights',
  name: '资产统计与暂存篮',
  version: '1.0.0',
  description: '基于 selection 服务的目录统计面板与跨会话文件暂存篮，提供 basket 服务',
  contributions: [
    {
      id: 'insights.activity',
      slotId: 'sidebar.activity',
      order: 20,
      component: InsightsActivities
    },
    {
      id: 'analytics.panel',
      slotId: 'floating.panels',
      order: 20,
      component: AnalyticsPanel
    },
    {
      id: 'basket.panel',
      slotId: 'floating.panels',
      order: 21,
      component: BasketPanel
    }
  ],
  services: {
    basket: basketStore
  },
  setup: () => {
    log('lifecycle', 'Insights', '资产统计与暂存篮插件已加载', { basketItems: basketStore.list().length })
  }
})
