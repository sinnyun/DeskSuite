import { useEffect } from 'react'
import { call } from './bridge-api'
import { log, logStore } from './logs'
import type { LogInput } from './logs'

let booted = false
let eventSeq = 0

export function useRuntimeBridge(): void {
  useEffect(() => {
    const off = window.bridge.onEvent((channel, payload, traceId) => {
      if (channel === 'runtime:log') {
        logStore.push(payload as LogInput)
        return
      }
      if (traceId) {
        logStore.push({
          id: `renderer-event-${Date.now()}-${eventSeq++}`,
          level: 'event', source: 'Renderer Event', message: `收到事件 ${channel}`,
          payload: { channel }, tags: ['event', channel], category: 'transfer',
          traceId, phase: '接收事件', status: 'ok'
        })
      }
    })

    if (!booted) {
      booted = true
      log('lifecycle', 'Workbench', '渲染进程工作台启动')
      void call<LogInput[]>('runtime', 'history')
        .then((history) => {
          for (const entry of [...history].reverse()) logStore.push(entry)
        })
        .catch(() => {
          log('warn', 'Workbench', '主进程运行时日志服务不可用')
        })
    }

    return off
  }, [])
}
