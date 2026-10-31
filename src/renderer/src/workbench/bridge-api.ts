import { logStore } from './logs'
import { errorText } from './error-text'

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
    const message = errorText(error, 'IPC 调用失败')
    logStore.push({
      id: `${callId}:receive`, level: 'error', source: 'Renderer',
      message: `IPC ${service}.${method} 调用失败`, payload: { error: message },
      tags: ['ipc', service], category: 'result', traceId, phase: '接收',
      durationMs: Math.round(performance.now() - startedAt), status: 'error'
    })
    throw error
  }
}

export interface RuntimeDecoder<T> {
  safeParse(value: unknown): { success: true; data: T } | { success: false; error: { issues: Array<{ path: PropertyKey[]; message: string }> } }
}

export async function callValidated<T>(
  decoder: RuntimeDecoder<T>,
  service: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  return callValidatedWithTrace(decoder, `ui-${crypto.randomUUID()}`, service, method, ...args)
}

export async function callValidatedWithTrace<T>(
  decoder: RuntimeDecoder<T>,
  traceId: string,
  service: string,
  method: string,
  ...args: unknown[]
): Promise<T> {
  const result = await callWithTrace<unknown>(traceId, service, method, ...args)
  const parsed = decoder.safeParse(result)
  if (parsed.success) return parsed.data
  const errors = parsed.error.issues.map((issue) => ({ path: issue.path.filter((part): part is string | number => typeof part === 'string' || typeof part === 'number'), message: issue.message }))
  const message = `IPC 返回值校验失败：${service}.${method}`
  logStore.push({
    level: 'error', source: 'Renderer', message, payload: { errors },
    tags: ['ipc', service, 'validation'], category: 'result', traceId, phase: '返回值校验', status: 'error'
  })
  throw new Error(`${message} (${errors.map((issue) => `${issue.path.join('.') || '<root>'}: ${issue.message}`).join('; ')})`)
}
