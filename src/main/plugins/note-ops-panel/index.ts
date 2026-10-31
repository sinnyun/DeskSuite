import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { z } from 'zod'
import { app, dialog } from 'electron'
import { mcpError, mcpText } from '../../services/mcp'
import { assertWritable, identity } from '../../services/paths'

interface Reply {
  (result: { error?: string; value?: unknown }): void
}

interface TaskStatus {
  requestId: string
  action: string
  status: 'pending' | 'wait_timed_out' | 'completed' | 'failed'
  startedAt: number
  finishedAt?: number
  error?: string
}

const preferencesKey = 'note-panel-preferences'
const preferencesSchema = z.object({
  rootDir: z.string().max(1000).nullable(),
  lastNote: z.string().max(1000).nullable(),
  recentPaths: z.array(z.string().max(1000)).max(20).default([])
})
type Preferences = z.infer<typeof preferencesSchema>

const MAX_DRAFTS = 100
const MAX_DRAFT_LENGTH = 200_000
const draftSchema = z.object({
  entries: z.array(z.object({
    path: z.string().min(1).max(1000),
    markdown: z.string().max(MAX_DRAFT_LENGTH),
    updatedAt: z.number().int().nonnegative()
  })).max(MAX_DRAFTS)
})
type DraftDocument = z.infer<typeof draftSchema>

function assertTextOnly(markdown: string): void {
  if (markdown.length > MAX_DRAFT_LENGTH) throw new Error(`草稿超过 ${MAX_DRAFT_LENGTH} 字符限制`)
  if (/!\[[^\]]*\]\(\s*data:image\//i.test(markdown) || /data:image\/(?:png|jpeg|gif|webp);base64,/i.test(markdown)) {
    throw new Error('草稿不能保存内嵌图片数据，请先将图片注册为统一资源链接')
  }
}

