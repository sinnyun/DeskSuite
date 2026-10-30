import { App, Rect, Ellipse, Text, Path, Box, Group, Matrix, Canvas, Line, DragEvent, PointerEvent, PropertyEvent, RenderEvent } from 'leafer-ui'
import type { UI } from 'leafer-ui'
import { Arrow } from '@leafer-in/arrow'
import { Ruler } from 'leafer-x-ruler'
import { EditorEvent, InnerEditorEvent } from '@leafer-in/editor'
import type { IUI } from '@leafer-ui/interface'
import { Snap } from 'leafer-x-easy-snap'
import { ClipImage, ClipResizeEditor, ClipResizeEditorEvent } from 'leafer-x-clip-resize-inner-editor'
import { TextEditor } from '@leafer-in/text-editor'
import '@leafer-in/export'
import '@leafer-in/viewport'
import '@leafer-in/view'
import '@leafer-in/arrow'
import { getService } from '../../workbench/sdk'
import type { BoardNode, CanvasService, NodeClip, Snapshot } from './contract'
import { drawRichText } from './rich-layout'

;(ClipImage as unknown as { setEditInner(name: string): void }).setEditInner(ClipResizeEditor.name)

// Persist ClipImage's own child-image transform. Only legacy crop fractions need conversion.
const clipOf = (node: BoardNode): NodeClip | undefined => {
  if (node.clip) {
    if (node.clipSpace === 'leafer-local') return node.clip
    return {
      ...node.clip,
      x: node.clip.x * node.width,
      y: node.clip.y * node.height,
      width: node.clip.width * node.width,
      height: node.clip.height * node.height
    }
  }
  if (!node.crop) return undefined
  const crop = node.crop
  return {
    x: (-crop.x / crop.width) * node.width,
    y: (-crop.y / crop.height) * node.height,
    width: node.width / crop.width,
    height: node.height / crop.height,
    rotation: 0,
    scaleX: 1,
    scaleY: 1
  }
}

class WhiteboardSnap extends Snap {
  constructor(app: App, private readonly guideTargets: () => Line[]) {
    super(app, {
      parentContainer: app.tree,
      snapSize: 6,
      showLine: true,
      showLinePoints: true,
      showDistanceLabels: true,
      showEqualSpacingBoxes: true,
      lineColor: '#06b6d4'
    })
  }

  collectSnapElements(): IUI[] {
    const guides = this.guideTargets()
    return [...super.collectSnapElements(), ...guides]
  }
}

