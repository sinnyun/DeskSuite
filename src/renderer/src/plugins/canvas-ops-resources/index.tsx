import { call, definePlugin, getService } from '../../workbench/sdk'
import { getCanvas } from './contract'
import type { BoardNode } from './contract'

interface Resource {
  uri: string
  name: string
  kind: string
  available: boolean
}
interface Resources {
  register(path: string): Promise<Resource>
  registerFile(file: File): Promise<Resource>
  resolve(reference: string): Promise<Resource>
  choose(): Promise<Resource[]>
  acquireImage(reference: string): Promise<{ leaseId: string; width: number; height: number }>
  releaseImage(id: string): Promise<void>
}
export default definePlugin({
  id: 'canvas-ops-resources',
  name: '画板资源接入',
  version: '2.0.0',
  author: 'DeskSuite 内置',
  description: '通过统一资源服务引用图片、视频与文件卡片',
  setup: () => {
    const board = getCanvas()
    if (!board) return
    let disposed = false
    const importResource = async (args: Record<string, unknown>): Promise<string[]> => {
      const initial = board.getSnapshot()
      const view = initial.scene.view
      const x = Number(args.x ?? (80 - view.x) / view.zoom)
      const y = Number(args.y ?? (80 - view.y) / view.zoom)
      if (![x, y].every(n => Number.isFinite(n) && Math.abs(n) <= 1e7 - 3200)) throw new Error('导入位置无效')
      const resources = getService<Resources>('resources')
      if (!resources) throw new Error('统一资源服务未启用')
      const requests: Array<() => Promise<Resource>> = []
      for (const key of ['paths', 'files', 'references', 'links'] as const) {
        if (args[key] === undefined) continue
        if (!Array.isArray(args[key])) throw new Error('导入列表无效')
        for (const value of args[key] as unknown[]) {
          if (key === 'files') requests.push(() => resources.registerFile(value as File))
          else {
            if (typeof value !== 'string' || !value.trim()) throw new Error('文件路径或链接无效')
            requests.push(async () => key === 'paths' ? resources.register(value) : resources.resolve(key === 'links' ? await board.resolveLink(value) : value))
          }
        }
      }
      if (args.reference !== undefined) requests.push(() => resources.resolve(String(args.reference)))
      if (requests.length > 100) throw new Error('每次最多导入 100 个文件')
      const explicit = ['paths', 'files', 'references', 'links', 'reference'].some(key => args[key] !== undefined)
      const registered = explicit ? await Promise.all(requests.map(run => run())) : await resources.choose()
      const inputs = [...new Map(registered.map(resource => [resource.uri, resource])).values()]
      if (!inputs.length) return []
      const nodes: BoardNode[] = []
      for (const [i, resource] of inputs.entries()) {
        if (!resource.available) throw new Error(`源文件不可用：${resource.name}`)
        const metadata = await board.enrichResource(resource.uri)
        let width = 320,
          height = resource.kind === 'video' ? 210 : 180
        if (resource.kind === 'image' && resource.available) {
          const lease = await resources.acquireImage(resource.uri)
          try {
            const scale = Math.min(1, 480 / lease.width, 360 / lease.height)
            width = lease.width * scale
            height = lease.height * scale
          } finally {
            await resources.releaseImage(lease.leaseId)
          }
        }
        nodes.push({
          id: crypto.randomUUID(),
          type: resource.kind === 'image' ? 'image' : resource.kind === 'video' ? 'video' : 'file',
          name: metadata.name ?? resource.name,
          resource: resource.uri,
          resourceKind: resource.kind,
          x: x + i * 32,
          y: y + i * 32,
          width,
          height,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: '#f1f5f9',
          tags: metadata.tags ?? [],
          locked: false,
          collapsed: false
        })
      }
      if (disposed || board.getSnapshot().id !== initial.id) throw new Error('画板已切换，已取消本次导入')
      board.edit((scene) => scene.nodes.push(...nodes))
      board.select(nodes.map((n) => n.id))
      return nodes.map((n) => n.id)
    }
    const cleanup = [
      board.register('import', importResource),
      board.register('pasteImage', async () => {
        const resource = await call<Resource>('canvasInput', 'clipboardImage')
        return importResource({ reference: resource.uri })
      })
    ]
    return () => { disposed = true; cleanup.forEach((fn) => fn()) }
  }
})