export default {
  inject: ['ipc', 'mcp', 'store', 'config', 'window', 'storage'],
  apply(ctx: Context): void {
    const pending = new Map<string, Reply>()
    const tasks = new Map<string, TaskStatus>()
    ctx.effect(() => () => {
      for (const reply of pending.values()) reply({ error: '笔记面板桥接已卸载' })
      for (const task of tasks.values()) {
        if (task.status === 'pending' || task.status === 'wait_timed_out') {
          task.status = 'failed'
          task.error = '笔记面板桥接已卸载'
          task.finishedAt = Date.now()
        }
      }
      pending.clear()
    })
    ctx.store.register(preferencesKey, { schema: preferencesSchema, default: { rootDir: null, lastNote: null, recentPaths: [] } })
    ctx.store.register('note-panel-drafts', { schema: draftSchema, default: { entries: [] } })
    ctx.storage.register('note-ops-panel', {
      title: '笔记面板',
      entries: [
        { label: '笔记目录与最近文件', storeKey: preferencesKey },
        { label: '编辑草稿', storeKey: 'note-panel-drafts' }
      ]
    })
    ctx.ipc.handle('notePanel', {
      pickDirectory: async () => {
        const options = { title: '选择笔记目录（允许在此目录新建和保存笔记）', properties: ['openDirectory'] as Array<'openDirectory'> }
        const win = ctx.window.getMainWindow()
        const result = win ? await dialog.showOpenDialog(win, options) : await dialog.showOpenDialog(options)
        const selected = result.filePaths[0]
        if (result.canceled || !selected) return null
        const root = await assertWritable(selected, { allowedRoots: [selected], forbidden: [app.getPath('userData')] })
        const config = ctx.config.get('mcp')
        if (!config.writeRoots.some((path) => identity(path) === identity(root))) {
          await ctx.config.set('mcp', { ...config, writeRoots: [...config.writeRoots, root] })
        }
        return root
      },
      complete: (requestId: string, result: { error?: string; value?: unknown }) => {
        const task = tasks.get(requestId)
        if (task) {
          task.status = result.error ? 'failed' : 'completed'
          task.error = result.error
          task.finishedAt = Date.now()
        }
        pending.get(requestId)?.(result)
      },
      loadPreferences: () => ctx.store.read<Preferences>(preferencesKey),
      rememberPreferences: (input: unknown) => {
        const preferences = preferencesSchema.parse(input)
        return ctx.store.write(preferencesKey, preferences).then(() => preferences)
      },
      loadDraft: async (path: string) => {
        const key = identity(path)
        const doc = await ctx.store.read<DraftDocument>('note-panel-drafts')
        return doc.entries.find((entry) => identity(entry.path) === key) ?? null
      },
      saveDraft: async (input: unknown) => {
        const parsed = z.object({ path: z.string().min(1).max(1000), markdown: z.string().max(MAX_DRAFT_LENGTH) }).parse(input)
        assertTextOnly(parsed.markdown)
        const key = identity(parsed.path)
        const updatedAt = Date.now()
        await ctx.store.update<DraftDocument>('note-panel-drafts', (doc) => {
          const retained = doc.entries.filter((entry) => identity(entry.path) !== key)
          if (retained.length >= MAX_DRAFTS) throw new Error(`已达到 ${MAX_DRAFTS} 篇草稿上限，请先清理旧草稿`)
          return { entries: [{ ...parsed, updatedAt }, ...retained].slice(0, MAX_DRAFTS) }
        })
        return { path: parsed.path, updatedAt }
      },
      clearDraft: async (path: string) => {
        const parsedPath = z.string().min(1).max(1000).parse(path)
        const key = identity(parsedPath)
        await ctx.store.update<DraftDocument>('note-panel-drafts', (doc) => ({
          entries: doc.entries.filter((entry) => identity(entry.path) !== key)
        }))
        return true
      },
      listDrafts: async () => ctx.store.read<DraftDocument>('note-panel-drafts')
    })
    const ask = async (
      action: string,
      args: { title?: string; path?: string; markdown?: string; attributes?: { title?: string; tags?: string[] | string; category?: string; status?: string; date?: string }; enabled?: boolean; operation?: string; query?: string; replacement?: string; versionId?: string }
    ): Promise<{ error?: string; value?: unknown }> => {
      const requestId = randomUUID()
      const task: TaskStatus = { requestId, action, status: 'pending', startedAt: Date.now() }
      tasks.set(requestId, task)
      while (tasks.size > 200) {
        const oldest = tasks.values().next().value as TaskStatus | undefined
        if (!oldest || oldest.status === 'pending') break
        tasks.delete(oldest.requestId)
      }
      return new Promise((resolve) => {
        const timer = setTimeout(() => {
          pending.delete(requestId)
          task.status = 'wait_timed_out'
          task.error = '等待笔记界面响应超时；任务可能仍在执行'
          resolve({ error: `${task.error}。requestId=${requestId}` })
        }, 15_000)
        pending.set(requestId, (result) => {
          clearTimeout(timer)
          pending.delete(requestId)
          resolve(result)
        })
        ctx.ipc.broadcast('note:action', { ...args, action, requestId })
      })
    }
    ctx.mcp.registerTool('note_panel', {
      description:
        'Drive the Markdown note panel in the renderer. Mutating actions: setroot, open, select (provide exact path when titles collide), reload, new, setbody, setattrs, sourceMode, readingMode, findReplace, archive, restoreTrash, createVersion, restoreVersion. Document changes are debounced and automatically saved after the note directory has been authorized. Use note_query for read-only search, outline, inspect, and version listing.',
      inputSchema: {
        action: z.enum(['setroot', 'open', 'select', 'reload', 'new', 'setbody', 'setattrs', 'sourceMode', 'readingMode', 'findReplace', 'archive', 'restoreTrash', 'createVersion', 'restoreVersion', 'inspect']),
        title: z.string().max(200).optional(),
        path: z.string().max(1000).optional(),
        markdown: z.string().max(200_000).optional(),
        attributes: z.object({ title: z.string().max(500).optional(), tags: z.union([z.array(z.string().max(100)).max(100), z.string().max(2000)]).optional(), category: z.string().max(200).optional(), status: z.string().max(200).optional(), date: z.string().max(40).optional() }).optional(),
        enabled: z.boolean().optional(),
        operation: z.enum(['next', 'replaceCurrent', 'replaceAll']).optional(),
        query: z.string().max(1000).optional(),
        replacement: z.string().max(1000).optional(),
        versionId: z.string().max(200).optional()
      },
      mutating: true,
      execute: async ({ action, title, path, markdown, attributes, enabled, operation, query, replacement, versionId }) => {
        const result = await ask(String(action), {
          title: title === undefined ? undefined : String(title),
          path: path === undefined ? undefined : String(path),
          markdown: markdown === undefined ? undefined : String(markdown),
          attributes: attributes === undefined ? undefined : attributes as { title?: string; tags?: string[] | string; category?: string; status?: string; date?: string },
          enabled: typeof enabled === 'boolean' ? enabled : undefined,
          operation: typeof operation === 'string' ? operation : undefined,
          query: typeof query === 'string' ? query : undefined,
          replacement: typeof replacement === 'string' ? replacement : undefined,
          versionId: typeof versionId === 'string' ? versionId : undefined
        })
        return result.error ? mcpError(result.error) : mcpText(JSON.stringify(result.value ?? true))
      }
    })
    ctx.mcp.registerTool('note_query', {
      description: 'Read-only note queries: full-text search loaded notes, return the current heading outline and text statistics, inspect the editor, or list Lore revisions for a path.',
      inputSchema: { action: z.enum(['search', 'outline', 'inspect', 'versions']), title: z.string().max(200).optional(), path: z.string().max(1000).optional() },
      mutating: false,
      execute: async ({ action, title, path }) => {
        const result = await ask(String(action), { title: title === undefined ? undefined : String(title), path: path === undefined ? undefined : String(path) })
        return result.error ? mcpError(result.error) : mcpText(JSON.stringify(result.value ?? true))
      }
    })
    ctx.mcp.registerTool('note_task_status', {
      description: 'Read the status of a note-panel action that returned a requestId after its wait timed out. A timeout means only that the response was not received in time; the operation may still complete.',
      inputSchema: { requestId: z.string().uuid() },
      mutating: false,
      execute: async ({ requestId }) => {
        const status = tasks.get(String(requestId))
        return status ? mcpText(JSON.stringify(status)) : mcpError('未找到该笔记任务；任务状态最多保留最近 200 项')
      }
    })
  }
}
