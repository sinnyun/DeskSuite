import { useEffect } from 'react'
import { call } from './bridge-api'
import { log, logStore } from './logs'
import type { LogInput } from './logs'

let booted = false

export function useRuntimeBridge(): void {
  useEffect(() => {
    const off = window.bridge.onEvent((channel, payload) => {
      if (channel === 'runtime:log') logStore.push(payload as LogInput)
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
