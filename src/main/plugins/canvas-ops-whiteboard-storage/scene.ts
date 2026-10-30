import { z } from 'zod'

const finite = z.number().finite().min(-1e7).max(1e7)
const clip = z
  .object({
    x: finite,
    y: finite,
    width: finite.positive(),
    height: finite.positive(),
    rotation: finite,
    skewX: finite.optional(),
    skewY: finite.optional(),
    scaleX: finite,
    scaleY: finite
  })
const node = z
  .object({
    id: z.string().min(1).max(100),
    type: z.enum(['rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'frame', 'image', 'video', 'file']),
    name: z.string().max(300),
    x: finite,
    y: finite,
    width: finite.positive(),
    height: finite.positive(),
    rotation: finite,
    skewX: finite.optional(),
    skewY: finite.optional(),
    scaleX: finite,
    scaleY: finite,
    fill: z.string().max(50),
    text: z.string().max(100000).optional(),
    html: z.string().max(200000).optional(),
    resource: z
      .string()
      .regex(/^desksuite-resource:\/\/local\/[a-f0-9-]+\/content(?:\.[a-z0-9]+)?$/)
      .optional(),
    resourceKind: z.enum(['image', 'video', 'audio', 'pdf', 'markdown', 'text', 'document', 'binary']).optional(),
    tags: z.array(z.string().max(100)).max(50),
    locked: z.boolean(),
    collapsed: z.boolean(),
    group: z.string().max(100).optional(),
    frame: z.string().max(100).optional(),
    crop: z
      .object({
        x: z.number().min(0).max(1),
        y: z.number().min(0).max(1),
        width: z.number().positive().max(1),
        height: z.number().positive().max(1)
      })
      .optional(),
    clip: clip.optional(),
    clipSpace: z.literal('leafer-local').optional()
  })
  .strict()
export const sceneSchema = z
  .object({
    format: z.literal('desksuite-leafer'),
    version: z.literal(1),
    title: z.string().min(1).max(200),
    nodes: z.array(node).max(10000),
    groups: z.array(z.object({ id: z.string().min(1).max(100), parent: z.string().min(1).max(100).optional(), x: finite.optional(), y: finite.optional(), rotation: finite.optional(), scaleX: finite.refine(value => Math.abs(value) >= 1e-8).optional(), scaleY: finite.refine(value => Math.abs(value) >= 1e-8).optional(), skewX: finite.optional(), skewY: finite.optional() }).strict()).max(10000).optional(),
    view: z.object({ x: finite, y: finite, zoom: z.number().min(0.05).max(8) }),
    background: z.enum(['dots', 'grid', 'none']),
    snap: z.boolean(),
    rulers: z.boolean(),
    guides: z.array(z.object({ id: z.string(), axis: z.enum(['x', 'y']), value: finite })).max(500),
    bookmarks: z
      .array(
        z.object({ id: z.string(), name: z.string().max(100), x: finite, y: finite, zoom: z.number().min(0.05).max(8) })
      )
      .max(100)
  })
  .strict()
  .superRefine((scene, ctx) => {
    if (new Set(scene.nodes.map((n) => n.id)).size !== scene.nodes.length)
      ctx.addIssue({ code: 'custom', message: '元素 ID 重复' })
    const groups = new Map((scene.groups ?? []).map(g => [g.id, g]))
    if (groups.size !== (scene.groups?.length ?? 0) || scene.nodes.some(n => groups.has(n.id)))
      ctx.addIssue({ code: 'custom', message: '组合 ID 重复' })
    for (const group of groups.values()) {
      const visited = new Set<string>([group.id])
      let parent = group.parent
      while (parent) {
        if (!groups.has(parent) || visited.has(parent) || visited.size >= 64) {
          ctx.addIssue({ code: 'custom', message: '组合层级无效或存在循环' }); break
        }
        visited.add(parent)
        parent = groups.get(parent)?.parent
      }
    }
    for (const n of scene.nodes)
      if ((n.type === 'image' || n.type === 'video' || n.type === 'file') && !n.resource)
        ctx.addIssue({ code: 'custom', message: '资源元素缺少统一链接' })
  })

export function validateScene(json: string): string {
  if (typeof json !== 'string' || json.length > 4 * 1024 * 1024) throw new Error('场景超过 4MB')
  return JSON.stringify(sceneSchema.parse(JSON.parse(json)))
}
