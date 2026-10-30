import { BrowserWindow, ipcMain } from 'electron'
import type { Context } from 'cordis'
import { Service } from 'cordis'

export type IpcMethods = Record<string, (...args: never[]) => unknown>

declare module 'cordis' {
  interface Context {
    ipc: IpcService
  }
}
export class IpcService extends Service {
  private handlers = new Map<string, IpcMethods>()

  constructor(ctx: Context) {
    super(ctx, 'ipc')
  }

  start(): void {
    ipcMain.handle('bridge:invoke', (_event, service: string, method: string, args: unknown[]) => {
      const methods = this.handlers.get(service)
      if (!methods || typeof methods[method] !== 'function') {
        throw new Error(`插件服务不存在或方法未注册：${service}.${method}`)
      }
      const commandResult = this.ctx.commands?.executeIpcMethod(service, method, args)
      if (commandResult !== undefined) return commandResult
      return (methods[method] as (...a: unknown[]) => unknown)(...args)
    })
    this.handle('system', {
      services: (): string[] => this.listServices()
    })
  }

  listServices(): string[] {
    return [...this.handlers.keys()].sort()
  }

  listMethods(): Array<{ service: string; method: string; handler: (...args: unknown[]) => unknown }> {
    return [...this.handlers.entries()].flatMap(([service, methods]) => Object.entries(methods)
      .filter((entry): entry is [string, (...args: unknown[]) => unknown] => typeof entry[1] === 'function')
      .map(([method, handler]) => ({ service, method, handler })))
  }

  handle(service: string, methods: IpcMethods): void {
    const existing = this.handlers.get(service) ?? {}
    this.handlers.set(service, { ...existing, ...methods })
    for (const [method, handler] of Object.entries(methods)) {
      if (typeof handler === 'function') this.ctx.commands?.registerIpcMethod(service, method, (...args) => {
        const currentMethods = this.handlers.get(service)
        const current = currentMethods?.[method]
        if (typeof current !== 'function') throw new Error(`工作台操作已卸载：${service}.${method}`)
        return (current as (...values: unknown[]) => unknown).apply(currentMethods, args)
      })
    }
  }

  broadcast(channel: string, payload: unknown): void {
    for (const win of BrowserWindow.getAllWindows()) {
      win.webContents.send('bridge:event', channel, payload)
    }
  }
}
