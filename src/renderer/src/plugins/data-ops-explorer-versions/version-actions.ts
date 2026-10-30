import { call } from '../../workbench/sdk'

// UI IPC mutations may return a command approval plan rather than their final result.
export async function mutateVersion<T>(method: string, args: unknown[], confirmation: string, confirmed = false): Promise<T> {
  const result = await call<T | { requiresApproval: true; planId: string }>('versions', method, ...args)
  if (result && typeof result === 'object' && 'requiresApproval' in result && result.requiresApproval) {
    const planId = (result as { planId: string }).planId
    const accepted = confirmed || window.confirm(confirmation)
    await call('commands', 'approve', planId, accepted)
    if (!accepted) throw new Error('已取消版本操作')
    return call<T>('commands', 'execute', planId)
  }
  return result as T
}

