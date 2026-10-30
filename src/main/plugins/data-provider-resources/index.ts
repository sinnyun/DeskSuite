import { app, dialog, protocol } from 'electron'
import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpText } from '../../services/mcp'
import { MAX_READ, ResourceRegistry, SCHEME } from './registry'
import { resourceResponse } from './transport'
import type { ResourcesService } from './types'

// Eager auto-discovery evaluates this module before app.ready, without changing the host.
if (!app.isReady()) protocol.registerSchemesAsPrivileged([{
  scheme: SCHEME, privileges: { standard: true, secure: true, supportFetchAPI: true, corsEnabled: true, stream: true }
}])

export default {
  inject: ['ipc', 'store', 'mcp'],
  apply(ctx: Context) {
    const resources = new ResourceRegistry(ctx)
    ctx.reflect.provide('resources', resources as ResourcesService)
    protocol.handle(SCHEME, (request) => resourceResponse(resources, request))
    const pending = new Map<string, (result: { value?: unknown; error?: string }) => void>()
    ctx.effect(() => () => {
      protocol.unhandle(SCHEME)
      for (const reply of pending.values()) reply({ error: '统一资源服务已卸载' })
    })
    const choose = async (): Promise<unknown[]> => {
      const selected = await dialog.showOpenDialog({ title: '登记本地资源（保留原文件）', properties: ['openFile', 'multiSelections'] })
      if (selected.canceled) return []
      return Promise.all(selected.filePaths.map((path) => resources.register(path)))
    }
    ctx.ipc.handle('resources', {
      register: (path: string) => resources.register(path),
      resolve: (reference: string) => resources.resolve(reference),
      list: () => resources.list(),
      forget: (reference: string) => resources.forget(reference),
      read: (reference: string, offset?: number, length?: number) => resources.read(reference, offset, length),
      readText: (reference: string) => resources.readText(reference),
      choose,
      complete: (id: string, result: { value?: unknown; error?: string }) => { pending.get(id)?.(result) }
    })
    const reference = z.string().min(1).max(2048)
    const definitions: Array<{ name: string; description: string; inputSchema: Record<string, z.ZodType>; mutating?: boolean; execute: (args: Record<string, unknown>) => Promise<unknown> }> = [
      { name: 'resource_register', description: 'Register an existing ordinary file on a local drive, mapped drive or UNC share and return its stable resource URI, current URL, MIME type and metadata. Never copies or changes source bytes.', inputSchema: { path: z.string().min(1) }, mutating: true, execute: (args: Record<string, unknown>) => resources.register(args.path as string) },
      { name: 'resource_resolve', description: 'Resolve a registered ID or resource URI to current availability, metadata and versioned load URL. All file formats retain original bytes.', inputSchema: { reference }, execute: (args: Record<string, unknown>) => resources.resolve(args.reference as string) },
      { name: 'resource_list', description: 'List persistent local resource registrations; missing source files stay visible as unavailable.', inputSchema: {}, execute: () => resources.list() },
      { name: 'resource_forget', description: 'Revoke a resource registration and its URLs. Does not delete or modify the original file.', inputSchema: { reference }, mutating: true, execute: (args: Record<string, unknown>) => resources.forget(args.reference as string) },
      { name: 'resource_read', description: 'Read a bounded range of original resource bytes as base64, for any file format.', inputSchema: { reference, offset: z.number().int().min(0).optional(), length: z.number().int().min(1).max(MAX_READ).optional() }, execute: (args: Record<string, unknown>) => resources.read(args.reference as string, args.offset as number | undefined, args.length as number | undefined) },
      { name: 'resource_read_text', description: 'Read a UTF-8 text resource up to 1 MiB; larger files use resource_read.', inputSchema: { reference }, execute: (args: Record<string, unknown>) => resources.readText(args.reference as string) }
    ]
    for (const definition of definitions) ctx.mcp.registerTool(definition.name, {
      ...definition,
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await definition.execute(args))) }
        catch (error) { return mcpError(String(error)) }
      }
    })
    ctx.mcp.registerTool('resource_view', {
      description: 'Open the resource panel, preview a resource, inspect rendering and Leafer image loading, or control the active audio/video. fetch reads a bounded URL response in the renderer.',
      inputSchema: {
        action: z.enum(['open', 'preview', 'inspect', 'play', 'pause', 'seek', 'fetch', 'leafer']),
        reference: reference.optional(), time: z.number().min(0).optional(),
        method: z.enum(['GET', 'HEAD', 'POST']).optional(), range: z.string().max(128).optional(),
        etag: z.string().max(128).optional(), ifRange: z.string().max(128).optional(), url: z.string().max(2048).optional()
      }, mutating: true,
      execute: async (args) => {
        const id = randomUUID()
        try {
          const result = await new Promise<{ value?: unknown; error?: string }>((resolve, reject) => {
            const timer = setTimeout(() => { pending.delete(id); reject(new Error('资源界面未响应')) }, 20000)
            pending.set(id, (value) => { clearTimeout(timer); pending.delete(id); resolve(value) })
            ctx.ipc.broadcast('resources:action', { ...args, requestId: id })
          })
          return result.error ? mcpError(result.error) : mcpText(JSON.stringify(result.value ?? true))
        } catch (error) { return mcpError(String(error)) }
      }
    })
  }
}