interface Resources {
  acquireImage(reference: string): Promise<{ leaseId: string; url: string; width: number; height: number }>
  releaseImage(id: string): Promise<void>
}
export class BoardEngine {
  readonly app: App
  private readonly snap: Snap
  private readonly ruler: Ruler
  private nodes = new Map<string, UI>()
  private guideTargets = new Map<string, Line>()
  private videoCanvases = new Map<string, Canvas>()
  private leases = new Map<string, string>()
  private nodeSnapshots = new Map<string, BoardNode>()
  private groups = new Map<string, Group>()
  private lastGroups?: Snapshot['scene']['groups']
  private plainTexts = new Map<string, Text>()
  private lastState?: Snapshot
  private discardTextCommit = false
  private imeDom?: HTMLDivElement
  private readonly protectComposition = (event: KeyboardEvent): void => {
    if (event.isComposing || event.keyCode === 229) event.stopPropagation()
  }
  private metrics = { nodePasses: 0, nodeChecks: 0, created: 0, updated: 0, destroyed: 0, viewUpdates: 0 }
  private imageLoads = new Set<Promise<void>>()
  private syncing = false
  private selectingNative = false
  private disposed = false
  private resources = getService<Resources>('resources')
  private observer: ResizeObserver
  private themeObserver: MutationObserver
  private unsubscribe: () => void
  private commandDisposers: (() => void)[]
  private clipEditing: string | null = null
  private suppressClipCommit = false
  private pendingClipCommits = 0
  private viewCommitFrame = 0
  constructor(
    mount: HTMLDivElement,
    private board: CanvasService,
    viewport: HTMLElement = mount
  ) {
    this.app = new App({
      view: mount,
      width: viewport.clientWidth || 720,
      height: viewport.clientHeight || 460,
      tree: { type: 'design' },
      sky: {},
      editor: { lockRatio: 'corner', rotateable: true, skewable: false, keyEvent: false },
      zoom: { min: 0.05, max: 8 }
    })
    this.ruler = new Ruler(this.app, {
      enabled: false,
      ruleSize: 20,
      fontSize: 10,
      theme: document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    })
    this.themeObserver = new MutationObserver(() => {
      this.ruler.theme = document.documentElement.classList.contains('dark') ? 'dark' : 'light'
    })
    this.themeObserver.observe(document.documentElement, { attributes: true, attributeFilter: ['class'] })
    this.app.tree.zoomLayer.on(PropertyEvent.CHANGE, (event) => {
      if (this.syncing || this.disposed || !['x', 'y', 'scaleX', 'scaleY'].includes(event.attrName)) return
      if (this.viewCommitFrame) return
      this.viewCommitFrame = requestAnimationFrame(() => {
        this.viewCommitFrame = 0
        this.persistView()
      })
    })
    this.snap = new WhiteboardSnap(this.app, () => [...this.guideTargets.values()])
    this.app.editor.on(EditorEvent.SELECT, () => {
      if (!this.syncing) {
        const ids = new Set<string>()
        for (const target of this.app.editor.list) {
          if (target.id && this.nodes.has(target.id)) ids.add(target.id)
          else for (const [id, node] of this.nodes) if (target instanceof Group && this.hasAncestor(node, target as UI)) ids.add(id)
        }
        this.selectingNative = true
        try { board.select([...ids], false) } finally { this.selectingNative = false }
      }
    })
    this.app.editor.on(InnerEditorEvent.OPEN, (event: InnerEditorEvent) => {
      if (!(event.innerEditor instanceof TextEditor)) return
      this.imeDom = event.innerEditor.editDom
      this.imeDom.addEventListener('keydown', this.protectComposition, true)
      const pair = [...this.plainTexts].find(([, text]) => text === event.editTarget)
      board.setTextEditing(pair?.[0] ?? null)
    })
    this.app.editor.on(InnerEditorEvent.CLOSE, (event: InnerEditorEvent) => {
      if (!(event.innerEditor instanceof TextEditor)) return
      this.imeDom?.removeEventListener('keydown', this.protectComposition, true)
      this.imeDom = undefined
      board.setTextEditing(null)
      if (this.discardTextCommit) return
      const pair = [...this.plainTexts].find(([, text]) => text === event.editTarget)
      if (!pair || this.disposed) return
      const [id, text] = pair
      const value = String(text.text ?? '')
      if (value.length > 100000) { text.text = this.nodeSnapshots.get(id)?.text ?? ''; board.report('文字不能超过 100000 字符'); return }
      board.edit(scene => { const node = scene.nodes.find(n => n.id === id); if (node) node.text = value })
    })
    this.app.editor.on(ClipResizeEditorEvent.START, (event: ClipResizeEditorEvent) => {
      const id = (event.target as { id?: string } | undefined)?.id
      this.clipEditing = id ?? null
      if (id) board.setCropEditing(id)
    })
    this.app.editor.on(ClipResizeEditorEvent.END, () => {
      const id = this.clipEditing
      this.clipEditing = null
      const commit = !!id && !this.suppressClipCommit
      this.suppressClipCommit = false
      // Pointer.UP is emitted before DOUBLE_TAP. Its queued transform save must
      // not rebuild this node before the crop transaction reads the child image.
      const finish = commit && id ? this.prepareClipCommit(id) : undefined
      this.pendingClipCommits++
      queueMicrotask(() => {
        try {
          if (this.disposed) return
          board.setCropEditing(null)
          finish?.()
        } finally {
          this.pendingClipCommits--
        }
      })
    })
    this.app.on(DragEvent.END, () => {
      this.scheduleTransformCommit()
    })
    this.app.on(PointerEvent.UP, () => {
      this.scheduleTransformCommit()
    })
    this.unsubscribe = board.subscribe(() => this.sync(board.getSnapshot()))
    this.observer = new ResizeObserver(() => {
      if (this.disposed) return
      const width = viewport.clientWidth, height = viewport.clientHeight
      if (width > 0 && height > 0 && (this.app.width !== width || this.app.height !== height)) this.app.resize({ width, height })
    })
    // Leafer writes canvas dimensions beneath mount. Only the visible host is
    // authoritative; observing canvas-derived content can feed resize back into itself.
    this.observer.observe(viewport)
    this.commandDisposers = [
      board.register('commitEditing', () => {
        if (this.app.editor.innerEditor instanceof TextEditor) this.app.editor.closeInnerEditor()
      }),
      board.register('nativeGroup', () => this.groupSelection(false)),
      board.register('nativeUngroup', () => this.groupSelection(true)),
      board.register('deepSelect', args => this.selectDeep(Array.isArray(args.ids) ? args.ids.map(String) : [])),
      board.register('groupEdit', args => {
        const group = this.groups.get(String(args.id))
        if (!group) throw new Error('组合不存在')
        if (args.open === false) this.app.editor.closeGroup(group)
        else if (args.open === true || args.select !== true) this.app.editor.openGroup(group)
        if (args.select === true) {
          let parent = group.parent
          while (parent && parent !== this.app.tree) { if (this.groups.get(parent.id!) === parent) this.app.editor.openGroup(parent); parent = parent.parent }
          this.app.editor.select(group)
        }
        return { id: group.id, open: group.hitChildren }
      }),
      board.register('textEdit', args => this.editText(args)),
      board.register('activateSelection', () => {
        const target = this.app.editor.list.length === 1 ? this.app.editor.list[0] : undefined
        if (!target?.id || this.groups.has(target.id)) return
        if (this.plainTexts.has(target.id)) return this.editText({ action: 'open', id: target.id })
        this.board.setInteraction(true)
      }),
      board.register('profileMove', args => this.profileMove(mount, args)),
      board.register('fit', (args) => this.fit(args.selection === true)),
      board.register('zoom', (args) => {
        const zoom = Math.min(8, Math.max(0.05, Number(args.value ?? 1)))
        this.app.tree.zoom(zoom)
        this.persistView()
        return this.app.tree.zoomLayer.scaleX
      }),
      board.register('export', async (args) => {
        await Promise.allSettled([...this.imageLoads])
        if (this.disposed) throw new Error('画板已关闭')
        this.app.tree.updateLayout()
        const bounds = [...this.nodes.values()].map((n) => n.getBounds('render', this.app.tree))
        const width = Math.max(1, ...bounds.map((b) => b.x + b.width)) - Math.min(0, ...bounds.map((b) => b.x))
        const height = Math.max(1, ...bounds.map((b) => b.y + b.height)) - Math.min(0, ...bounds.map((b) => b.y))
        if (width * height * 4 > 64 * 1024 * 1024 || width * 2 > 16000 || height * 2 > 16000)
          throw new Error('导出范围过大，请缩小元素间距后再导出')
        const format = args.format === 'jpeg' ? 'jpg' : 'png'
        const result = await this.app.tree.export(format, { pixelRatio: 2, fill: '#ffffff' })
        if (!result.data || typeof result.data !== 'string') throw new Error('导出失败')
        if (args.download !== false) {
          const a = document.createElement('a')
          a.href = result.data
          a.download = `${board.getSnapshot().scene.title}.${format}`
          a.click()
        }
        return { format, width: result.width, height: result.height, data: result.data }
      }),
      board.register('renderState', () => ({
        engine: 'LeaferJS',
        nodes: this.nodes.size,
        sync: { ...this.metrics },
        nodeInstances: [...this.nodes].map(([id, ui]) => ({ id, instance: ui.innerId, tag: ui.tag, parent: ui.parent?.id ?? null,
          text: this.plainTexts.get(id)?.text ?? null })),
        groups: [...this.groups].map(([id, group]) => ({ id, instance: group.innerId, parent: group.parent?.id ?? null, open: group.hitChildren, rotation: group.rotation, scaleX: group.scaleX, scaleY: group.scaleY })),
        images: this.leases.size,
        imageNodes: [...this.nodes].flatMap(([id, ui]) => ui instanceof ClipImage ? [{
          id, instance: ui.innerId, layer: ui.layerImg.innerId, lease: this.leases.get(id) ?? null, ready: !!ui.layerImg.ready
        }] : []),
        width: mount.clientWidth,
        height: mount.clientHeight,
        viewport: { width: viewport.clientWidth, height: viewport.clientHeight },
        rendererSize: { width: this.app.width, height: this.app.height },
        cropEditing: this.clipEditing,
        view: {
          x: this.app.tree.zoomLayer.x,
          y: this.app.tree.zoomLayer.y,
          zoom: this.app.tree.zoomLayer.scaleX
        }
      })),
      board.register('thumbnail', async (args) => {
        const id = String(args.id)
        const ui = this.nodes.get(id)
        // The node being cropped is hidden by the inner editor; exporting it would cache a blank frame.
        if (!ui || id === this.clipEditing) return null
        await Promise.allSettled([...this.imageLoads])
        if (this.disposed || this.nodes.get(id) !== ui || id === this.clipEditing) return null
        if (ui instanceof ClipImage && !ui.layerImg.ready) return null
        this.app.tree.updateLayout()
        const bounds = ui.getBounds('box', this.app.tree)
        const longest = Math.max(1, bounds.width, bounds.height)
        const target = Math.min(1, (Number(args.size ?? 48) * 2) / longest)
        // A queued export can wait forever for a destroyed board's next frame,
        // blocking later full-board exports. Sources are decoded above; generate
        // this small preview synchronously while its node is still attached.
        const result = ui.syncExport('png', { pixelRatio: target })
        return typeof result.data === 'string' ? result.data : null
      }),
      board.register('transform', (args) => {
        for (const key of ['dx', 'dy', 'scale', 'angle'])
          if (
            args[key] !== undefined &&
            (typeof args[key] !== 'number' || !Number.isFinite(args[key]) || Math.abs(args[key] as number) > 1e4)
          )
            throw new Error('变换数值无效')
        if (args.flip !== undefined && args.flip !== 'x' && args.flip !== 'y') throw new Error('翻转轴无效')
        if (args.scale !== undefined && Number(args.scale) <= 0) throw new Error('缩放必须大于零')
        if (args.dx !== undefined || args.dy !== undefined)
          this.app.editor.move(Number(args.dx ?? 0), Number(args.dy ?? 0))
        if (args.scale !== undefined) this.app.editor.scaleOf('center', Number(args.scale), Number(args.scale))
        if (args.angle !== undefined) this.app.editor.rotateOf('center', Number(args.angle))
        if (args.flip !== undefined) this.app.editor.flip(args.flip)
        this.commitTransforms()
        return this.board.getSnapshot().scene.nodes.filter((n) => this.board.getSnapshot().selection.includes(n.id))
      }),
      board.register('cropOpen', () => this.openClipEditor()),
      board.register('cropClose', () => {
        if (!this.app.editor.innerEditing) return false
        this.app.editor.closeInnerEditor()
        return true
      }),
      board.register('cropState', (args) => this.clipState(args.id === undefined ? undefined : String(args.id))),
      board.register('cropResize', (args) => {
        if (!this.app.editor.innerEditing) throw new Error('请先进入图片裁剪')
        const width = Number(args.width),
          height = Number(args.height)
        if (![width, height].every((v) => Number.isFinite(v) && v > 0.1 && v < 1e5)) throw new Error('裁剪尺寸无效')
        ;(this.app.editor.innerEditor as ClipResizeEditor).updateClipSize(width, height, args.lockRatio === true)
        return this.clipState()
      }),
      board.register('cropRatio', (args) => {
        if (!this.app.editor.innerEditing) throw new Error('请先进入图片裁剪')
        const ratio = String(args.ratio ?? '')
        if (!/^\d+(?:\.\d+)?:\d+(?:\.\d+)?$/.test(ratio)) throw new Error('裁剪比例无效')
        ;(this.app.editor.innerEditor as ClipResizeEditor).updateClipRatio(ratio)
        return this.clipState()
      }),
      board.register('cropReset', () => {
        if (!this.app.editor.innerEditing) throw new Error('请先进入图片裁剪')
        const inner = this.app.editor.innerEditor as ClipResizeEditor
        inner.reset()
        inner.onUpdate()
        return this.clipState()
      }),
      board.register('videoFrame', (args) => {
        const canvas = this.videoCanvases.get(String(args.id)),
          video = args.video
        if (!canvas || !(video instanceof HTMLVideoElement) || video.readyState < 2) return false
        const width = canvas.width ?? 320,
          height = canvas.height ?? 180
        const scale = Math.min(width / video.videoWidth, height / video.videoHeight)
        canvas.context.clearRect(0, 0, width, height)
        canvas.context.fillStyle = '#0f172a'
        canvas.context.fillRect(0, 0, width, height)
        canvas.context.drawImage(
          video,
          (width - video.videoWidth * scale) / 2,
          (height - video.videoHeight * scale) / 2,
          video.videoWidth * scale,
          video.videoHeight * scale
        )
        canvas.paint()
        return true
      })
    ]
    this.sync(board.getSnapshot())
  }
  private sync(state: Snapshot): void {
    if (this.disposed) return
    const previous = this.lastState
    this.lastState = state
    this.syncing = true
    try {
      if (state.scene.view !== previous?.scene.view) {
        const { x, y, zoom } = state.scene.view
        const layer = this.app.tree.zoomLayer
        if (layer.x !== x || layer.y !== y || layer.scaleX !== zoom || layer.scaleY !== zoom) {
          layer.set({ x, y, scaleX: zoom, scaleY: zoom }); this.metrics.viewUpdates++
        }
      }
      if (state.scene.snap !== previous?.scene.snap) this.snap.enable(state.scene.snap)
      if (state.scene.rulers !== previous?.scene.rulers) this.ruler.enabled = state.scene.rulers
      if (state.scene.guides !== previous?.scene.guides || state.scene.view !== previous?.scene.view)
        this.syncGuideTargets(state.scene.guides, state.scene.view)
      const structureChanged = state.scene.groups !== previous?.scene.groups
      if (state.scene.nodes !== previous?.scene.nodes || structureChanged) {
        this.metrics.nodePasses++
        const next = new Map(state.scene.nodes.map(node => [node.id, node]))
        // Changed leaves are staged in board space. Native dropTo restores their
        // local transforms under the persistent Group hierarchy afterward.
        for (const [id, ui] of this.nodes) {
          if ((next.get(id) !== this.nodeSnapshots.get(id) || structureChanged) && ui.parent !== this.app.tree)
            this.app.tree.add(ui)
        }
        for (const [id, ui] of this.nodes) {
          const node = next.get(id), old = this.nodeSnapshots.get(id)
          if (!node || !old || node.type !== old.type || node.collapsed !== old.collapsed ||
            (node.type === 'image' && node.resource !== old.resource) ||
            ((node.type === 'text' || node.type === 'note') && !!node.html !== !!old.html)) {
            if (this.app.editor.innerEditing) {
              this.discardTextCommit = true; this.suppressClipCommit = true
              this.app.editor.closeInnerEditor(); this.discardTextCommit = false
            }
            ui.destroy(); this.metrics.destroyed++
            this.nodes.delete(id); this.plainTexts.delete(id); this.videoCanvases.delete(id)
            const lease = this.leases.get(id)
            if (lease) { this.leases.delete(id); void this.resources?.releaseImage(lease) }
          }
        }
        for (const [index, node] of state.scene.nodes.entries()) {
          this.metrics.nodeChecks++
          let ui = this.nodes.get(node.id)
          const old = this.nodeSnapshots.get(node.id)
          if (!ui) {
            ui = this.create(node); this.nodes.set(node.id, ui); this.app.tree.add(ui); this.metrics.created++
            if (node.type === 'image' && node.resource && !node.collapsed) {
              const load = this.loadImage(node, ui); this.imageLoads.add(load)
              void load.finally(() => this.imageLoads.delete(load))
            }
          } else if (node !== old || structureChanged) {
            if (this.app.editor.innerEditing && this.app.editor.innerEditor instanceof TextEditor &&
              this.app.editor.innerEditor.editTarget === this.plainTexts.get(node.id) && node.text !== old?.text) {
              this.discardTextCommit = true; this.app.editor.closeInnerEditor(); this.discardTextCommit = false
            }
            this.updateNode(ui, node, old!); this.metrics.updated++
          }
          if (ui.zIndex !== index) ui.zIndex = index
        }
        this.nodeSnapshots = next
        this.syncGroups(state)
      }
      const invalid = this.app.editor.list.some(ui => this.nodes.get(ui.id!) !== ui && this.groups.get(ui.id!) !== ui)
      const restoreSelection = !this.app.editor.list.length && state.selection.some(id => this.nodes.get(id)?.editable)
      if (!this.selectingNative && (state.selection !== previous?.selection || invalid || restoreSelection)) {
        const selection = this.selectionTargets(state)
        if (this.app.editor.list.length !== selection.length || this.app.editor.list.some((ui, i) => ui !== selection[i]))
          this.app.editor.select(selection)
      }
      if (state.interaction !== previous?.interaction) {
        this.app.editor.visible = !state.interaction
        this.app.editor.config.selector = !state.interaction
      }
    } finally { this.syncing = false }
  }
  private updateNode(ui: UI, node: BoardNode, old: BoardNode): void {
    if (this.updateImage(ui, node, old)) return
    const attributes = this.attributes(node)
    const changed = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => ui[key as keyof typeof attributes] !== value))
    if (Object.keys(changed).length) ui.set(changed)
    if (ui instanceof Text) {
      ui.set({ ...(node.text !== old.text ? { text: node.text ?? '' } : {}), fill: '#1e293b', stroke: undefined })
      return
    }
    if (node.type === 'line') ui.set({ path: `M 0 0 L ${node.width} 0` })
    if (node.type === 'arrow') ui.set({ points: [0, 0, node.width, 0] })
    if (!(ui instanceof Box)) return
    const text = this.plainTexts.get(node.id)
    if (text) text.set({ ...(node.text !== old.text ? { text: node.text ?? '' } : {}), width: Math.max(1, node.width - 24), height: Math.max(1, node.height - 24) })
    else if ((node.type === 'text' || node.type === 'note') &&
      (node.text !== old.text || node.html !== old.html || node.width !== old.width || node.height !== old.height)) {
      ui.clear(); drawRichText(ui, node)
    }
    const header = ui.children[0]
    if (node.collapsed || node.type === 'file' || node.type === 'video' || node.type === 'frame') {
      if (header instanceof Text) header.set({ text: node.collapsed ? '▸ ' + node.name : node.type === 'video' ? '▶ ' + node.name : node.type === 'file' ? '▤ ' + node.name : node.name,
        width: Math.max(1, node.width - 24) })
    }
    this.videoCanvases.get(node.id)?.set({ width: node.width, height: Math.max(1, node.height - 26) })
  }
  private syncGroups(state: Snapshot): void {
    const descriptors = new Map((state.scene.groups ?? []).map(g => [g.id, g]))
    for (const node of state.scene.nodes) if (node.group && !descriptors.has(node.group)) descriptors.set(node.group, { id: node.group })
    const changed = state.scene.groups !== this.lastGroups
    if (changed) for (const group of this.groups.values()) if (group.parent !== this.app.tree) this.app.tree.add(group)
    for (const [id, data] of descriptors) {
      let group = this.groups.get(id)
      if (!group) { group = new Group({ id, editable: true, hitChildren: false }); this.groups.set(id, group); this.app.tree.add(group) }
      if (changed || !this.lastGroups) group.set({ x: data.x ?? 0, y: data.y ?? 0, rotation: data.rotation ?? 0,
        scaleX: data.scaleX ?? 1, scaleY: data.scaleY ?? 1, skewX: data.skewX ?? 0, skewY: data.skewY ?? 0 })
    }
    // Set each group's board transform before reparenting with Leafer's own API.
    if (changed) {
      const attach = (id: string): void => {
        const data = descriptors.get(id)!, group = this.groups.get(id)!
        if (data.parent) { attach(data.parent); const parent = this.groups.get(data.parent)!; if (group.parent !== parent) group.dropTo(parent) }
        else if (group.parent !== this.app.tree) group.dropTo(this.app.tree)
      }
      for (const id of descriptors.keys()) attach(id)
    }
    for (const [id, ui] of this.nodes) {
      const node = this.nodeSnapshots.get(id)!, parent = node.group ? this.groups.get(node.group)! : this.app.tree
      if (ui.parent !== parent) ui.dropTo(parent)
    }
    for (const [id, group] of this.groups) if (!descriptors.has(id)) {
      for (const child of [...group.children]) child.dropTo(this.app.tree)
      this.app.editor.openedGroupList.remove(group)
      group.destroy(); this.groups.delete(id)
    }
    const stats = new Map([...descriptors.keys()].map(id => [id, { editable: false, zIndex: 0 }]))
    state.scene.nodes.forEach((node, index) => {
      let id = node.group
      while (id) {
        const entry = stats.get(id)
        if (!entry) break
        entry.editable ||= !node.locked
        entry.zIndex = Math.max(entry.zIndex, index)
        id = descriptors.get(id)?.parent
      }
    })
    for (const [id, entry] of stats) this.groups.get(id)!.set(entry)
    this.lastGroups = state.scene.groups
  }
  private selectionTargets(state: Snapshot): UI[] {
    const chosen = new Set(state.selection), selected = new Set<UI>()
    for (const id of chosen) {
      const node = this.nodes.get(id)
      if (!node || !node.editable) continue
      let target: UI = node, parent = node.parent
      while (parent && parent !== this.app.tree) {
        if (parent instanceof Group && this.groups.get(parent.id!) === parent && !parent.hitChildren) target = parent
        parent = parent.parent
      }
      selected.add(target)
    }
    return [...selected]
  }
  private selectDeep(ids: string[]): string[] {
    const targets = ids.map(id => this.nodes.get(id)).filter((ui): ui is UI => !!ui && !!ui.editable)
    for (const target of targets) {
      let parent = target.parent
      while (parent && parent !== this.app.tree) { if (this.groups.get(parent.id!) === parent) this.app.editor.openGroup(parent); parent = parent.parent }
    }
    this.app.editor.select(targets)
    return this.board.getSnapshot().selection
  }
  private hasAncestor(ui: IUI, ancestor: IUI): boolean {
    let parent = ui.parent
    while (parent) { if (parent === ancestor) return true; parent = parent.parent }
    return false
  }
  private groupData(): NonNullable<Snapshot['scene']['groups']> {
    return [...this.groups].filter(([, group]) => this.hasAncestor(group, this.app.tree)).map(([id, group]) => {
      const layout = new Matrix(group.getTransform(this.app.tree)).getLayout()
      const previous = this.board.getSnapshot().scene.groups?.find(g => g.id === id)
      for (const key of ['x', 'y', 'rotation', 'scaleX', 'scaleY', 'skewX', 'skewY'] as const) {
        const old = previous?.[key]
        if (old !== undefined && Math.abs((layout[key] ?? (key.startsWith('scale') ? 1 : 0)) - old) < 0.000001) layout[key] = old
      }
      return { id, ...(group.parent && this.groups.get(group.parent.id!) === group.parent ? { parent: group.parent.id! } : {}),
        x: layout.x, y: layout.y, rotation: layout.rotation ?? 0, scaleX: layout.scaleX ?? 1, scaleY: layout.scaleY ?? 1,
        skewX: layout.skewX ?? 0, skewY: layout.skewY ?? 0 }
    })
  }
  private groupSelection(ungroup: boolean): string | boolean {
    if (this.app.editor.innerEditing) this.app.editor.closeInnerEditor()
    if (!this.app.editor.list.length) throw new Error('请选择元素')
    if (!ungroup && this.app.editor.list.length < 2) throw new Error('请选择至少两个元素或组合')
    let result: string | boolean = true
    this.syncing = true
    try {
      if (ungroup) {
        // Only real Group instances are eligible; Box cards must not be unpacked.
        const selected = this.app.editor.list.filter(ui => this.groups.get(ui.id!) === ui)
        if (!selected.length) return false
        this.app.editor.select(selected)
        this.app.editor.ungroup()
      } else {
        const parents = new Set(this.app.editor.list.map(ui => ui.parent))
        if (parents.size !== 1) throw new Error('请先关闭组合，再选择同一层级的元素编组')
        const id = crypto.randomUUID(), group = new Group({ id })
        this.app.editor.group(group)
        this.groups.set(id, group)
        result = id
      }
    } finally { this.syncing = false }
    this.commitTransforms(true)
    return result
  }
  private editText(args: Record<string, unknown>): unknown {
    const id = String(args.id ?? this.board.getSnapshot().selection[0] ?? '')
    const text = this.plainTexts.get(id), node = this.nodeSnapshots.get(id)
    if (!text || !node || node.locked || node.collapsed) throw new Error('请选择可编辑的纯文本或便签')
    const action = String(args.action ?? 'open')
    if (action === 'open') {
      if (this.app.editor.innerEditor instanceof TextEditor && this.app.editor.innerEditor.editTarget === text) return { id, text: text.text, native: true, editing: true, editor: 'TextEditor' }
      if (this.app.editor.innerEditing) this.app.editor.closeInnerEditor()
      this.selectDeep([id])
      this.app.editor.openInnerEditor(text, 'TextEditor')
    } else if (action === 'set') {
      if (!(this.app.editor.innerEditor instanceof TextEditor) || this.app.editor.innerEditor.editTarget !== text)
        throw new Error('请先打开此文字的官方编辑器')
      const value = String(args.text ?? '')
      if (value.length > 100000) throw new Error('文字不能超过 100000 字符')
      this.app.editor.innerEditor.editDom.innerText = value
      text.text = value
    } else if (action === 'close') this.app.editor.closeInnerEditor()
    else if (action !== 'inspect') throw new Error('不支持的文字编辑操作')
    return { id, text: text.text, native: true, editing: this.app.editor.innerEditing,
      editor: this.app.editor.innerEditor?.tag ?? null }
  }
  private updateImage(ui: UI, node: BoardNode, previous: BoardNode): boolean {
    if (!(ui instanceof ClipImage) || node.type !== 'image' || node.collapsed || previous.collapsed || node.resource !== previous.resource) return false
    // The image and decoded resource belong to this node, not to a history
    // snapshot. Geometry/style edits must not release and reacquire the source.
    const attributes = {
      x: node.x, y: node.y, width: node.width, height: node.height,
      rotation: node.rotation, scaleX: node.scaleX, scaleY: node.scaleY, skewX: node.skewX ?? 0, skewY: node.skewY ?? 0,
      editable: !node.locked, fill: node.fill
    }
    const changed = Object.fromEntries(Object.entries(attributes).filter(([key, value]) => ui[key as keyof typeof attributes] !== value))
    if (Object.keys(changed).length) ui.set(changed)
    const clip = clipOf(node) ?? {
      x: 0, y: 0, width: node.width, height: node.height, rotation: 0, scaleX: 1, scaleY: 1
    }
    const layer = this.layerState(ui.layerImg)
    if (Object.entries(clip).some(([key, value]) => Math.abs(layer[key] - value) > 0.001)) {
      // Keep the library's clip input current for pending URL initialization,
      // and update the already decoded child in this frame for undo/model edits.
      ui.set({ clip })
      ui.layerImg.set(clip)
    }
    return true
  }
  private attributes(node: BoardNode) {
    return {
      id: node.id,
      x: node.x,
      y: node.y,
      width: node.width,
      height: node.collapsed ? 46 : node.height,
      rotation: node.rotation,
      skewX: node.skewX ?? 0,
      skewY: node.skewY ?? 0,
      scaleX: node.scaleX,
      scaleY: node.scaleY,
      editable: !node.locked,
      fill: node.type === 'text' || node.type === 'line' || node.type === 'arrow' ? undefined : node.fill,
      stroke: node.type === 'text' ? undefined : node.type === 'line' || node.type === 'arrow' ? '#334155' : node.type === 'frame' ? '#94a3b8' : '#64748b',
      strokeWidth: node.type === 'line' || node.type === 'arrow' ? 3 : node.type === 'frame' ? 1 : 1.5,
      cornerRadius: node.type === 'note' ? 2 : 8
    }
  }
  private create(node: BoardNode): UI {
    const common = this.attributes(node)
    if (node.collapsed || ['video', 'file'].includes(node.type)) {
      const box = new Box(common)
      box.add(
        new Text({
          x: 12,
          y: 12,
          width: node.width - 24,
          text: node.collapsed ? '▸ ' + node.name : node.type === 'video' ? '▶ ' + node.name : '▤ ' + node.name,
          fontSize: 14,
          fill: '#334155'
        })
      )
      if (node.type === 'video' && !node.collapsed) {
        const canvas = new Canvas({
          x: 0,
          y: 26,
          width: node.width,
          height: Math.max(1, node.height - 26),
          fill: '#0f172a',
          pixelRatio: 1
        })
        box.add(canvas)
        this.videoCanvases.set(node.id, canvas)
      }
      if (node.type === 'file' && !node.collapsed)
        box.add(
          new Text({
            x: 12,
            y: 52,
            width: node.width - 24,
            text: '文件引用已保留\n内容阅读器后续接入',
            fontSize: 12,
            fill: '#64748b'
          })
        )
      return box
    }
    if (node.type === 'ellipse') return new Ellipse(common)
    if (node.type === 'arrow')
      return new Arrow({
        ...common,
        fill: undefined,
        points: [0, 0, node.width, 0],
        endArrow: 'arrow',
        stroke: '#334155',
        strokeWidth: 3
      })
    if (node.type === 'line')
      return new Path({
        ...common,
        fill: undefined,
        path: `M 0 0 L ${node.width} 0`,
        stroke: '#334155',
        strokeWidth: 3
      })
    if (node.type === 'text' && !node.html) {
      const text = new Text({ ...common, text: node.text ?? '', fontSize: 20, fontFamily: 'Arial', fill: '#1e293b', padding: 12, lineHeight: 30, textWrap: 'break', textOverflow: 'hide' })
      this.plainTexts.set(node.id, text)
      return text
    }
    if (node.type === 'text') {
      const box = new Box({ ...common, fill: undefined, stroke: undefined, overflow: 'hide' })
      drawRichText(box, node)
      return box
    }
    if (node.type === 'note' || node.type === 'frame') {
      const box = new Box(common)
      if (node.type === 'frame')
        box.add(new Text({ x: 12, y: 12, width: node.width - 24, text: node.name, fontSize: 14, fill: '#334155' }))
      else if (!node.html) {
        const text = new Text({ x: 12, y: 12, width: Math.max(1, node.width - 24), height: Math.max(1, node.height - 24),
          text: node.text ?? '', fontSize: 18, fontFamily: 'Arial', fill: '#1e293b', lineHeight: 27, textWrap: 'break', textOverflow: 'hide' })
        box.add(text); this.plainTexts.set(node.id, text)
      } else drawRichText(box, node)
      return box
    }
    if (node.type === 'image') {
      const clip = clipOf(node)
      const ui = new ClipImage({
        ...common,
        ...(clip
          ? {
              clip
            }
          : {})
      })
      return ui
    }
    return new Rect(common)
  }
  private async loadImage(node: BoardNode, ui: UI): Promise<void> {
    if (!this.resources || !node.resource) return
    let lease: Awaited<ReturnType<Resources['acquireImage']>> | undefined
    try {
      lease = await this.resources.acquireImage(node.resource)
      if (this.disposed || this.nodes.get(node.id) !== ui) {
        await this.resources.releaseImage(lease.leaseId)
        return
      }
      this.leases.set(node.id, lease.leaseId)
      ;(ui as ClipImage).set({ url: lease.url })
    } catch (error) {
      if (!this.disposed && this.nodes.get(node.id) === ui)
        (ui as Box).add(
          new Text({
            x: 10,
            y: 10,
            width: node.width - 20,
            text: '原图片不可用\n' + node.name,
            fontSize: 13,
            fill: '#b45309'
          })
        )
      if (lease) {
        if (this.leases.get(node.id) === lease.leaseId) this.leases.delete(node.id)
        await this.resources.releaseImage(lease.leaseId)
      }
    }
  }
  private async openClipEditor(): Promise<boolean> {
    const state = this.board.getSnapshot()
    const node = state.scene.nodes.find(
      (n) => state.selection.includes(n.id) && n.type === 'image' && !n.locked
    )
    if (!node) throw new Error('请选择一张未锁定的图片')
    if (this.clipEditing === node.id) {
      this.app.editor.closeInnerEditor()
      return false
    }
    await Promise.allSettled([...this.imageLoads])
    if (this.disposed) return false
    const ui = this.nodes.get(node.id)
    if (!(ui instanceof ClipImage)) throw new Error('图片尚未载入，无法裁剪')
    const deadline = Date.now() + 3000
    while ((!ui.layerImg.url || !ui.layerImg.ready) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 30))
    if (!ui.layerImg.url || !ui.layerImg.ready) throw new Error('图片尚未载入，无法裁剪')
    if (state.selection.length !== 1) this.board.select([node.id])
    if (state.interaction) this.board.setInteraction(false)
    if (this.app.editor.innerEditing) {
      this.app.editor.closeInnerEditor()
      await Promise.resolve()
    }
    this.app.editor.openInnerEditor(ui, true)
    return this.app.editor.innerEditing
  }
  private layerState(image: ClipImage['layerImg']): Record<string, number> {
    return {
      x: Number(image.x ?? 0),
      y: Number(image.y ?? 0),
      width: Number(image.width ?? 0),
      height: Number(image.height ?? 0),
      rotation: Number(image.rotation ?? 0),
      scaleX: Number(image.scaleX ?? 1),
      scaleY: Number(image.scaleY ?? 1)
    }
  }
  private clipData(ui: ClipImage): NodeClip {
    const layer = this.layerState(ui.layerImg)
    return {
      x: layer.x,
      y: layer.y,
      width: Math.max(1e-4, layer.width),
      height: Math.max(1e-4, layer.height),
      rotation: layer.rotation,
      scaleX: layer.scaleX,
      scaleY: layer.scaleY
    }
  }
  private clipState(id?: string): Record<string, unknown> {
    const editingId = this.clipEditing
    const targetId = editingId ?? id ?? this.board.getSnapshot().selection[0]
    const ui = targetId ? this.nodes.get(targetId) : undefined
    if (!(ui instanceof ClipImage))
      return { editing: false, id: targetId ?? null, box: null, layer: null, clip: null }
    return {
      editing: !!editingId && editingId === targetId,
      id: targetId,
      box: {
        x: Number(ui.x ?? 0),
        y: Number(ui.y ?? 0),
        width: Number(ui.width ?? 0),
        height: Number(ui.height ?? 0),
        rotation: Number(ui.rotation ?? 0),
        scaleX: Number(ui.scaleX ?? 1),
        scaleY: Number(ui.scaleY ?? 1)
      },
      layer: this.layerState(ui.layerImg),
      clip: this.clipData(ui)
    }
  }
  private prepareClipCommit(id: string): (() => void) | undefined {
    if (this.disposed) return
    const ui = this.nodes.get(id)
    const node = this.board.getSnapshot().scene.nodes.find((n) => n.id === id)
    if (!(ui instanceof ClipImage) || !node || node.locked) return
    const clip = this.clipData(ui)
    const transform = {
      x: Number(ui.x ?? node.x),
      y: Number(ui.y ?? node.y),
      width: Math.max(0.1, Number(ui.width) || node.width),
      height: Math.max(0.1, Number(ui.height) || node.height),
      rotation: Number(ui.rotation ?? 0),
      scaleX: Number(ui.scaleX ?? 1),
      scaleY: Number(ui.scaleY ?? 1)
    }
    const boardId = this.board.getSnapshot().id
    return () => {
      if (this.disposed || this.board.getSnapshot().id !== boardId || this.nodes.get(id) !== ui) return
      this.board.edit((scene) => {
        const target = scene.nodes.find((n) => n.id === id)
        if (!target || target.type !== 'image' || target.locked) return
        Object.assign(target, transform)
        target.clip = clip
        target.clipSpace = 'leafer-local'
        delete target.crop
      })
    }
  }
  private syncGuideTargets(guides: Snapshot['scene']['guides'], view: Snapshot['scene']['view']): void {
    const next = new Map(guides.map((guide) => [guide.id, guide]))
    for (const [id, line] of this.guideTargets) {
      if (next.has(id)) continue
      line.destroy()
      this.guideTargets.delete(id)
    }
    for (const guide of guides) {
      let line = this.guideTargets.get(guide.id)
      if (!line) {
        line = new Line({ stroke: 'rgba(0,0,0,0)', strokeWidth: 1, isSnap: true })
        this.guideTargets.set(guide.id, line)
        this.app.sky.add(line)
      }
      line.set({
        points:
          guide.axis === 'x'
            ? [guide.value + view.x, 1_000_000 + view.y, guide.value + view.x, 2_000_000 + view.y]
            : [1_000_000 + view.x, guide.value + view.y, 2_000_000 + view.x, guide.value + view.y]
      })
    }
  }
  private scheduleTransformCommit(): void {
    // Capture the interaction's ownership now, before a double tap closes the
    // inner editor later in this same event stack.
    if (this.app.editor.innerEditing || this.clipEditing || this.pendingClipCommits) return
    queueMicrotask(() => this.commitTransforms())
  }
  private async profileMove(mount: HTMLElement, args: Record<string, unknown>): Promise<Record<string, unknown>> {
    const steps = Number(args.steps ?? 60), dx = Number(args.dx ?? 1), dy = Number(args.dy ?? 0)
    if (!Number.isInteger(steps) || steps < 10 || steps > 120 || ![dx, dy].every(v => Number.isFinite(v) && Math.abs(v) <= 10)) throw new Error('移动测量参数无效')
    if (this.app.editor.innerEditing || !this.app.editor.list.length) throw new Error('请先选择可移动对象并退出内部编辑')
    if (args.effects !== undefined && args.effects !== 'opaque' && args.effects !== 'current') throw new Error('测量效果参数无效')
    const panel = mount.closest('.wb-panel')
    const opaque = panel?.hasAttribute('data-wb-profile-opaque') ?? false
    panel?.toggleAttribute('data-wb-profile-opaque', args.effects === 'opaque')
    const snapshot = this.board.getSnapshot(), scene = snapshot.scene
    const target = this.app.editor.list[0], start = { x: target.x ?? 0, y: target.y ?? 0 }
    const cpu: number[] = [], frames: number[] = [], draw: number[] = [], hit: number[] = []
    let drawStart = 0
    const beforeDraw = (): void => { drawStart = performance.now() }
    const afterDraw = (): void => { if (drawStart) draw.push(performance.now() - drawStart) }
    this.app.tree.on(RenderEvent.START, beforeDraw)
    this.app.tree.on(RenderEvent.END, afterDraw)
    let last = 0, maximumOffset = 0
    try {
      for (let i = 0; i < steps; i++) {
        const time = await new Promise<number>(resolve => requestAnimationFrame(resolve))
        if (this.disposed || this.board.getSnapshot().id !== snapshot.id || this.board.getSnapshot().scene !== scene) throw new Error('测量期间画板已变化')
        if (last) frames.push(time - last)
        last = time
        const before = performance.now()
        this.app.editor.move(dx, dy)
        cpu.push(performance.now() - before)
        const point = target.getWorldPoint({ x: (target.width ?? 1) / 2, y: (target.height ?? 1) / 2 })
        const hitStart = performance.now()
        this.app.tree.selector?.getByPoint(point, 0)
        hit.push(performance.now() - hitStart)
        maximumOffset = Math.max(maximumOffset, Math.abs((target.x ?? 0) - start.x - dx * (i + 1)), Math.abs((target.y ?? 0) - start.y - dy * (i + 1)))
      }
      const summary = (data: number[]): Record<string, number> => {
        const sorted = [...data].sort((a, b) => a - b)
        return { p50: sorted[Math.floor(sorted.length * 0.5)] ?? 0, p95: sorted[Math.floor(sorted.length * 0.95)] ?? 0, max: sorted.at(-1) ?? 0 }
      }
      this.snap.enable(false)
      const sceneUpdatesDuringMove = this.board.getSnapshot().revision - snapshot.revision
      this.commitTransforms()
      return { steps, nodes: scene.nodes.length, snap: scene.snap, effects: args.effects ?? 'current', cpu: summary(cpu), draw: summary(draw), hit: summary(hit), frame: summary(frames), maximumOffset, sceneUpdatesDuringMove, devicePixelRatio: window.devicePixelRatio }
    } finally {
      panel?.toggleAttribute('data-wb-profile-opaque', opaque)
      this.app.tree.off(RenderEvent.START, beforeDraw)
      this.app.tree.off(RenderEvent.END, afterDraw)
      this.snap.enable(this.board.getSnapshot().scene.snap)
    }
  }
  private commitTransforms(groupStructure = false): void {
    if (this.disposed || this.syncing || this.app.editor.innerEditing || this.clipEditing || this.pendingClipCommits) return
    const state = this.board.getSnapshot()
    const transforms = new Map<
      string,
      { x: number; y: number; width: number; height: number; rotation: number; scaleX: number; scaleY: number; skewX?: number; skewY?: number; group?: string; clip?: NodeClip; clipSpace?: 'leafer-local' }
    >()
    for (const node of state.scene.nodes) {
      if (node.locked) continue
      const ui = this.nodes.get(node.id)
      if (!ui) continue
      const layout = ui.parent !== this.app.tree ? new Matrix(ui.getTransform(this.app.tree)).getLayout() : ui
      const parent = ui.parent && this.groups.get(ui.parent.id!) === ui.parent ? ui.parent.id : undefined
      const transform = {
        x: layout.x ?? 0,
        y: layout.y ?? 0,
        width: Math.max(0.1, ui.width ?? node.width),
        height: node.collapsed ? node.height : Math.max(0.1, ui.height ?? node.height),
        rotation: layout.rotation ?? 0,
        scaleX: layout.scaleX ?? 1,
        scaleY: layout.scaleY ?? 1,
        skewX: layout.skewX ?? 0,
        skewY: layout.skewY ?? 0
      }
      if (groupStructure ||
        Object.entries(transform).some(([key, value]) => Math.abs((node[key as keyof typeof transform] ?? (key.startsWith('scale') ? 1 : 0)) - value) > 0.001)
      )
        transforms.set(node.id, {
          ...transform,
          ...(groupStructure ? { group: parent } : {}),
          // Native Box resizing also resizes the crop's child image. Persist
          // that transform together with its frame, not the previous clip.
          ...(ui instanceof ClipImage && ui.layerImg.ready && (node.clip || node.crop)
            ? { clip: this.clipData(ui), clipSpace: 'leafer-local' as const }
            : {})
        })
    }
    const groups = this.groupData()
    const groupsChanged = groups.length > 0 && JSON.stringify(groups) !== JSON.stringify(state.scene.groups)
    if (transforms.size || groupStructure || groupsChanged) {
      this.board.edit(scene => {
        for (const node of scene.nodes) {
          const transform = transforms.get(node.id)
          if (transform) { Object.assign(node, transform); if (transform.clip) delete node.crop }
        }
        if (groupStructure || groupsChanged) scene.groups = groups
      })
    }
  }
  fit(selection = false): void {
    const state = this.board.getSnapshot(),
      nodes = state.scene.nodes.filter((n) => !selection || state.selection.includes(n.id))
    if (!nodes.length) {
      this.board.setView({ x: 60, y: 60, zoom: 1 })
      return
    }
    this.app.tree.updateLayout()
    const elements = nodes.map((node) => this.nodes.get(node.id)).filter((node): node is UI => !!node)
    if (!elements.length) {
      this.board.setView({ x: 60, y: 60, zoom: 1 })
      return
    }
    this.app.tree.zoom(elements, 50)
    this.persistView()
  }
  private persistView(): void {
    if (this.disposed || this.syncing) return
    const layer = this.app.tree.zoomLayer
    const view = { x: Number(layer.x ?? 0), y: Number(layer.y ?? 0), zoom: Number(layer.scaleX ?? 1) }
    const current = this.board.getSnapshot().scene.view
    if (
      Math.abs(current.x - view.x) > 0.001 ||
      Math.abs(current.y - view.y) > 0.001 ||
      Math.abs(current.zoom - view.zoom) > 0.000001
    )
      this.board.setView(view)
  }
  destroy(): void {
    if (this.app.editor.innerEditing) this.app.editor.closeInnerEditor()
    this.disposed = true
    if (this.viewCommitFrame) cancelAnimationFrame(this.viewCommitFrame)
    this.snap.enable(false)
    this.snap.destroy()
    this.themeObserver.disconnect()
    this.ruler.dispose()
    this.unsubscribe()
    this.observer.disconnect()
    this.commandDisposers.forEach((fn) => fn())
    this.app.destroy()
    for (const lease of this.leases.values()) void this.resources?.releaseImage(lease)
    this.leases.clear()
  }
}
