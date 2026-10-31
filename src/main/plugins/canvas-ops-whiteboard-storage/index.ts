import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { randomUUID } from 'node:crypto'
import { BoardStorage } from './storage'
import { mcpError, mcpText } from '../../services/mcp'

const storagePlugin: Plugin = {
  name: 'canvas-ops-whiteboard-storage',
  inject: ['ipc', 'store', 'mcp', 'window', 'storage'],
  apply(ctx: Context): void {
    const storage = new BoardStorage(ctx.store)
    ctx.storage.register('canvas-ops-whiteboard-storage', {
      title: '画板存储',
      entries: [
        { label: '画板索引与场景', relativePath: 'data/leafer-boards', kind: 'directory' },
        { label: '旧版画板备份', storeKey: 'leafer-board-scenes', description: '迁移前的旧版场景文件，保留作备份' }
      ]
    })
    const methods = {
      list: () => storage.list(),
      summaries: () => storage.summaries(),
      get: (id: string) => { assertId(id); return storage.get(id) },
      set: (id: string, json: string) => { assertId(id); return storage.set(id, json) },
      remove: (id: string) => { assertId(id); return storage.remove(id) }
    }
    const pending = new Map<string, (result: { error?: string; value?: unknown }) => void>()
    ctx.effect(() => () => {
      for (const reply of pending.values()) reply({ error: '画板服务已卸载' })
      pending.clear()
    })
    ctx.ipc.handle('whiteboard', {
      ...methods,
      complete: (id: string, result: { error?: string; value?: unknown }) => {
        pending.get(id)?.(result)
      }
    })
    for (const action of ['list', 'get', 'set', 'remove'] as const) {
      ctx.mcp.registerTool(`whiteboard_${action}`, {
        description: `${action} a persistent versioned Leafer board (stable resource references; originals are not embedded).`,
        inputSchema:
          action === 'list'
            ? {}
            : { id: z.string().regex(/^[a-zA-Z0-9-]{1,64}$/), ...(action === 'set' ? { sceneJson: z.string() } : {}) },
        mutating: action === 'set' || action === 'remove',
        execute: async (args) => {
          try {
            const value =
              action === 'list'
                ? await methods.list()
                : action === 'set'
                  ? await methods.set(args.id as string, args.sceneJson as string)
                  : await methods[action](args.id as string)
            return mcpText(JSON.stringify(value))
          } catch (error) {
            return mcpError(String(error))
          }
        }
      })
    }
    const win = ctx.window.getMainWindow()
    let closing = false
    let flushingClose = false
    const beforeClose = (event: { preventDefault(): void }): void => {
      if (closing) return
      event.preventDefault()
      if (flushingClose) return
      flushingClose = true
      const requestId = randomUUID()
      const timer = setTimeout(() => {
        pending.delete(requestId)
        flushingClose = false
        console.error('[whiteboard] 关闭前保存超时，窗口保持打开')
      }, 15000)
      pending.set(requestId, (result) => {
        clearTimeout(timer)
        pending.delete(requestId)
        flushingClose = false
        if (result.error) { console.error('[whiteboard] 关闭前保存失败', result.error); return }
        closing = true
        win?.close()
      })
      ctx.ipc.broadcast('whiteboard:flush', { requestId })
    }
    win?.on('close', beforeClose)
    ctx.effect(() => () => { win?.removeListener('close', beforeClose) })
    ctx.mcp.registerTool('whiteboard_panel', {
      description:
        'Open/select a whiteboard, replace the active editor scene (same autosave path as drawing), or flush pending saves.',
      inputSchema: {
        action: z.enum(['open', 'replace', 'flush', 'inspect', 'command']),
        boardId: z
          .string()
          .regex(/^[a-zA-Z0-9-]{1,64}$/)
          .optional(),
        sceneJson: z
          .string()
          .max(4 * 1024 * 1024)
          .optional(),
        command: z.string().optional(),
        args: z.record(z.string(), z.unknown()).optional(),
        deferSave: z.boolean().optional()
      },
      mutating: true,
      execute: async (args) => {
        const requestId = randomUUID()
        try {
          const result = await new Promise<{ error?: string; value?: unknown }>((resolve, reject) => {
            const timer = setTimeout(() => {
              pending.delete(requestId)
              reject(new Error('白板界面未响应'))
            }, 15000)
            pending.set(requestId, (value) => {
              clearTimeout(timer)
              pending.delete(requestId)
              resolve(value)
            })
            ctx.ipc.broadcast('whiteboard:action', { ...args, requestId })
          })
          return result.error ? mcpError(result.error) : mcpText(JSON.stringify(result.value ?? true))
        } catch (error) {
          return mcpError(String(error))
        }
      }
    })
  }
}

function assertId(id: string): void {
  if (typeof id !== 'string' || !/^[a-zA-Z0-9-]{1,64}$/.test(id)) throw new Error('画板 ID 无效')
}

export default storagePlugin
