export interface Bridge {
  invoke(service: string, method: string, ...args: unknown[]): Promise<unknown>
  onEvent(listener: (channel: string, payload: unknown, traceId?: string) => void): () => void
}

declare global {
  interface Window {
    bridge: Bridge
  }
}

export function useBridge(): Bridge {
  return window.bridge
}
