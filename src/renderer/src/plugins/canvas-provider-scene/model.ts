import { call } from '../../workbench/sdk'
import { sceneSchema } from './validation'
import type { ComponentType } from 'react'

export interface NodeClip {
  x: number
  y: number
  width: number
  height: number
  rotation: number
  skewX?: number
  skewY?: number
  scaleX: number
  scaleY: number
}
export interface BoardNode {
  id: string
  type: 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note' | 'frame' | 'image' | 'video' | 'file'
  name: string
  x: number
  y: number
  width: number
  height: number
  rotation: number
  skewX?: number
  skewY?: number
  scaleX: number
  scaleY: number
  fill: string
  tags: string[]
  locked: boolean
  collapsed: boolean
  text?: string
  html?: string
  resource?: string
  resourceKind?: string
  group?: string
  frame?: string
  crop?: { x: number; y: number; width: number; height: number }
  clip?: NodeClip
  clipSpace?: 'leafer-local'
}
export interface Scene {
  format: 'desksuite-leafer'
  version: 1
  title: string
  nodes: BoardNode[]
  groups?: { id: string; parent?: string; x?: number; y?: number; rotation?: number; scaleX?: number; scaleY?: number; skewX?: number; skewY?: number }[]
  view: { x: number; y: number; zoom: number }
  background: 'dots' | 'grid' | 'none'
  snap: boolean
  rulers: boolean
  guides: { id: string; axis: 'x' | 'y'; value: number }[]
  bookmarks: { id: string; name: string; x: number; y: number; zoom: number }[]
}
export interface Snapshot {
  id: string
  scene: Scene
  selection: string[]
  revision: number
  saving: boolean
  error: string
  boards: { id: string; title: string }[]
  canUndo: boolean
  canRedo: boolean
  interaction: boolean
  cropEditing: string | null
  textEditing: string | null
}
export const emptyScene = (): Scene => ({
  format: 'desksuite-leafer',
  version: 1,
  title: '我的画板',
  nodes: [],
  view: { x: 60, y: 60, zoom: 1 },
  background: 'dots',
  snap: true,
  rulers: false,
  guides: [],
  bookmarks: []
})
type Args = Record<string, unknown>
type Handler = (args: Args) => unknown | Promise<unknown>
type ContentView = ComponentType<{ node: BoardNode; interactive: boolean }>
type InspectorView = ComponentType<{ node: BoardNode }>
type Enricher = (reference: string) => Promise<{ name?: string; tags?: string[] } | undefined>
const clone = <T>(value: T): T => structuredClone(value)

