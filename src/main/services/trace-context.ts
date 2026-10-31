import { AsyncLocalStorage } from 'node:async_hooks'

const traceContext = new AsyncLocalStorage<string>()

export function withTrace<T>(traceId: string, run: () => T): T {
  return traceContext.run(traceId, run)
}

export function currentTraceId(): string | undefined {
  return traceContext.getStore()
}
