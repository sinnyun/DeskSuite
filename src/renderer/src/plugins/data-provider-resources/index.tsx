import { definePlugin } from '../../workbench/sdk'
import { resources } from './resources'

export default definePlugin({
  id: 'data-provider-resources', name: '统一资源链接', version: '1.0.0', core: true,
  description: '本地资源身份、统一链接及 Leafer 图片加载租约', author: 'DeskSuite 内置',
  services: { resources }
})
