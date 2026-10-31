import { logStore } from './logs'

export async function call<T = unknown>(
  service: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  return callWithTrace<T>(`ui-${crypto.randomUUID()}`, service, method, ...args)
}

export async function callWithTrace<T = unknown>(
  traceId: string,
  service: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const callId = `ui-${crypto.randomUUID()}`
  const startedAt = performance.now()
  logStore.push({
    id: `${callId}:send`, level: 'event', source: 'Renderer',
    message: `发送 IPC ${service}.${method}`, tags: ['ipc', service], category: 'transfer',
    traceId, phase: '发送', status: 'running'
  })
  try {
    const result = await window.bridge.invoke(service, method, ...args, {
      __desksuiteInternalTrace: true,
      traceId
    }) as T
    logStore.push({
      id: `${callId}:receive`, level: 'info', source: 'Renderer',
      message: `收到 IPC ${service}.${method} 返回`, tags: ['ipc', service], category: 'result',
      traceId, phase: '接收', durationMs: Math.round(performance.now() - startedAt), status: 'ok'
    })
    return result
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    logStore.push({
      id: `${callId}:receive`, level: 'error', source: 'Renderer',
      message: `IPC ${service}.${method} 调用失败`, payload: { error: message },
      tags: ['ipc', service], category: 'result', traceId, phase: '接收',
      durationMs: Math.round(performance.now() - startedAt), status: 'error'
    })
    throw error
  }
}
