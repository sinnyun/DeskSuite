import { call, definePlugin, getService } from '../../workbench/sdk'
import { EagleInspector } from './Inspector'
import type { Canvas, EagleSource } from './contract'

export default definePlugin({
  id: 'canvas-ext-eagle', name: 'Eagle 画板图片', version: '1.0.0', author: 'DeskSuite 内置',
  description: '拖入 Eagle 原图、读取来源信息、在 Eagle 中定位；复用统一资源链接',
  setup() {
    const board = getService<Canvas>('canvas')
    if (!board) return
    const selectedReference = (args: Record<string, unknown>): string => {
      const snapshot = board.getSnapshot()
      const node = snapshot.scene.nodes.find(n => n.id === (args.id ?? snapshot.selection[0]))
      const reference = String(args.reference ?? node?.resource ?? '')
      if (!reference) throw new Error('请选择一张 Eagle 图片')
      return reference
    }
    const cleanup = [
      board.registerInspector('eagle', EagleInspector),
      board.registerResourceEnricher('eagle', async reference => {
        const source = await call<EagleSource | null>('eagleLinks', 'inspect', reference)
        return source ? { name: source.name.slice(0, 300), tags: source.tags.slice(0, 50).map(tag => tag.slice(0, 100)) } : undefined
      }),
      board.registerLinkResolver('eagle', async value => {
        const url = new URL(value)
        if (url.protocol !== 'eagle:') return undefined
        const match = url.pathname.match(/^\/([a-zA-Z0-9]{1,100})\/?$/)
        if (url.hostname !== 'item' || url.username || url.password || url.port || url.search || url.hash || !match) throw new Error('Eagle 条目链接无效')
        const source = await call<EagleSource>('eagleLinks', 'link', { itemId: match[1] })
        return source.resourceUri
      }),
      board.register('eagleInspect', args => call<EagleSource | null>('eagleLinks', args.refresh === true ? 'inspect' : 'get', selectedReference(args), ...(args.refresh === true ? [true] : []))),
      board.register('eagleOpen', async args => {
        const source = await call<EagleSource | null>('eagleLinks', 'get', selectedReference(args))
        if (!source) throw new Error('所选图片没有 Eagle 来源信息')
        return call('eagleLinks', 'open', source.itemId)
      })
    ]
    return () => cleanup.forEach(dispose => dispose())
  }
})
