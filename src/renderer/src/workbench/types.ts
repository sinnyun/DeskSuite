import type { ComponentType, ReactNode } from 'react'

export type SlotId =
  | 'app.root'
  | 'top.actions'
  | 'top.window_controls'
  | 'sidebar.activity'
  | 'sidebar.activity.bottom'
  | 'sidebar.left.tabs'
  | 'sidebar.left.content'
  | 'workspace.toolbar'
  | 'workspace.views'
  | 'sidebar.right.tabs'
  | 'sidebar.right.content'
  | 'bottom.tabs'
  | 'bottom.toolbar'
  | 'bottom.content'
  | 'statusbar.left'
  | 'statusbar.right'
  | 'floating.panels'
    | 'overlay.root'

export interface SlotLabelProps {
  active: boolean
}

export interface SlotContribution {
  id: string
  slotId: SlotId
  order?: number
  title?: string
  icon?: ReactNode
  badge?: string | number
  // 宿主在注册时回填，用于按插件启停过滤贡献
  pluginId?: string
  // 标签类贡献可以只声明 title/icon，不挂载 component
  component?: ComponentType<Record<string, never>>
  // 动态标签：需要随运行状态变化的页签（如错误计数）由插件提供组件
  label?: ComponentType<SlotLabelProps>
}

export interface RendererPlugin {
  id: string
  name: string
  version: string
  description: string
  author?: string
  // 核心插件不参与运行时启停，避免外壳/UI 原语/控制中心被关闭后无法恢复
  core?: boolean
  contributions?: SlotContribution[]
  services?: Record<string, unknown>
  setup?: () => void | (() => void)
}

export interface PluginCatalogEntry {
  id: string
  name: string
  version: string
  description: string
  author: string
  contributions: number
  hasSetup: boolean
  core: boolean
  enabled: boolean
}

export interface PluginCatalogService {
  list(): PluginCatalogEntry[]
  getSnapshot(): PluginCatalogEntry[]
  subscribe(listener: () => void): () => void
  isEnabled(id: string): boolean
  setEnabled(id: string, enabled: boolean): void
}

export type ThemeMode = 'light' | 'dark' | 'system'

export interface SelectionItem {
  path: string
  name: string
  isDirectory: boolean
  kind: string
  size: number
  modifiedAt: number
}

export interface SelectionSnapshot {
  path: string | null
  entries: SelectionItem[]
  selected: SelectionItem[]
}

export interface SelectionService {
  getSnapshot(): SelectionSnapshot
  subscribe(listener: () => void): () => void
}

export interface BasketItem extends SelectionItem {
  addedAt: number
}

export interface BasketService {
  list(): BasketItem[]
  add(items: SelectionItem[]): void
  remove(path: string): void
  clear(): void
  subscribe(listener: () => void): () => void
}

export type McpAccess = 'off' | 'read' | 'standard' | 'full'

export interface McpToolInfo {
  name: string
  mutating: boolean
  impact: 'low' | 'high'
}

export interface RuntimeInfo {
  appName: string
  appVersion: string
  electron: string
  chrome: string
  node: string
  platform: string
  arch: string
  mcpPort: number
  mcpTools: McpToolInfo[]
  services: string[]
}
