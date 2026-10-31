import { contextBridge, ipcRenderer, webUtils } from 'electron'

type BridgeEventListener = (channel: string, payload: unknown, traceId?: string) => void
const eventListeners = new Set<BridgeEventListener>()

// DOM File objects cannot cross Electron IPC. Normalize only file arguments at
// the existing bridge boundary; registration and all business logic stay in plugins.
const ipcArgument = (value: unknown): unknown => {
  if (value instanceof File) {
    const path = webUtils.getPathForFile(value)
    if (!path) throw new Error('该图片没有本地源文件，无法创建文件链接，请先保存到本地')
    return path
  }
  return Array.isArray(value) ? value.map(ipcArgument) : value
}

ipcRenderer.on('bridge:event', (_event, channel: string, payload: unknown, traceId?: string) => {
  for (const listener of eventListeners) listener(channel, payload, traceId)
})

contextBridge.exposeInMainWorld('bridge', {
  invoke: (service: string, method: string, ...args: unknown[]): Promise<unknown> => {
    const last = args.at(-1)
    const traceEnvelope = last && typeof last === 'object'
      ? last as { __desksuiteInternalTrace?: unknown; traceId?: unknown }
      : undefined
    const suppliedTraceId = traceEnvelope?.__desksuiteInternalTrace === true && typeof traceEnvelope.traceId === 'string'
      ? traceEnvelope.traceId
      : undefined
    if (suppliedTraceId) args.pop()
    const requestId = suppliedTraceId ?? `ui-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`
    return ipcRenderer.invoke('bridge:invoke', service, method, args.map(ipcArgument), requestId)
  },
  onEvent: (listener: BridgeEventListener): (() => void) => {
    eventListeners.add(listener)
    return () => eventListeners.delete(listener)
  }
})
