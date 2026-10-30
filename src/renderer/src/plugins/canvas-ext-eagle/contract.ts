import type { ComponentType } from 'react'
export interface EagleSource {
  itemId: string; name: string; resourceUri: string; originalPath: string; thumbnailPath: string
  apiUrl: string; folders: { id: string; name: string }[]; tags: string[]; annotation: string
  url: string; width: number; height: number; size: number; rating: number; updatedAt: number
}
export interface Node { id: string; type: string; resource?: string }
export interface Canvas {
  getSnapshot(): { selection: string[]; scene: { nodes: Node[] } }
  report(error: unknown): void
  register(name: string, handler: (args: Record<string, unknown>) => unknown): () => void
  registerInspector(id: string, component: ComponentType<{ node: Node }>): () => void
  registerResourceEnricher(id: string, handler: (reference: string) => Promise<{ name?: string; tags?: string[] } | undefined>): () => void
  registerLinkResolver(id: string, handler: (url: string) => Promise<string | undefined>): () => void
}