export class BoardService {
  private state: Snapshot = {
    id: '',
    scene: emptyScene(),
    selection: [],
    revision: 0,
    saving: false,
    error: '',
    boards: [],
    canUndo: false,
    canRedo: false,
    interaction: false,
    cropEditing: null,
    textEditing: null
  }
  private listeners = new Set<() => void>()
  private undo: Scene[] = []
  private redo: Scene[] = []
  private pending = new Map<string, Scene>()
  private saveTimer: ReturnType<typeof setTimeout> | undefined
  private maxSaveTimer: ReturnType<typeof setTimeout> | undefined
  private saved = new Map<string, string>()
  private historySizes = new WeakMap<Scene, number>()
  private writer: Promise<void> | undefined
  private commands = new Map<string, Handler>()
  private contentViews = new Map<string, ContentView>()
  private inspectors = new Map<string, InspectorView>()
  private resourceEnrichers = new Map<string, Enricher>()
  private linkResolvers = new Map<string, (url: string) => Promise<string | undefined>>()
  private navigation: Promise<unknown> = Promise.resolve()
  getSnapshot = (): Snapshot => this.state
  subscribe = (fn: () => void): (() => void) => {
    this.listeners.add(fn)
    return () => this.listeners.delete(fn)
  }
  private emit(patch: Partial<Snapshot> = {}): void {
    this.state = {
      ...this.state,
      ...patch,
      revision: this.state.revision + 1,
      canUndo: !!this.undo.length,
      canRedo: !!this.redo.length
    }
    this.listeners.forEach((fn) => fn())
  }
  report(error: unknown): void {
    this.emit({ error: String(error) })
  }
  registerContent(kind: string, component: ContentView): () => void {
    if (this.contentViews.has(kind)) throw new Error(`资源阅读器重复: ${kind}`)
    this.contentViews.set(kind, component)
    this.emit()
    return () => {
      this.contentViews.delete(kind)
      this.emit()
    }
  }
  getContent(kind: string): ContentView | undefined {
    return this.contentViews.get(kind)
  }
  registerInspector(id: string, component: InspectorView): () => void {
    if (this.inspectors.has(id)) throw new Error(`属性扩展重复: ${id}`)
    this.inspectors.set(id, component)
    this.emit()
    return () => { this.inspectors.delete(id); this.emit() }
  }
  getInspectors(): Array<[string, InspectorView]> { return [...this.inspectors] }
  registerResourceEnricher(id: string, handler: Enricher): () => void {
    if (this.resourceEnrichers.has(id)) throw new Error(`资源扩展重复: ${id}`)
    this.resourceEnrichers.set(id, handler)
    return () => { this.resourceEnrichers.delete(id) }
  }
  async enrichResource(reference: string): Promise<{ name?: string; tags?: string[] }> {
    const patch: { name?: string; tags?: string[] } = {}
    for (const handler of this.resourceEnrichers.values()) Object.assign(patch, await handler(reference))
    return patch
  }
  registerLinkResolver(id: string, handler: (url: string) => Promise<string | undefined>): () => void {
    if (this.linkResolvers.has(id)) throw new Error(`链接扩展重复: ${id}`)
    this.linkResolvers.set(id, handler)
    return () => { this.linkResolvers.delete(id) }
  }
  async resolveLink(url: string): Promise<string> {
    for (const handler of this.linkResolvers.values()) {
      const reference = await handler(url)
      if (reference) return reference
    }
    throw new Error('没有可用的插件解析此链接，请拖入本地文件或统一资源链接')
  }
  register(name: string, handler: Handler): () => void {
    if (this.commands.has(name)) throw new Error(`画板命令重复: ${name}`)
    this.commands.set(name, handler)
    return () => {
      this.commands.delete(name)
    }
  }
  async command(name: string, args: Args = {}): Promise<unknown> {
    const handler = this.commands.get(name)
    if (!handler) throw new Error(`画板能力未启用: ${name}`)
    return handler(args)
  }
  private clearSaveTimers(): void {
    clearTimeout(this.saveTimer)
    clearTimeout(this.maxSaveTimer)
    this.saveTimer = this.maxSaveTimer = undefined
  }
  private queueSave(): void {
    if (!this.state.id) return
    // Snapshots are immutable: serialize only when the debounce actually writes.
    this.pending.set(this.state.id, this.state.scene)
    if (!this.state.saving) this.emit({ saving: true })
    clearTimeout(this.saveTimer)
    const save = (): void => { void this.flush().catch(() => {}) }
    this.saveTimer = setTimeout(save, 500)
    this.maxSaveTimer ??= setTimeout(save, 2000)
  }
  async flush(): Promise<void> {
    await this.commands.get('commitEditing')?.({})
    this.clearSaveTimers()
    if (this.writer) {
      await this.writer
      if (this.pending.size) return this.flush()
      return
    }
    if (!this.pending.size) return
    this.writer = (async () => {
      try {
        while (this.pending.size) {
          const [id, scene] = this.pending.entries().next().value!
          const json = JSON.stringify(scene)
          if (this.saved.get(id) !== json) {
            await call('whiteboard', 'set', id, json)
            this.saved.set(id, json)
          }
          if (this.pending.get(id) === scene) this.pending.delete(id)
        }
        this.emit({ error: '' })
      } catch (cause) {
        this.report(cause)
        throw cause
      } finally {
        this.clearSaveTimers()
        // Keep pending failures visibly unsaved until an explicit retry or edit.
        this.emit({ saving: this.pending.size > 0 })
      }
    })()
    try { await this.writer } finally { this.writer = undefined }
  }
  private historySize(scene: Scene): number {
    let size = this.historySizes.get(scene)
    if (size === undefined) {
      size = JSON.stringify(scene).length
      this.historySizes.set(scene, size)
    }
    return size
  }
  edit(fn: (scene: Scene) => void): void {
    if (!this.state.id) throw new Error('请先打开画板')
    const before = this.state.scene
    const scene = clone(before)
    fn(scene)
    // Prune empty native groups while retaining ancestors of live members.
    if (scene.groups) {
      const groups = new Map(scene.groups.map(g => [g.id, g]))
      const used = new Set<string>()
      for (const node of scene.nodes) {
        let id = node.group
        while (id && !used.has(id)) { used.add(id); id = groups.get(id)?.parent }
      }
      scene.groups = scene.groups.filter(g => used.has(g.id))
    }
    sceneSchema.parse(scene)
    const oldNodes = new Map(before.nodes.map(n => [n.id, n]))
    scene.nodes = scene.nodes.map(n => {
      const previous = oldNodes.get(n.id)
      return previous && JSON.stringify(previous) === JSON.stringify(n) ? previous : n
    })
    if (scene.nodes.length === before.nodes.length && scene.nodes.every((n, i) => n === before.nodes[i])) scene.nodes = before.nodes
    for (const key of ['view', 'groups', 'guides', 'bookmarks'] as const) {
      if (JSON.stringify(scene[key]) === JSON.stringify(before[key])) Object.assign(scene, { [key]: before[key] })
    }
    if (JSON.stringify(scene) === JSON.stringify(before)) return
    this.undo.push(before)
    if (this.undo.length > 100) this.undo.shift()
    while (
      this.undo.length > 1 &&
      this.undo.reduce((bytes, item) => bytes + this.historySize(item), 0) > 16 * 1024 * 1024
    )
      this.undo.shift()
    this.redo = []
    this.emit({
      scene,
      boards: this.state.boards.map((b) => (b.id === this.state.id ? { ...b, title: scene.title } : b))
    })
    this.queueSave()
  }
  select(ids: string[], expandGroups = true): void {
    const expanded = new Set(ids)
    const parents = new Map((this.state.scene.groups ?? []).map(g => [g.id, g.parent]))
    const root = (id: string): string => { while (parents.get(id)) id = parents.get(id)!; return id }
    for (const n of this.state.scene.nodes)
      if (expanded.has(n.id)) {
        if (expandGroups && n.group) for (const peer of this.state.scene.nodes)
          if (peer.group && root(peer.group) === root(n.group)) expanded.add(peer.id)
        if (n.type === 'frame')
          for (const peer of this.state.scene.nodes) if (peer.frame === n.id) expanded.add(peer.id)
      }
    const selection = [...expanded].filter((id) => this.state.scene.nodes.some((n) => n.id === id))
    if (selection.length !== this.state.selection.length || selection.some((id, i) => id !== this.state.selection[i])) this.emit({ selection })
  }
  setInteraction(value: boolean): void {
    this.emit({ interaction: value })
  }
  setTextEditing(id: string | null): void {
    if (this.state.textEditing !== id) this.emit({ textEditing: id })
  }
  setCropEditing(id: string | null): void {
    this.emit({ cropEditing: id, interaction: id ? false : this.state.interaction })
  }
  setView(view: Scene['view']): void {
    if (
      ![view.x, view.y, view.zoom].every(Number.isFinite) ||
      Math.abs(view.x) > 1e7 ||
      Math.abs(view.y) > 1e7 ||
      view.zoom < 0.05 ||
      view.zoom > 8
    )
      throw new Error('视图数值无效')
    const previous = this.state.scene.view
    if (previous.x === view.x && previous.y === view.y && previous.zoom === view.zoom) return
    this.emit({ scene: { ...this.state.scene, view: { ...view } } })
    this.queueSave()
  }
  history(direction: 'undo' | 'redo'): void {
    const from = direction === 'undo' ? this.undo : this.redo
    const to = direction === 'undo' ? this.redo : this.undo
    const next = from.pop()
    if (next) {
      to.push(this.state.scene)
      this.emit({ scene: next, selection: [], cropEditing: null })
      this.queueSave()
    }
  }
  async refresh(): Promise<void> {
    const boards = await call<{ id: string; title: string }[]>('whiteboard', 'summaries')
    this.emit({ boards })
  }
  open(id?: string): Promise<void> {
    const task = this.navigation
      .catch(() => {})
      .then(async () => {
        await this.flush()
        await this.refresh()
        const next = id ?? this.state.id ?? this.state.boards[0]?.id
        const target = next || this.state.boards[0]?.id || crypto.randomUUID()
        const raw = await call<string | null>('whiteboard', 'get', target)
        const scene = raw ? (JSON.parse(raw) as Scene) : emptyScene()
        if (!raw) await call('whiteboard', 'set', target, JSON.stringify(scene))
        this.saved.clear()
        this.saved.set(target, JSON.stringify(scene))
        this.undo = []
        this.redo = []
        this.emit({ id: target, scene, selection: [], error: '', cropEditing: null })
        await this.refresh()
      })
    this.navigation = task
    return task
  }
  async create(title = '新画板'): Promise<void> {
    const id = crypto.randomUUID()
    await call('whiteboard', 'set', id, JSON.stringify({ ...emptyScene(), title }))
    await this.open(id)
  }
  async remove(): Promise<void> {
    await this.flush()
    await call('whiteboard', 'remove', this.state.id)
    this.emit({ id: '' })
    await this.refresh()
    await this.open(this.state.boards[0]?.id)
  }
  async replace(json: string): Promise<void> {
    // Main-process schema validation happens before the editor accepts external data.
    await this.flush()
    await call('whiteboard', 'set', this.state.id, json)
    await this.open(this.state.id)
  }
}
export const board = new BoardService()
