import type { ComponentType } from 'react'
import { getService } from '../../workbench/sdk'
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
}

export interface CanvasService {
  enrichResource(reference: string): Promise<{ name?: string; tags?: string[] }>
  resolveLink(url: string): Promise<string>
  registerContent(kind: string, component: ComponentType<{ node: BoardNode; interactive: boolean }>): () => void
  getContent(kind: string): ComponentType<{ node: BoardNode; interactive: boolean }> | undefined
  getSnapshot(): Snapshot
  subscribe(fn: () => void): () => void
  edit(fn: (scene: Scene) => void): void
  select(ids: string[], expandGroups?: boolean): void
  setView(view: Scene['view']): void
  setInteraction(value: boolean): void
  history(direction: 'undo' | 'redo'): void
  register(name: string, handler: (args: Record<string, unknown>) => unknown | Promise<unknown>): () => void
  command(name: string, args?: Record<string, unknown>): Promise<unknown>
  open(id?: string): Promise<void>
  create(title?: string): Promise<void>
  remove(): Promise<void>
  replace(json: string): Promise<void>
  flush(): Promise<void>
  refresh(): Promise<void>
  report(error: unknown): void
}
export const getCanvas = (): CanvasService | undefined => getService<CanvasService>('canvas')
