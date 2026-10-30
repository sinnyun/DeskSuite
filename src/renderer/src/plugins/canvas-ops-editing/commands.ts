import type { BoardNode, CanvasService, Scene } from './contract'

export function registerEditing(board: CanvasService): () => void {
  let clipboard: BoardNode[] = []
  let clipboardGroups: NonNullable<Scene['groups']> = []
  const handlers: Record<string, (args: Record<string, unknown>) => unknown> = {
    add: (args) => {
      const types = ['rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'frame']
      const type = String(args.type ?? 'rect') as BoardNode['type']
      if (!types.includes(type)) throw new Error('使用 import 导入资源元素')
      const id = crypto.randomUUID()
      board.edit((scene) =>
        scene.nodes.push({
          id,
          type,
          name: String(
            args.name ?? ({ text: '文本', note: '便签', frame: '分区' } as Record<string, string>)[type] ?? '图形'
          ).slice(0, 300),
          x: number(args.x, 80),
          y: number(args.y, 80),
          width: positive(args.width, type === 'frame' ? 500 : 220),
          height: positive(args.height, type === 'line' || type === 'arrow' ? 4 : type === 'frame' ? 350 : 140),
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: type === 'note' ? '#fef3c7' : type === 'frame' ? '#e2e8f0' : '#dbeafe',
          text: String(
            args.text ?? (type === 'note' ? '双击或切换内容模式编辑便签' : type === 'text' ? '双击编辑文字' : '')
          ),
          tags: [],
          locked: false,
          collapsed: false
        })
      )
      board.select([id])
      return id
    },
    select: (args) => {
      if (args.deep === true) return board.command('deepSelect', { ids: args.ids })
      board.select(Array.isArray(args.ids) ? args.ids.map(String) : [], args.deep !== true)
      return board.getSnapshot().selection
    },
    update: (args) => {
      const patch = args.patch as Partial<BoardNode>
      if (!patch || typeof patch !== 'object') throw new Error('缺少 patch')
      const allowed = [
        'name',
        'text',
        'html',
        'tags',
        'x',
        'y',
        'width',
        'height',
        'rotation',
        'fill',
        'locked',
        'collapsed',
        'frame',
      ]
      for (const key of Object.keys(patch)) if (!allowed.includes(key)) throw new Error(`不支持的属性 ${key}`)
      for (const key of ['x', 'y', 'width', 'height', 'rotation'] as const)
        if (patch[key] !== undefined) {
          number(patch[key])
          if ((key === 'width' || key === 'height') && patch[key]! <= 0) throw new Error('尺寸必须大于零')
        }
      const ids = Array.isArray(args.ids) ? args.ids.map(String) : board.getSnapshot().selection
      board.edit((scene) => {
        for (const node of scene.nodes)
          if (ids.includes(node.id) && (!node.locked || Object.keys(patch).every((k) => k === 'locked')))
            Object.assign(node, patch)
      })
      return true
    },
    delete: () => {
      const ids = board.getSnapshot().selection
      board.edit((scene) => {
        scene.nodes = scene.nodes.filter((n) => !ids.includes(n.id) || n.locked)
      })
      board.select([])
    },
    copy: () => {
      clipboard = structuredClone(selected())
      const scene = board.getSnapshot().scene
      const groups = new Map((scene.groups ?? []).map(g => [g.id, g]))
      const used = new Set<string>()
      for (const node of clipboard) { let id = node.group; while (id && !used.has(id)) { used.add(id); id = groups.get(id)?.parent } }
      clipboardGroups = [...used].map(id => structuredClone(groups.get(id) ?? { id }))
      return clipboard.length
    },
    paste: () => {
      const groupMap = new Map<string, string>()
      for (const group of clipboardGroups) groupMap.set(group.id, crypto.randomUUID())
      const nodes = structuredClone(clipboard).map((n) => {
        if (n.group && !groupMap.has(n.group)) groupMap.set(n.group, crypto.randomUUID())
        return {
          ...n,
          id: crypto.randomUUID(),
          x: n.x + 24,
          y: n.y + 24,
          group: n.group ? groupMap.get(n.group) : undefined,
          frame: undefined,
          locked: false
        }
      })
      board.edit(scene => {
        scene.nodes.push(...nodes)
        if (clipboardGroups.length) scene.groups = [...(scene.groups ?? []), ...clipboardGroups.map(g => ({ ...g, x: (g.x ?? 0) + 24, y: (g.y ?? 0) + 24, id: groupMap.get(g.id)!, ...(g.parent ? { parent: groupMap.get(g.parent)! } : {}) }))]
      })
      board.select(nodes.map((n) => n.id))
      return nodes.map((n) => n.id)
    },
    duplicate: () => {
      handlers.copy({})
      return handlers.paste({})
    },
    undo: () => board.history('undo'),
    redo: () => board.history('redo'),
    rotate: (args) => board.command('transform', { angle: number(args.angle, 90) }),
    flip: (args) => board.command('transform', { flip: args.axis === 'y' ? 'y' : 'x' }),
    group: () => board.command('nativeGroup'),
    ungroup: () => board.command('nativeUngroup'),
    frameSelection: () => {
      const nodes = selected().filter((n) => n.type !== 'frame' && !n.locked)
      if (!nodes.length) return
      const id = crypto.randomUUID(),
        x = Math.min(...nodes.map((n) => n.x)) - 24,
        y = Math.min(...nodes.map((n) => n.y)) - 48
      const width = Math.max(...nodes.map((n) => n.x + n.width)) - x + 24,
        height = Math.max(...nodes.map((n) => n.y + n.height)) - y + 24
      board.edit((scene) => {
        scene.nodes.unshift({
          id,
          type: 'frame',
          name: '新分区',
          x,
          y,
          width,
          height,
          rotation: 0,
          scaleX: 1,
          scaleY: 1,
          fill: '#e2e8f0',
          tags: [],
          locked: false,
          collapsed: false
        })
        for (const node of scene.nodes) if (nodes.some((n) => n.id === node.id)) node.frame = id
      })
      board.select([id])
      return id
    },
    detachFrame: () =>
      change((n) => {
        delete n.frame
      }),
    lock: (args) =>
      change((n) => {
        n.locked = args.value !== false
      }, true),
    order: (args) => {
      const ids = board.getSnapshot().selection
      board.edit((scene) => {
        const a = scene.nodes.filter((n) => ids.includes(n.id)),
          b = scene.nodes.filter((n) => !ids.includes(n.id))
        scene.nodes = args.direction === 'bottom' ? [...a, ...b] : [...b, ...a]
      })
    },
    arrange: (args) => {
      const nodes = selected().filter((n) => !n.locked)
      if (!nodes.length) return
      const x = Math.min(...nodes.map((n) => n.x)),
        y = Math.min(...nodes.map((n) => n.y))
      const gap = Math.max(0, number(args.gap, 24)),
        columns =
          args.mode === 'vertical' ? 1 : args.mode === 'horizontal' ? nodes.length : Math.ceil(Math.sqrt(nodes.length))
      const width = Math.max(...nodes.map((n) => n.width * Math.abs(n.scaleX))),
        height = Math.max(...nodes.map((n) => n.height * Math.abs(n.scaleY)))
      board.edit((scene) =>
        nodes.forEach((n, i) =>
          Object.assign(scene.nodes.find((item) => item.id === n.id)!, {
            x: x + (i % columns) * (width + gap),
            y: y + Math.floor(i / columns) * (height + gap)
          })
        )
      )
    },
    distribute: (args) => {
      const axis = args.axis === 'y' ? 'y' : 'x',
        dimension = axis === 'x' ? 'width' : 'height'
      const nodes = selected()
        .filter((n) => !n.locked)
        .sort((a, b) => a[axis] - b[axis])
      if (nodes.length < 3) return
      const last = nodes[nodes.length - 1],
        total = last[axis] + last[dimension] - nodes[0][axis]
      const gap = (total - nodes.reduce((v, n) => v + n[dimension], 0)) / (nodes.length - 1)
      let cursor = nodes[0][axis]
      board.edit((scene) =>
        nodes.forEach((n) => {
          scene.nodes.find((item) => item.id === n.id)![axis] = cursor
          cursor += n[dimension] + gap
        })
      )
    },
    settings: (args) =>
      board.edit((scene) => {
        if (['dots', 'grid', 'none'].includes(String(args.background)))
          scene.background = args.background as Scene['background']
        if (typeof args.snap === 'boolean') scene.snap = args.snap
        if (typeof args.rulers === 'boolean') scene.rulers = args.rulers
        if (args.title) scene.title = String(args.title).slice(0, 200)
      }),
    guide: (args) =>
      board.edit((scene) => {
        const id = String(args.id ?? crypto.randomUUID())
        scene.guides = scene.guides.filter((g) => g.id !== id)
        if (!args.remove) scene.guides.push({ id, axis: args.axis === 'y' ? 'y' : 'x', value: number(args.value, 0) })
      }),
    bookmark: (args) => {
      const state = board.getSnapshot()
      if (args.go) {
        const mark = state.scene.bookmarks.find((b) => b.id === args.go)
        if (!mark) throw new Error('书签不存在')
        board.setView({ x: mark.x, y: mark.y, zoom: mark.zoom })
      } else
        board.edit((scene) => {
          scene.bookmarks.push({
            id: crypto.randomUUID(),
            name: String(args.name ?? '视图书签').slice(0, 100),
            ...scene.view
          })
        })
    },
    search: (args) => {
      const query = String(args.query ?? '').toLocaleLowerCase()
      return board
        .getSnapshot()
        .scene.nodes.filter((n) => [n.name, n.text ?? '', ...n.tags].join(' ').toLocaleLowerCase().includes(query))
        .map((n) => ({ id: n.id, name: n.name, type: n.type }))
    },
    collapse: (args) =>
      change((n) => {
        n.collapsed = typeof args.value === 'boolean' ? args.value : !n.collapsed
      }),
    richText: async () => {
      await board.command('commitEditing')
      const [node] = selected()
      if (!node || !['text', 'note'].includes(node.type) || node.locked) throw new Error('请选择文字或便签')
      board.edit(scene => {
        const current = scene.nodes.find(n => n.id === node.id)!
        if (!current.html) current.html = '<div>' + (current.text ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('\n', '<br>') + '</div>'
      })
      board.setInteraction(true)
    },
    interaction: (args) => {
      const nodes = selected()
      if (args.value === true && nodes.length === 1 && ['text', 'note'].includes(nodes[0].type) && !nodes[0].html)
        return board.command('textEdit', { action: 'open', id: nodes[0].id })
      board.setInteraction(args.value === true)
    },
  }
  function selected(): BoardNode[] {
    const state = board.getSnapshot()
    return state.scene.nodes.filter((n) => state.selection.includes(n.id))
  }
  function change(fn: (node: BoardNode) => void, locked = false): void {
    const ids = board.getSnapshot().selection
    board.edit((scene) =>
      scene.nodes.forEach((n) => {
        if (ids.includes(n.id) && (locked || !n.locked)) fn(n)
      })
    )
  }
  const cleanup = Object.entries(handlers).map(([name, handler]) => board.register(name, handler))
  return () => cleanup.forEach((fn) => fn())
}
function number(value: unknown, fallback?: number): number {
  if (value === undefined && fallback !== undefined) return fallback
  if (typeof value !== 'number' || !Number.isFinite(value) || Math.abs(value) > 1e7) throw new Error('数值无效')
  return value
}
function positive(value: unknown, fallback: number): number {
  const result = number(value, fallback)
  if (result <= 0) throw new Error('尺寸必须大于零')
  return result
}
