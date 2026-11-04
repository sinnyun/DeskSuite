import type { FileOperation } from './index'

export interface FileOperationRequest {
  op: FileOperation
  sources?: string[]
  target?: string
}

type Listener = (request: FileOperationRequest) => void
const listeners = new Set<Listener>()

export function requestFileOperation(request: FileOperationRequest): void {
  for (const listener of listeners) listener(request)
}

export function subscribeFileOperations(listener: Listener): () => void {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export interface AppClipboard {
  kind: 'copy' | 'cut'
  sources: string[]
}

let appClipboard: AppClipboard | null = null

export function setAppClipboard(kind: AppClipboard['kind'], sources: string[]): void {
  if (!sources.length) return
  appClipboard = { kind, sources: [...sources] }
}

export function getAppClipboard(): AppClipboard | null {
  return appClipboard
}

export function joinPath(dir: string, name: string): string {
  const separator = navigator.platform.toLowerCase().startsWith('win') ? '\\' : '/'
  return `${dir.replace(/[\\/]+$/, '')}${separator}${name}`
}
