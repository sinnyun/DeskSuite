import { randomUUID } from 'node:crypto'
import { access, copyFile, mkdir, open, readFile, realpath, rename, rm, stat } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import { StringDecoder } from 'node:string_decoder'
import { createConnection } from 'node:net'
import { app, shell } from 'electron'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpErrorFrom, mcpText } from '../../services/mcp'
import { errorMessage } from '../../services/error-text'
import { assertWritable } from '../../services/paths'
import { hasOwnedNote, readAllBoardFields, writeBoardFields, type BoardFields, type NativeBoard } from './header'
import { parseQuickTable, quickEntries } from './quick-create'
import { decodeRpcLine, encodeRpcRequest, MAX_PROTOCOL_LINE, parseTextResult } from './sidecar-protocol'

const PLUGIN = 'project-provider-workcrate-boards'
const CACHE_VERSION = 1
const MAX_BOARDS = 10_000
const MAX_CACHE_BYTES = 64 * 1024 * 1024
const MCP_TIMEOUT_MS = 65_000
const A3_WIDTH_PT = 420 * 72 / 25.4
const A3_HEIGHT_PT = 297 * 72 / 25.4

interface BoardInfo {
  materialCategory: string
  material: string
  size: string
  sizeLabel: string
  quantity: string
  extra: Record<string, string>
}
interface WorkCrateBoard {
  id: string
  projectId: string
  binding: string
  nativeId: string
  index: number
  title: string
  widthPt: number
  heightPt: number
  info: BoardInfo
}
interface DocumentStamp { modifiedMs: number; size: number }
interface BoardCache {
  version: number
  binding: string
  boards: WorkCrateBoard[]
  previews: Record<string, string>
  source: DocumentStamp | null
}
const boardInfoSchema = z.object({
  materialCategory: z.string().max(1024),
  material: z.string().max(1024),
  size: z.string().max(1024),
  sizeLabel: z.string().max(1024),
  quantity: z.string().max(1024),
  extra: z.record(z.string().max(256), z.string().max(1024))
}).strict()
const workCrateBoardSchema = z.object({
  id: z.string().min(1).max(512),
  projectId: z.string().uuid(),
  binding: z.string().uuid(),
  nativeId: z.string().regex(/^\d{1,20}$/),
  index: z.number().int().nonnegative().max(MAX_BOARDS - 1),
  title: z.string().min(1).max(512),
  widthPt: z.number().finite().positive().max(1_000_000),
  heightPt: z.number().finite().positive().max(1_000_000),
  info: boardInfoSchema
}).strict()
const boardCacheSchema = z.object({
  version: z.literal(CACHE_VERSION),
  binding: z.string().uuid(),
  boards: z.array(workCrateBoardSchema).max(MAX_BOARDS),
  previews: z.record(z.string().min(1).max(600), z.string().min(1).max(1024)).superRefine((value, ctx) => {
    if (Object.keys(value).length > MAX_BOARDS) ctx.addIssue({ code: 'custom', message: '画板预览缓存条目过多' })
  }),
  source: z.object({ modifiedMs: z.number().finite().nonnegative(), size: z.number().int().nonnegative() }).strict().nullable()
}).strict().superRefine((cache, ctx) => {
  if (cache.boards.some((board) => board.binding !== cache.binding)) {
    ctx.addIssue({ code: 'custom', path: ['boards'], message: '画板缓存绑定不一致' })
  }
})
interface ChildHandle { child: ReturnType<typeof spawn>; live: boolean; close(): Promise<void>; isClosed(): boolean; request(method: string, params: unknown): Promise<unknown> }
export interface WorkCrateBoardsService {
  duplicateProjectDocument(projectId: string, name: string, directory: string): Promise<{ project: { id: string; name: string }; path: string }>
}

declare module 'cordis' {
  interface Context { workcrateBoards: WorkCrateBoardsService }
}

// Windows “Copy as path” includes quotes; spawn/access require the bare path.
const executablePathSchema = z.string().max(2048).trim().overwrite((value) => {
  const quote = value[0]
  return value.length >= 2 && (quote === '"' || quote === "'") && value.at(-1) === quote
    ? value.slice(1, -1).trim()
    : value
}).default('')
const configSchema = z.object({
  cliExecutable: executablePathSchema,
  guiExecutable: executablePathSchema,
  defaultImageFormat: z.enum(['png', 'jpg']).default('png'),
  port: z.number().int().min(1).max(65535).default(17979)
})
const projectIdSchema = z.string().uuid()
const exportBoardsSchema = z.object({
  projectId: projectIdSchema,
  directory: z.string().min(1).max(32768),
  boardIds: z.array(z.string().min(1).max(512)).min(1).max(MAX_BOARDS).optional(),
  format: z.enum(['png', 'jpg', 'pdf']),
  scale: z.number().min(0.25).max(4).default(1)
})
const createSchema = z.object({ projectId: projectIdSchema, directory: z.string().min(1).max(32768) })
const boardFieldsSchema = z.object({
  materialCategory: z.string().max(1024).default(''),
  material: z.string().max(1024).default(''),
  size: z.string().max(1024).default(''),
  sizeLabel: z.string().max(1024).default(''),
  quantity: z.string().max(1024).default(''),
  extra: z.record(z.string(), z.string()).default({})
})
const quickTableSchema = z.object({ columns: z.array(z.string().max(80)).min(1).max(30), rows: z.array(z.array(z.string().max(1024)).max(30)).max(500) })
const quickCreateSchema = z.object({ projectId: projectIdSchema, table: quickTableSchema, reuseInitial: z.boolean().default(true) })

async function portIsListening(port: number): Promise<boolean> {
  return new Promise((resolveProbe) => {
    const socket = createConnection({ host: '127.0.0.1', port })
    const finish = (value: boolean): void => { socket.destroy(); resolveProbe(value) }
    socket.setTimeout(300)
    socket.once('connect', () => finish(true))
    socket.once('timeout', () => finish(false))
    socket.once('error', () => finish(false))
  })
}

async function startSession(executable: string, projectDirectory: string, readRoots: string[], writeRoots: string[], connectPort?: number): Promise<ChildHandle> {
  const configDirectory = join(app.getPath('userData'), 'workcrate-boards', basename(projectDirectory), 'cli-config')
  await mkdir(configDirectory, { recursive: true })
  const args: string[] = ['mcp', ...(connectPort ? ['--connect', `127.0.0.1:${connectPort}`] : ['--headless'])]
  if (connectPort === undefined) {
    for (const root of readRoots) args.push('--automation-read-root', root)
    for (const root of writeRoots) args.push('--automation-write-root', root)
  }
  const child = spawn(executable, args, {
    stdio: ['pipe', 'pipe', 'ignore'],
    windowsHide: true,
    env: { ...process.env, VECTORCRAFT_CONFIG_DIR: configDirectory }
  })
  const pending = new Map<number, { resolve(value: unknown): void; reject(error: Error): void; timer: NodeJS.Timeout }>()
  let nextId = 1
  let closed = false
  let stopping = false
  let stdoutBuffer = ''
  const stdoutDecoder = new StringDecoder('utf8')
  const failAll = (error: Error): void => {
    for (const waiter of pending.values()) { clearTimeout(waiter.timer); waiter.reject(error) }
    pending.clear()
  }
  const onLine = (line: string): void => {
    let reply: ReturnType<typeof decodeRpcLine>
    try { reply = decodeRpcLine(line) } catch (failure) {
      const error = failure instanceof Error ? failure : new Error('VectorCraft MCP 回复不是有效 JSON-RPC 2.0 结构')
      stopping = true
      failAll(error); child.kill(); return
    }
    if (!('id' in reply)) return
    const waiter = pending.get(reply.id)
    if (!waiter) return
    pending.delete(reply.id); clearTimeout(waiter.timer)
    if ('error' in reply) waiter.reject(new Error(reply.error.message.slice(0, 2048)))
    else waiter.resolve(reply.result)
  }
  child.stdout.on('data', (chunk: Buffer | string) => {
    stdoutBuffer += typeof chunk === 'string' ? chunk : stdoutDecoder.write(chunk)
    if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_PROTOCOL_LINE && !stdoutBuffer.includes('\n')) {
      const error = new Error('VectorCraft MCP 回复超过 64 MiB')
      stopping = true
      failAll(error)
      child.kill()
      stdoutBuffer = ''
      return
    }
    let boundary = stdoutBuffer.indexOf('\n')
    while (boundary >= 0) {
      const line = stdoutBuffer.slice(0, boundary).replace(/\r$/, '')
      stdoutBuffer = stdoutBuffer.slice(boundary + 1)
      onLine(line)
      boundary = stdoutBuffer.indexOf('\n')
    }
    if (Buffer.byteLength(stdoutBuffer, 'utf8') > MAX_PROTOCOL_LINE) {
      const error = new Error('VectorCraft MCP 回复超过 64 MiB')
      stopping = true
      failAll(error)
      child.kill()
      stdoutBuffer = ''
    }
  })
  child.once('error', (error) => { stopping = true; failAll(error) })
  child.once('exit', (code, signal) => {
    closed = true
    stopping = true
    failAll(new Error(`VectorCraft MCP 进程已退出（${code ?? signal ?? 'unknown'}）`))
  })
  const request = (method: string, params: unknown): Promise<unknown> => {
    if (closed || stopping || !child.stdin.writable) return Promise.reject(new Error('VectorCraft MCP 会话已关闭'))
    const id = nextId++
    let payload: string
    try { payload = encodeRpcRequest(id, method, params) } catch (error) { return Promise.reject(error) }
    return new Promise((resolveReply, rejectReply) => {
      const timer = setTimeout(() => {
        pending.delete(id)
        stopping = true
        const error = new Error(`VectorCraft MCP 操作超时：${method}`)
        rejectReply(error)
        failAll(error)
        child.kill()
      }, MCP_TIMEOUT_MS)
      pending.set(id, { resolve: resolveReply, reject: rejectReply, timer })
      child.stdin.write(payload, 'utf8', (error) => {
        if (!error) return
        const waiter = pending.get(id)
        if (waiter) {
          stopping = true
          pending.delete(id)
          clearTimeout(waiter.timer)
          waiter.reject(error)
          failAll(error)
          child.kill()
        }
      })
    })
  }
  const close = async (): Promise<void> => {
    if (closed) return
    if (!stopping) child.stdin.end()
    await Promise.race([
      new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
      new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1000))
    ])
    if (!closed) {
      stopping = true
      child.kill()
      await Promise.race([
        new Promise<void>((resolveExit) => child.once('exit', () => resolveExit())),
        new Promise<void>((resolveTimeout) => setTimeout(resolveTimeout, 1000))
      ])
    }
  }
  try {
    await request('initialize', {
      protocolVersion: '2024-11-05', capabilities: {},
      clientInfo: { name: 'DeskSuite WorkCrate', version: '0.1.0' }
    })
    child.stdin.write(`${JSON.stringify({ jsonrpc: '2.0', method: 'notifications/initialized', params: {} })}\n`)
    await request('tools/list', {})
  } catch (error) {
    await close()
    throw error
  }
  return { child, live: connectPort !== undefined, close, isClosed: () => closed || stopping, request }
}

async function callTool(session: ChildHandle, name: string, arguments_: Record<string, unknown>): Promise<unknown> {
  const result = await session.request('tools/call', { name, arguments: arguments_ })
  return parseTextResult(result)
}

async function runCommand(session: ChildHandle, id: string, params: Record<string, unknown> = {}): Promise<unknown> {
  return callTool(session, 'command_run', { id, params })
}

async function runSession<T>(executable: string, projectDirectory: string, document: string, writeRoots: string[], action: (session: ChildHandle) => Promise<T>): Promise<T> {
  const session = await startSession(executable, projectDirectory, [dirname(document)], writeRoots)
  try { return await action(session) } finally { await session.close().catch(() => undefined) }
}

function safeName(name: string): string {
  const value = name.trim().replace(/[<>:"/\\|?*\u0000-\u001f]/g, '_').replace(/[ .]+$/g, '')
  return value && !/^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])$/i.test(value) ? value : 'WorkCrate Project'
}

function sameNativePath(raw: string, target: string): boolean {
  const normalize = (value: string): string => resolve(value.replace(/^\\\\\?\\/, '')).replace(/\\/g, '/').toLowerCase()
  return normalize(raw) === normalize(target)
}

function boardId(projectId: string, binding: string, nativeId: string): string {
  return `${projectId}:${binding}:${nativeId}`
}

function parseCatalog(projectId: string, binding: string, model: unknown, inspect: unknown): WorkCrateBoard[] {
  const artboards = (model as { artboards?: unknown[] })?.artboards
  const inspected = (inspect as { artboards?: unknown[] })?.artboards ?? []
  if (!Array.isArray(artboards) || artboards.length > MAX_BOARDS) throw new Error('VectorCraft 文档中的画板目录无效')
  const fieldsByBoard = readAllBoardFields(model)
  return artboards.map((value, index) => {
    const item = value as { id?: unknown; name?: unknown; rect?: Record<string, unknown> }
    const details = inspected[index] as { width?: unknown; height?: unknown } | undefined
    const rect = item.rect ?? {}
    const toNum = (a: unknown, b?: unknown): number | undefined =>
      typeof a === 'number' && Number.isFinite(a) ? (typeof b === 'number' && Number.isFinite(b) ? a - b : a) : undefined
    const width = toNum(rect.x1, rect.x0) ?? (typeof details?.width === 'number' ? details.width : undefined)
    const height = toNum(rect.y1, rect.y0) ?? (typeof details?.height === 'number' ? details.height : undefined)
    if ((typeof item.id !== 'string' && typeof item.id !== 'number') || (typeof item.id === 'number' && (!Number.isSafeInteger(item.id) || item.id < 0)) || (typeof item.id === 'string' && (!/^\d{1,20}$/.test(item.id) || !Number.isSafeInteger(Number(item.id)))) || width === undefined || height === undefined || width <= 0 || height <= 0) {
      throw new Error(`第 ${index + 1} 个画板缺少有效 ID 或尺寸`)
    }
    const nativeId = String(item.id)
    return {
      id: boardId(projectId, binding, nativeId), projectId, binding, nativeId, index,
      title: typeof item.name === 'string' && item.name.trim() ? item.name : `第 ${index + 1} 页`, widthPt: width, heightPt: height,
      info: fieldsByBoard.get(Number(item.id)) ?? { materialCategory: '', material: '', size: '', sizeLabel: '', quantity: '', extra: {} }
    }
  })
}

async function atomicWrite(path: string, bytes: Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const temporary = `${path}.${randomUUID()}.tmp`
  const handle = await open(temporary, 'wx')
  try { await handle.writeFile(bytes); await handle.sync() } finally { await handle.close() }
  try { await rename(temporary, path) } catch (error) { await rm(temporary, { force: true }); throw error }
}

async function publishNativeCopy(source: string, target: string): Promise<{ dev: number; ino: number }> {
  const sourceInfo = await stat(source)
  if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('关联的 VectorCraft 文档不是有效的单文件文档')
  const reservation = await open(target, 'wx')
  const reservationInfo = await stat(target)
  const temporary = join(dirname(target), `.${randomUUID()}.vectorcraft-stage`)
  let published = false
  try {
    await reservation.close()
    await copyFile(source, temporary)
    const staged = await open(temporary, 'r+')
    try { await staged.sync() } finally { await staged.close() }
    const sourceAfter = await stat(source)
    if (sourceAfter.size !== sourceInfo.size || sourceAfter.mtimeMs !== sourceInfo.mtimeMs) throw new Error('源 VectorCraft 文档在复制期间发生变化，请重试')
    const currentReservation = await stat(target)
    if (currentReservation.dev !== reservationInfo.dev || currentReservation.ino !== reservationInfo.ino || currentReservation.size !== 0) {
      throw new Error('目标文档预留文件已变化，拒绝覆盖')
    }
    await rename(temporary, target)
    published = true
    const finalInfo = await stat(target)
    return { dev: finalInfo.dev, ino: finalInfo.ino }
  } catch (error) {
    await rm(temporary, { force: true }).catch(() => undefined)
    if (published || await stat(target).then((current) => current.dev === reservationInfo.dev && current.ino === reservationInfo.ino).catch(() => false)) {
      await rm(target, { force: true }).catch(() => undefined)
    }
    throw error
  }
}

const plugin: Plugin = {
  name: PLUGIN,
  inject: ['ipc', 'mcp', 'settings', 'window', 'workcrateProjects', 'storage'],
  apply(ctx: Context) {
    ctx.storage.register('project-provider-workcrate-boards', {
      title: 'VectorCraft 画板配置',
      entries: [{ label: '各工程 CLI 配置', relativePath: 'workcrate-boards', kind: 'directory' }]
    })
    ctx.settings.register('vectorcraft', configSchema, { cliExecutable: '', guiExecutable: '', defaultImageFormat: 'png', port: 17979 }, {
      title: 'VectorCraft', description: 'WorkCrate 官方画板程序连接设置', group: '项目管理'
    })

    const mutexes = new Map<string, Promise<unknown>>()
    const serializeProject = async <T>(projectId: string, work: () => Promise<T>): Promise<T> => {
      const previous = mutexes.get(projectId) ?? Promise.resolve()
      const task = previous.catch(() => undefined).then(work)
      mutexes.set(projectId, task)
      try { return await task } finally { if (mutexes.get(projectId) === task) mutexes.delete(projectId) }
    }

    const getCli = async (): Promise<string> => {
      const config = configSchema.parse(await ctx.settings.get('vectorcraft'))
      const candidate = config.cliExecutable.trim()
      if (!candidate) throw new Error('请先在设置中配置 VectorCraft CLI 可执行文件')
      await access(candidate)
      return resolve(candidate)
    }

    const projectDirectory = (projectId: string): Promise<string> => ctx.workcrateProjects.projectDirectory(projectId).then((path) => resolve(path))
    const documentPath = (projectId: string): Promise<string> => ctx.workcrateProjects.getDocumentPath(projectId).then((path) => {
      if (!path) throw new Error('该工程尚未关联 VectorCraft 文档')
      return resolve(path)
    })

    const cachePath = async (projectId: string): Promise<string> => join(await projectDirectory(projectId), 'boards-cache.json')
    const previewDirectory = async (projectId: string): Promise<string> => join(await projectDirectory(projectId), 'native-previews')

    const liveRevisions = new Map<string, unknown>()
    async function inspectOpenDocument(session: ChildHandle): Promise<Record<string, unknown> | null> {
      try { return await callTool(session, 'doc_inspect', { depth: 0 }) as Record<string, unknown> }
      catch (error) {
        // An empty desktop is a normal state, not a broken control connection.
        if (error instanceof Error && /\bno document open\b/i.test(error.message)) return null
        throw error
      }
    }
    // Always edit the live document when the desktop control server is present.
    // Never reopen its disk copy over unsaved desktop edits.
    async function withDocumentSession<T>(projectId: string, action: (session: ChildHandle) => Promise<T>, readOnly = false): Promise<T> {
      const file = await documentPath(projectId)
      const [cli, root, config] = await Promise.all([getCli(), projectDirectory(projectId), ctx.settings.get('vectorcraft').then((value) => configSchema.parse(value))])
      if (await portIsListening(config.port)) {
        const live = await startSession(cli, root, [dirname(file)], [dirname(file)], config.port)
        try {
          const inspect = await inspectOpenDocument(live)
          if (typeof inspect?.path === 'string' && sameNativePath(inspect.path, file)) return await action(live)
          if (!inspect && !readOnly) {
            await callTool(live, 'open_file', { path: file })
            return await action(live)
          }
          if (!readOnly) throw new Error('VectorCraft 当前显示的是其他文档，请先切换到此工程后重试')
        } finally { await live.close().catch(() => undefined) }
      }
      return runSession(cli, root, file, [dirname(file)], async (session) => {
        const opened = await callTool(session, 'open_file', { path: file }) as Record<string, unknown>
        if (typeof opened.path === 'string' && !sameNativePath(opened.path, file)) throw new Error('VectorCraft 未打开此工程文档')
        if ((Array.isArray(opened.warnings) && opened.warnings.length) || (Array.isArray(opened.modifiedLinks) && opened.modifiedLinks.length) || (Array.isArray(opened.missingLinks) && opened.missingLinks.length)) throw new Error('VectorCraft 文档报告资源异常，请修复并保存后同步')
        return action(session)
      })
    }

    const asNativeBoard = (board: WorkCrateBoard): NativeBoard => ({
      nativeId: Number(board.nativeId), index: board.index, title: board.title,
      widthPt: board.widthPt, heightPt: board.heightPt
    })

    async function verifyBoundSession(session: ChildHandle, projectId: string, file: string, binding: string): Promise<Record<string, unknown>> {
      const [currentPath, currentBinding] = await Promise.all([
        ctx.workcrateProjects.getDocumentPath(projectId), ctx.workcrateProjects.documentBinding(projectId)
      ])
      if (!currentPath || !sameNativePath(currentPath, file) || currentBinding !== binding) throw new Error('工程文档关联已变化，拒绝写入材料栏')
      const inspect = await callTool(session, 'doc_inspect', { depth: 0 }) as Record<string, unknown>
        if (typeof inspect.path !== 'string' || !sameNativePath(inspect.path, file)) {
          throw new Error('VectorCraft 当前文档已切换，拒绝写入材料栏')
        }
      return inspect
    }

    const headerClient = (session: ChildHandle, projectId: string, file: string, binding: string) => ({
      command: async (id: string, params: Record<string, unknown> = {}): Promise<unknown> => {
        const inspect = await verifyBoundSession(session, projectId, file, binding)
        if (id === 'doc_inspect') return inspect
        return runCommand(session, id, params)
      }
    })

    async function readCache(projectId: string): Promise<BoardCache | null> {
      if (!await ctx.workcrateProjects.getDocumentPath(projectId)) return null
      const file = await cachePath(projectId)
      let cache: BoardCache
      try {
        const info = await stat(file)
        if (!info.isFile() || info.size > MAX_CACHE_BYTES) throw new Error('画板缓存文件过大')
        cache = boardCacheSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      }
      catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return null; throw new Error('画板缓存损坏，请执行同步') }
      const binding = await ctx.workcrateProjects.documentBinding(projectId)
      if (cache.binding !== binding || cache.boards.some((board) => board.projectId !== projectId)) return null
      return cache
    }

    async function writeCache(projectId: string, cache: BoardCache): Promise<void> {
      const file = await cachePath(projectId)
      let old: BoardCache | null = null
      try {
        const info = await stat(file)
        if (info.isFile() && info.size <= MAX_CACHE_BYTES) old = boardCacheSchema.parse(JSON.parse(await readFile(file, 'utf8')))
      } catch { /* 初次构建或缓存损坏 */ }
      const normalized = boardCacheSchema.parse(cache)
      const bytes = Buffer.from(JSON.stringify(normalized, null, 2), 'utf8')
      if (bytes.length > MAX_CACHE_BYTES) throw new Error('画板缓存超过 64 MiB 限额')
      await atomicWrite(file, bytes)
      const retained = new Set(Object.values(normalized.previews))
      for (const relativePath of Object.values(old?.previews ?? {})) {
        if (retained.has(relativePath)) continue
        const owned = await ownedPreviewPath(projectId, relativePath)
        if (owned) await rm(owned, { force: true }).catch(() => undefined)
      }
    }

    async function ownedPreviewPath(projectId: string, relativePath: string): Promise<string | null> {
      if (!relativePath || relativePath.startsWith('/') || relativePath.split(/[\\/]/).some((part) => part === '..')) return null
      const root = resolve(await projectDirectory(projectId))
      const previewRoot = resolve(root, 'native-previews')
      const target = resolve(root, relativePath)
      const prefix = previewRoot + (process.platform === 'win32' ? '\\' : '/')
      return target.startsWith(prefix) ? target : null
    }

    async function clearCache(projectId: string): Promise<void> {
      const file = await cachePath(projectId)
      try {
        const info = await stat(file)
        if (!info.isFile() || info.size > MAX_CACHE_BYTES) throw new Error('画板缓存文件无效')
        const cache = boardCacheSchema.parse(JSON.parse(await readFile(file, 'utf8')))
        for (const relativePath of Object.values(cache.previews)) {
          const owned = await ownedPreviewPath(projectId, relativePath)
          if (owned) await rm(owned, { force: true }).catch(() => undefined)
        }
      } catch { /* cache absence/corruption does not block reassociation */ }
      await rm(file, { force: true })
    }

    async function syncCacheFromSession(session: ChildHandle, projectId: string, binding: string, renderBoardIds?: Set<string>): Promise<WorkCrateBoard[]> {
      // Desktop saves may finish writing after the control reply. Retry only the
      // read/render step, never the mutation that preceded it.
      for (let attempt = 0; ; attempt++) {
        try { return await syncCacheOnce(session, projectId, binding, renderBoardIds) }
        catch (error) {
          if (attempt >= 3 || !(error instanceof Error) || !/在同步期间发生变化/.test(error.message)) throw error
          await new Promise((resolveRetry) => setTimeout(resolveRetry, 200))
        }
      }
    }

    async function syncCacheOnce(session: ChildHandle, projectId: string, binding: string, renderBoardIds?: Set<string>): Promise<WorkCrateBoard[]> {
      const file = await documentPath(projectId)
      const [currentPath, currentBinding] = await Promise.all([ctx.workcrateProjects.getDocumentPath(projectId), ctx.workcrateProjects.documentBinding(projectId)])
      if (!currentPath || !sameNativePath(currentPath, file) || currentBinding !== binding) throw new Error('同步前工程文档关联已变化')
      const sourceBefore = await stat(file)
      const model = await runCommand(session, 'document.json')
      const inspect = await callTool(session, 'doc_inspect', { depth: 0 }) as Record<string, unknown>
      if (typeof inspect.path !== 'string' || !sameNativePath(inspect.path, file)) {
        throw new Error('VectorCraft 当前文档已切换，拒绝更新此工程缓存')
      }
      const catalog = parseCatalog(projectId, binding, model, inspect)
      const old = await readCache(projectId)
      const previews = { ...(old?.previews ?? {}) }
      const root = await projectDirectory(projectId)
      const previewRoot = await previewDirectory(projectId)
      await mkdir(previewRoot, { recursive: true })
      const rendered = catalog.filter((board) => !renderBoardIds || renderBoardIds.has(board.id) || !previews[`${board.id}@1600`])
      for (const board of rendered) {
        const response = await session.request('tools/call', { name: 'render_preview', arguments: { artboard: board.index, max_side: 1600 } }) as { content?: Array<{ type?: string; mimeType?: string; data?: string }> }
        const image = response.content?.find((item) => item.type === 'image' && item.mimeType === 'image/png')
        if (!image?.data || image.data.length > 48 * 1024 * 1024) throw new Error(`第 ${board.index + 1} 页预览无效或过大`)
        const bytes = Buffer.from(image.data, 'base64')
        if (bytes.length > 32 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('VectorCraft 预览不是有效 PNG')
        const relativePath = `native-previews/${board.binding}-${board.nativeId}-1600.png`
        await atomicWrite(join(root, relativePath), bytes)
        previews[`${board.id}@1600`] = relativePath
      }
      const latestInspect = await callTool(session, 'doc_inspect', { depth: 0 }) as Record<string, unknown>
      const [latestPath, latestBinding] = await Promise.all([ctx.workcrateProjects.getDocumentPath(projectId), ctx.workcrateProjects.documentBinding(projectId)])
      const info = await stat(file)
      if (typeof latestInspect.path !== 'string' || !sameNativePath(latestInspect.path, file)) {
        throw new Error('VectorCraft 文档在同步期间发生变化，请重试')
      }
      if (latestInspect.revision !== inspect.revision) throw new Error('VectorCraft 文档在同步期间发生变化，请重试')
      if (!latestPath || !sameNativePath(latestPath, file) || latestBinding !== binding) throw new Error('工程文档关联在同步期间发生变化，请重新同步')
      if (info.size !== sourceBefore.size || info.mtimeMs !== sourceBefore.mtimeMs) throw new Error('VectorCraft 文件在同步期间发生变化，请重试')
      await writeCache(projectId, {
        version: CACHE_VERSION, binding, boards: catalog, previews,
        source: { modifiedMs: info.mtimeMs, size: info.size }
      })
      if (session.live) liveRevisions.set(projectId, inspect.revision)
      else liveRevisions.delete(projectId)
      ctx.ipc.broadcast('workcrate:boards-changed', { projectId, at: Date.now() })
      return catalog
    }

    async function rebindCopiedCache(sourceCache: BoardCache | null, sourceProjectId: string, destinationProjectId: string, binding: string, nativeFile: string): Promise<void> {
      if (!sourceCache) { await clearCache(destinationProjectId); return }
      const root = await projectDirectory(destinationProjectId)
      const canonicalRoot = await realpath(root)
      const boards = sourceCache.boards.map((board) => ({
        ...board, id: boardId(destinationProjectId, binding, board.nativeId), projectId: destinationProjectId, binding
      }))
      const previews: Record<string, string> = {}
      for (let index = 0; index < sourceCache.boards.length; index++) {
        const oldBoard = sourceCache.boards[index]
        const nextBoard = boards[index]
        const oldRelative = sourceCache.previews[`${oldBoard.id}@1600`]
        if (!oldRelative) continue
        const oldPath = await ownedPreviewPath(destinationProjectId, oldRelative)
        if (!oldPath) throw new Error('待复制的画板预览路径无效')
        const canonicalPreview = await realpath(oldPath)
        if (!canonicalPreview.startsWith(canonicalRoot + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('待复制的画板预览超出工程目录')
        const bytes = await readFile(canonicalPreview)
        if (!bytes.length || bytes.length > 32 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('待复制的画板预览文件无效')
        const relativePath = `native-previews/${binding}-${nextBoard.nativeId}-1600.png`
        await atomicWrite(join(root, relativePath), bytes)
        previews[`${nextBoard.id}@1600`] = relativePath
      }
      const source = await stat(nativeFile)
      await writeCache(destinationProjectId, {
        version: CACHE_VERSION, binding, boards, previews,
        source: { modifiedMs: source.mtimeMs, size: source.size }
      })
      ctx.ipc.broadcast('workcrate:boards-changed', { projectId: destinationProjectId, copiedFrom: sourceProjectId, at: Date.now() })
    }

    async function updateBoardInfo(boardIdValue: string, rawInfo: unknown, allowedRoots = ctx.config.get('mcp').writeRoots): Promise<WorkCrateBoard> {
      const boardIdParts = z.string().min(1).max(512).parse(boardIdValue).split(':')
      const projectId = projectIdSchema.parse(boardIdParts[0])
      const info = boardFieldsSchema.parse(rawInfo) as BoardFields
      return serializeProject(projectId, async () => {
      const cache = await readCache(projectId)
      const board = cache?.boards.find((item) => item.id === boardIdValue)
      if (!board) throw new Error('画板缓存已过期，请先同步工程')
      const file = await documentPath(projectId)
      const binding = await ctx.workcrateProjects.documentBinding(projectId)
      if (binding !== board.binding) throw new Error('工程文档关联已变化，请重新同步')
      await assertWritable(file, { allowedRoots, forbidden: [app.getPath('userData')] })
      return withDocumentSession(projectId, async (session) => {
        const nativeBoard = asNativeBoard(board)
        await writeBoardFields(headerClient(session, projectId, file, binding), nativeBoard, info)
        await verifyBoundSession(session, projectId, file, binding)
        await callTool(session, 'save_file', { path: file })
        const catalog = await syncCacheFromSession(session, projectId, binding, new Set([boardIdValue]))
        const updated = catalog.find((item) => item.id === boardIdValue)
        if (!updated) throw new Error('保存后 VectorCraft 画板目录发生变化，请重新同步')
        return updated
      })
      })
    }

    async function refreshInternalLocked(projectId: string): Promise<WorkCrateBoard[]> {
      const binding = await ctx.workcrateProjects.documentBinding(projectId)
      return withDocumentSession(projectId, (session) => syncCacheFromSession(session, projectId, binding), true)
    }

    async function refresh(projectId: string): Promise<WorkCrateBoard[]> {
      const result = await serializeProject(projectId, () => refreshInternalLocked(projectId))
      return result
    }

    async function createProjectDocument(projectId: string, rawDirectory: string, allowedRoots = ctx.config.get('mcp').writeRoots): Promise<{ path: string; boards: WorkCrateBoard[] }> {
      return serializeProject(projectId, async () => {
        if (await ctx.workcrateProjects.getDocumentPath(projectId)) throw new Error('该工程已关联原生文档')
        const directory = resolve(rawDirectory)
        const dirStat = await stat(directory)
        if (!dirStat.isDirectory()) throw new Error('请选择一个已有文件夹')
        const project = (await ctx.workcrateProjects.list(true)).find((item) => item.id === projectId)
        if (!project) throw new Error('工程不存在')
        const file = join(directory, `${safeName(project.name)}.vectorcraft`)
        await assertWritable(file, { allowedRoots, forbidden: [app.getPath('userData')] })
        const cli = await getCli()
        const reservation = await open(file, 'wx')
        await reservation.close()
        let ownedFileIdentity = await stat(file).then(({ dev, ino }) => ({ dev, ino }))
        try {
          const boards = await runSession(cli, await projectDirectory(projectId), file, [directory], async (session) => {
            await runCommand(session, 'file.new', { name: project.name, width: A3_WIDTH_PT, height: A3_HEIGHT_PT, units: 'Points', artboards: 1, backgroundContents: 'white' })
            await callTool(session, 'save_file', { path: file })
            ownedFileIdentity = await stat(file).then(({ dev, ino }) => ({ dev, ino }))
            await ctx.workcrateProjects.setDocumentPath(projectId, file)
            const binding = await ctx.workcrateProjects.documentBinding(projectId)
            const boards = parseCatalog(projectId, binding, await runCommand(session, 'document.json'), await callTool(session, 'doc_inspect', { depth: 0 }))
            const first = boards[0]
            if (!first) throw new Error('VectorCraft 未创建初始画板')
            await writeBoardFields(headerClient(session, projectId, file, binding), asNativeBoard(first), first.info)
            await verifyBoundSession(session, projectId, file, binding)
            await callTool(session, 'save_file', { path: file })
            ownedFileIdentity = await stat(file).then(({ dev, ino }) => ({ dev, ino }))
            return syncCacheFromSession(session, projectId, binding)
          })
          return { path: file, boards }
        } catch (error) {
          let rollbackFailure: unknown = null
          await ctx.workcrateProjects.clearDocumentPath(projectId, file).catch((failure) => { rollbackFailure = failure })
          const stillOwned = await stat(file).then((info) => info.dev === ownedFileIdentity.dev && info.ino === ownedFileIdentity.ino).catch(() => false)
          if (stillOwned) await rm(file, { force: true }).catch((failure) => { rollbackFailure ??= failure })
          await clearCache(projectId).catch((failure) => { rollbackFailure ??= failure })
          if (rollbackFailure) throw new Error(`原生文档创建失败且回滚未完成：${errorMessage(error, '文档创建失败')}；${errorMessage(rollbackFailure, '回滚失败')}`)
          throw error
        }
      })
    }

    async function createProjectWithDocument(name: string, directory: string): Promise<{ project: { id: string; name: string }; path: string; boards: WorkCrateBoard[]; projectDataPath: string; relocationWarning: string | null }> {
      const project = await ctx.workcrateProjects.create(name)
      try {
        const document = await createProjectDocument(project.id, directory)
        let relocationWarning: string | null = null
        try { await ctx.workcrateProjects.relocateProject(project.id, directory) }
        catch (error) { relocationWarning = errorMessage(error, '工程资料迁移失败') }
        const projectDataPath = await ctx.workcrateProjects.projectDirectory(project.id)
        return { project: { id: project.id, name: project.name }, path: document.path, boards: document.boards, projectDataPath, relocationWarning }
      } catch (error) {
        await ctx.workcrateProjects.delete(project.id).catch(() => undefined)
        throw error
      }
    }

    async function createPage(projectId: string, allowedRoots = ctx.config.get('mcp').writeRoots): Promise<WorkCrateBoard> {
      return serializeProject(projectId, async () => {
        const file = await documentPath(projectId)
        const binding = await ctx.workcrateProjects.documentBinding(projectId)
        await assertWritable(file, { allowedRoots, forbidden: [app.getPath('userData')] })
        const board = await withDocumentSession(projectId, async (session) => {
          await verifyBoundSession(session, projectId, file, binding)
          const inspect = await callTool(session, 'doc_inspect', { depth: 0 }) as { artboards?: Array<{ x?: number; y?: number; width?: number; height?: number }> }
          const artboards = inspect.artboards
          if (!Array.isArray(artboards) || !artboards.length) throw new Error('文档没有可用画板')
          let right = -Infinity
          let top = Infinity
          for (const item of artboards) {
            if (![item.x, item.y, item.width, item.height].every((v) => typeof v === 'number' && Number.isFinite(v))) throw new Error('VectorCraft 返回的画板几何无效')
            right = Math.max(right, item.x! + item.width!)
            top = Math.min(top, item.y!)
          }
          await runCommand(session, 'artboard.new', { x: right + 20, y: top, width: A3_WIDTH_PT, height: A3_HEIGHT_PT, name: `第 ${artboards.length + 1} 页` })
          const model = await runCommand(session, 'document.json')
          const updated = await callTool(session, 'doc_inspect', { depth: 0 })
          const created = parseCatalog(projectId, binding, model, updated).at(-1)
          if (!created) throw new Error('VectorCraft 未返回新画板')
          await writeBoardFields(headerClient(session, projectId, file, binding), asNativeBoard(created), created.info)
          await verifyBoundSession(session, projectId, file, binding)
          await callTool(session, 'save_file', { path: file })
          const savedBoards = await syncCacheFromSession(session, projectId, binding)
          return savedBoards.find((item) => item.nativeId === created.nativeId)
        })
        if (!board) throw new Error('VectorCraft 未返回新画板')
        return board
      })
    }

    async function quickCreate(raw: unknown, allowedRoots = ctx.config.get('mcp').writeRoots) {
      const args = quickCreateSchema.parse(raw)
      const entries = quickEntries(args.table)
      return serializeProject(args.projectId, async () => {
        const projectId = args.projectId
        const file = await documentPath(projectId)
        const binding = await ctx.workcrateProjects.documentBinding(projectId)
        await assertWritable(file, { allowedRoots, forbidden: [app.getPath('userData')] })
        return withDocumentSession(projectId, async (session) => {
          const client = headerClient(session, projectId, file, binding)
          const inspect = await verifyBoundSession(session, projectId, file, binding)
          const model = await runCommand(session, 'document.json') as { layers?: Array<{ kind?: { children?: unknown[] } }> }
          const before = parseCatalog(projectId, binding, model, inspect)
          const ownedOnly = (value: unknown): boolean => {
            const node = value as { attrs?: { note?: string }; kind?: { children?: unknown[] } }
            if (!hasOwnedNote(node)) return false
            return (node.kind?.children ?? []).every(ownedOnly)
          }
          const first = before[0]
          const reuse = Boolean(args.reuseInitial && before.length === 1 && first &&
            Object.entries(first.info).every(([key, value]) => key === 'extra' ? Object.keys(value).length === 0 : !value) &&
            model.layers?.every((layer) => (layer.kind?.children ?? []).every(ownedOnly)))
          if (before.length + entries.length - Number(reuse) > MAX_BOARDS) throw new Error('画板总数超出上限')
          const createdIds = new Set<string>()
          await client.command('edit.undoGroup.begin', { label: 'WorkCrate quick create' })
          try {
            for (const [index, entry] of entries.entries()) {
              try {
                let board: WorkCrateBoard
                if (index === 0 && reuse) {
                  board = first
                  if (entry.title) await client.command('artboard.setProps', { index: 0, name: entry.title })
                } else {
                  const geometry = await client.command('doc_inspect') as { artboards?: Array<{ x: number; y: number; width: number; height: number }> }
                  const artboards = geometry.artboards ?? []
                  if (!artboards.length || artboards.some((item) => ![item.x, item.y, item.width, item.height].every(Number.isFinite))) throw new Error('画板几何无效')
                  const right = Math.max(...artboards.map((item) => item.x + item.width))
                  const top = Math.min(...artboards.map((item) => item.y))
                  await client.command('artboard.new', { x: right + 20, y: top, width: A3_WIDTH_PT, height: A3_HEIGHT_PT, name: entry.title || `第 ${artboards.length + 1} 页` })
                  board = parseCatalog(projectId, binding, await client.command('document.json'), await client.command('doc_inspect')).at(-1)!
                }
                await writeBoardFields(client, asNativeBoard(board), entry.info, false)
                createdIds.add(board.id)
              } catch (error) { throw new Error(`第 ${index + 1} 行创建失败：${errorMessage(error, '未知错误')}`) }
            }
            await verifyBoundSession(session, projectId, file, binding)
          } catch (error) {
            await client.command('edit.undoGroup.end', { cancel: true })
            throw error
          }
          await client.command('edit.undoGroup.end')
          await callTool(session, 'save_file', { path: file })
          try {
            const boards = await syncCacheFromSession(session, projectId, binding, createdIds)
            return { count: entries.length, reusedInitial: reuse, boards }
          } catch (error) { throw new Error(`画板已保存，请刷新工程，勿重复创建：${errorMessage(error, '预览更新失败')}`) }
        })
      })
    }

    async function duplicateProjectDocument(projectId: string, name: string, rawDirectory: string): Promise<{ project: { id: string; name: string }; path: string }> {
      const source = await documentPath(projectId)
      if (extname(source).toLowerCase() !== '.vectorcraft') throw new Error('仅支持复制 .vectorcraft 单文件文档')
      const sourceCanonical = await realpath(source)
      const sourceInfo = await stat(sourceCanonical)
      if (!sourceInfo.isFile() || sourceInfo.size <= 0) throw new Error('关联的 VectorCraft 文档不是有效的单文件文档')
      const sourceCache = await readCache(projectId)
      const directory = await realpath(resolve(rawDirectory))
      if (!(await stat(directory)).isDirectory()) throw new Error('请选择一个已存在的目标文件夹')
      const created = await ctx.workcrateProjects.duplicate(projectId, name)
      let finalPath: string | null = null
      let finalIdentity: { dev: number; ino: number } | null = null
      try {
        const target = join(directory, `${safeName(created.name)}.vectorcraft`)
        await assertWritable(target, { allowedRoots: ctx.config.get('mcp').writeRoots, forbidden: [app.getPath('userData')] })
        finalIdentity = await publishNativeCopy(sourceCanonical, target)
        finalPath = target

        const previousNative = await ctx.workcrateProjects.getDocumentPath(created.id)
        const association = await ctx.workcrateProjects.setDocumentPath(created.id, target)
        await rebindCopiedCache(sourceCache, projectId, created.id, association.binding, target)
        if (previousNative) {
          const projectRoot = await realpath(await projectDirectory(created.id))
          const internalNative = await realpath(previousNative).catch(() => null)
          const internalRelative = internalNative ? relative(projectRoot, internalNative) : ''
          const isOwnedInternal = internalNative && !isAbsolute(internalRelative) && internalRelative !== '..' && !internalRelative.startsWith(`..${sep}`)
          if (internalNative && isOwnedInternal && internalNative !== sourceCanonical) {
            await rm(internalNative, { force: true })
          }
        }
        await ctx.workcrateProjects.relocateProject(created.id, directory)
        const result = await ctx.workcrateProjects.get(created.id)
        ctx.ipc.broadcast('workcrate:boards-changed', { projectId: created.id, at: Date.now() })
        return { project: result.project, path: target }
      } catch (error) {
        if (finalPath && finalIdentity) {
          const stillOurs = await stat(finalPath).then((info) => info.dev === finalIdentity!.dev && info.ino === finalIdentity!.ino).catch(() => false)
          if (stillOurs) await rm(finalPath, { force: true }).catch(() => undefined)
        }
        try { await ctx.workcrateProjects.delete(created.id) }
        catch (cleanupError) {
          throw new Error(`复制失败且新工程清理未完成：${errorMessage(error, '复制失败')}；${errorMessage(cleanupError, '清理失败')}`)
        }
        throw error
      }
    }

    async function reorderPages(projectId: string, boardIds: string[], allowedRoots = ctx.config.get('mcp').writeRoots): Promise<WorkCrateBoard[]> {
      return serializeProject(projectId, async () => {
        const file = await documentPath(projectId)
        await assertWritable(file, { allowedRoots, forbidden: [app.getPath('userData')] })
        const binding = await ctx.workcrateProjects.documentBinding(projectId)
        return withDocumentSession(projectId, async (session) => {
          const inspect = await verifyBoundSession(session, projectId, file, binding)
          const catalog = parseCatalog(projectId, binding, await runCommand(session, 'document.json'), inspect)
          if (boardIds.length !== catalog.length || new Set(boardIds).size !== catalog.length || boardIds.some((id) => !catalog.some((board) => board.id === id))) throw new Error('画板目录已变化，请同步后重新排序')
          const currentIds = catalog.map((board) => board.id)
          for (const [to, id] of boardIds.entries()) {
            const index = currentIds.indexOf(id)
            if (index === to) continue
            await verifyBoundSession(session, projectId, file, binding)
            await runCommand(session, 'artboard.reorder', { index, to })
            currentIds.splice(to, 0, currentIds.splice(index, 1)[0])
          }
          const ordered = parseCatalog(projectId, binding, await runCommand(session, 'document.json'), await verifyBoundSession(session, projectId, file, binding))
          for (const board of ordered) await writeBoardFields(headerClient(session, projectId, file, binding), asNativeBoard(board), board.info)
          await verifyBoundSession(session, projectId, file, binding)
          await callTool(session, 'save_file', { path: file })
          return syncCacheFromSession(session, projectId, binding)
        })
      })
    }

    async function exportBoards(raw: unknown, allowedRoots = ctx.config.get('mcp').writeRoots): Promise<{ directory: string; files: string[]; warnings: string[] }> {
      const args = exportBoardsSchema.parse(raw)
      return serializeProject(args.projectId, async () => {
        const directory = await realpath(resolve(args.directory))
        if (!(await stat(directory)).isDirectory()) throw new Error('请选择已有的导出文件夹')
        const file = await documentPath(args.projectId)
        const binding = await ctx.workcrateProjects.documentBinding(args.projectId)
        const project = (await ctx.workcrateProjects.list(true)).find((item) => item.id === args.projectId)
        if (!project) throw new Error('工程不存在')
        const folder = join(directory, `${safeName(project.name).slice(0, 80)}-导出-${Date.now()}-${randomUUID().slice(0, 8)}`)
        await assertWritable(folder, { allowedRoots, forbidden: [app.getPath('userData')] })
        return withDocumentSession(args.projectId, async (session) => {
          const inspect = await verifyBoundSession(session, args.projectId, file, binding)
          const catalog = parseCatalog(args.projectId, binding, await runCommand(session, 'document.json'), inspect)
          const wanted = args.boardIds ? new Set(args.boardIds) : null
          if (wanted && (wanted.size !== args.boardIds!.length || [...wanted].some((id) => !catalog.some((board) => board.id === id)))) throw new Error('选中画板已变化，请同步页面后重新选择')
          const boards = catalog.filter((board) => !wanted || wanted.has(board.id))
          if (!boards.length) throw new Error('没有可导出的画板')
          if (args.format !== 'pdf' && boards.some((board) => board.widthPt * board.heightPt * args.scale ** 2 > 40_000_000)) throw new Error('导出图片尺寸过大，请降低倍率')
          await mkdir(folder)
          const files: string[] = []
          const warnings = new Set<string>()
          const publish = async (name: string, result: Record<string, unknown>): Promise<void> => {
            const current = await verifyBoundSession(session, args.projectId, file, binding)
            if (current.revision !== inspect.revision) throw new Error('VectorCraft 文档在导出期间发生变化，请重试')
            if (typeof result.dataBase64 !== 'string' || result.dataBase64.length > 60 * 1024 * 1024) throw new Error('VectorCraft 导出数据无效或过大')
            const bytes = Buffer.from(result.dataBase64, 'base64')
            const valid = args.format === 'png' ? bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10])) : args.format === 'jpg' ? bytes[0] === 255 && bytes[1] === 216 : bytes.subarray(0, 5).toString() === '%PDF-'
            if (!valid) throw new Error('VectorCraft 返回的文件格式不匹配')
            const target = join(folder, name)
            await assertWritable(target, { allowedRoots, forbidden: [app.getPath('userData')] })
            const handle = await open(target, 'wx')
            try { await handle.writeFile(bytes) } finally { await handle.close() }
            files.push(target)
            if (Array.isArray(result.warnings)) for (const warning of result.warnings) if (typeof warning === 'string') warnings.add(warning)
          }
          try {
            if (args.format === 'pdf') {
              await publish(`${safeName(project.name).slice(0, 80)}.pdf`, await runCommand(session, 'document.exportPdf', { artboards: boards.map((board) => board.index), preserveEditing: false, viewAfterSaving: false }) as Record<string, unknown>)
            } else {
              for (const board of boards) {
                const current = await verifyBoundSession(session, args.projectId, file, binding)
                if (current.revision !== inspect.revision) throw new Error('VectorCraft 文档在导出期间发生变化，请重试')
                await publish(`${String(board.index + 1).padStart(3, '0')}-${safeName(board.title).slice(0, 80)}.${args.format}`, await runCommand(session, 'document.export', { format: args.format, artboard: board.index, scale: args.scale, quality: 95 }) as Record<string, unknown>)
              }
            }
            return { directory: folder, files, warnings: [...warnings] }
          } catch (error) {
            throw new Error(`导出未完成，已写入 ${files.length} 个文件（${folder}）：${errorMessage(error, '文件导出失败')}`)
          }
        }, true)
      })
    }

    let polling = false
    let disposed = false
    const syncFailures = new Map<string, string>()
    const pollChanges = async (): Promise<void> => {
      if (polling || disposed) return
      polling = true
      try {
        for (const project of await ctx.workcrateProjects.list(false)) {
          if (disposed || mutexes.has(project.id)) continue
          try {
            const file = await ctx.workcrateProjects.getDocumentPath(project.id)
            if (!file) continue
            await serializeProject(project.id, async () => {
              const stamp = await stat(file)
              const cache = await readCache(project.id)
              let changed = !cache?.source || cache.source.modifiedMs !== stamp.mtimeMs || cache.source.size !== stamp.size
              const config = configSchema.parse(await ctx.settings.get('vectorcraft'))
              if (!changed && await portIsListening(config.port)) {
                const cli = await getCli()
                const live = await startSession(cli, await projectDirectory(project.id), [dirname(file)], [], config.port)
                try {
                  const inspect = await inspectOpenDocument(live)
                  if (!inspect) liveRevisions.delete(project.id)
                  changed = typeof inspect?.path === 'string' && sameNativePath(inspect.path, file) && (!liveRevisions.has(project.id) || liveRevisions.get(project.id) !== inspect.revision)
                } finally { await live.close().catch(() => undefined) }
              }
              if (changed) await refreshInternalLocked(project.id)
            })
            if (syncFailures.delete(project.id)) ctx.ipc.broadcast('workcrate:sync-recovered', { projectId: project.id })
          } catch (error) {
            const message = errorMessage(error, 'VectorCraft 自动同步失败')
            if (syncFailures.get(project.id) !== message) {
              syncFailures.set(project.id, message)
              ctx.ipc.broadcast('workcrate:sync-error', { projectId: project.id, message })
            }
          }
        }
      } finally { polling = false }
    }
    const syncTimer = setInterval(() => { void pollChanges().catch(() => undefined) }, 1500)


    async function openDesktop(projectId: string): Promise<{ path: string; launched: boolean; pid?: number }> {
      const file = await documentPath(projectId)
      if (!(await stat(file)).isFile()) throw new Error('VectorCraft 文档不存在')
      const config = configSchema.parse(await ctx.settings.get('vectorcraft'))
      if (await portIsListening(config.port)) {
        const session = await startSession(await getCli(), await projectDirectory(projectId), [dirname(file)], [dirname(file)], config.port)
        try {
          const inspect = await inspectOpenDocument(session)
          if (typeof inspect?.path !== 'string' || !sameNativePath(inspect.path, file)) await callTool(session, 'open_file', { path: file })
        } finally { await session.close().catch(() => undefined) }
        return { path: file, launched: false }
      }
      const executable = config.guiExecutable || join(dirname(await getCli()), process.platform === 'win32' ? 'vectorcraft.exe' : 'vectorcraft')
      await access(executable)
      const child = spawn(executable, ['--control', String(config.port), '--automation-read-root', dirname(file), '--automation-write-root', dirname(file), file], { stdio: 'ignore', detached: true, windowsHide: true })
      await new Promise<void>((resolveSpawn, rejectSpawn) => { child.once('spawn', resolveSpawn); child.once('error', rejectSpawn) })
      child.unref()
      return { path: file, launched: true, pid: child.pid }
    }

    ctx.reflect.provide('workcrateBoards', { duplicateProjectDocument })

    ctx.ipc.handle('workcrateBoards', {
      getConfig: async () => configSchema.parse(await ctx.settings.get('vectorcraft')),
      setConfig: async (value: unknown) => ctx.settings.set('vectorcraft', configSchema.parse(value)),
      getDocumentPath: (projectId: string) => ctx.workcrateProjects.getDocumentPath(projectId),
      openProjectFolder: async (projectId: string) => {
        const file = await documentPath(projectIdSchema.parse(projectId))
        const info = await stat(file)
        if (!info.isFile()) throw new Error('VectorCraft 文档不存在')
        shell.showItemInFolder(file)
        return { path: dirname(file) }
      },
      openInVectorCraft: (projectId: string) => openDesktop(projectIdSchema.parse(projectId)),
      boardCatalog: async (projectId: string) => (await readCache(projectId))?.boards ?? [],
      preview: async (projectId: string, boardIdValue: string) => {
        const cache = await readCache(projectId)
        if (!cache) throw new Error('没有可用画板缓存，请先同步工程')
        const relative = cache.previews[`${boardIdValue}@1600`]
        if (!relative || relative.startsWith('/') || relative.split(/[\\/]/).some((part) => part === '..')) throw new Error('画板预览不存在')
        const root = resolve(await projectDirectory(projectId))
        const path = resolve(root, relative)
        if (!path.startsWith(root + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('画板预览路径越界')
        const [canonicalRoot, canonicalPreview] = await Promise.all([realpath(root), realpath(path)])
        if (!canonicalPreview.startsWith(canonicalRoot + (process.platform === 'win32' ? '\\' : '/'))) throw new Error('画板预览文件解析后超出工程目录')
        const bytes = await readFile(canonicalPreview)
        if (bytes.length > 32 * 1024 * 1024 || !bytes.subarray(0, 8).equals(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]))) throw new Error('画板预览文件无效')
        return `data:image/png;base64,${bytes.toString('base64')}`
      },
      refresh: (projectId: string) => refresh(projectId),
      createProjectDocument: async (value: unknown) => { const args = createSchema.parse(value); return createProjectDocument(args.projectId, args.directory, [args.directory]) },
      createPage: async (projectId: string) => createPage(projectId, [dirname(await documentPath(projectId))]),
      previewQuickCreate: (text: string) => parseQuickTable(z.string().max(1_000_000).parse(text)),
      quickCreate: async (value: unknown) => {
        const args = quickCreateSchema.parse(value)
        return quickCreate(args, [dirname(await documentPath(args.projectId))])
      },
      reorderPages: async (value: unknown) => {
        const args = z.object({ projectId: projectIdSchema, boardIds: z.array(z.string().min(1)).min(1).max(MAX_BOARDS) }).parse(value)
        return reorderPages(args.projectId, args.boardIds, [dirname(await documentPath(args.projectId))])
      },
      exportBoards: async (value: unknown) => {
        const args = exportBoardsSchema.parse(value)
        return exportBoards(args, [args.directory])
      },
      updateInfo: async (value: unknown) => {
        const args = z.object({ boardId: z.string().min(1).max(512), info: boardFieldsSchema }).parse(value)
        const projectId = projectIdSchema.parse(args.boardId.split(':')[0])
        return updateBoardInfo(args.boardId, args.info, [dirname(await documentPath(projectId))])
      }
    }, {
      getConfig: z.tuple([]),
      setConfig: z.tuple([configSchema]),
      getDocumentPath: z.tuple([projectIdSchema]),
      openProjectFolder: z.tuple([projectIdSchema]),
      openInVectorCraft: z.tuple([projectIdSchema]),
      boardCatalog: z.tuple([projectIdSchema]),
      preview: z.tuple([projectIdSchema, z.string().min(1).max(512)]),
      refresh: z.tuple([projectIdSchema]),
      createProjectDocument: z.tuple([createSchema]),
      createPage: z.tuple([projectIdSchema]),
      previewQuickCreate: z.tuple([z.string().max(1_000_000)]),
      quickCreate: z.tuple([quickCreateSchema]),
      reorderPages: z.tuple([z.object({ projectId: projectIdSchema, boardIds: z.array(z.string().min(1).max(512)).min(1).max(MAX_BOARDS) }).strict()]),
      exportBoards: z.tuple([exportBoardsSchema]),
      updateInfo: z.tuple([z.object({ boardId: z.string().min(1).max(512), info: boardFieldsSchema }).strict()])
    })

    ctx.mcp.registerTool('workcrate_quick_create_preview', {
      description: '解析 Excel/WPS TSV 或 CSV 表格。支持中文表头、自定义扩展列；无表头时按页面名称、物料类别、物料名称、尺寸标签、尺寸、数量排列。每行一张画布，数量是物料数量。',
      inputSchema: { text: z.string().max(1_000_000) },
      execute: async ({ text }) => {
        try { return mcpText(JSON.stringify(parseQuickTable(String(text)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_quick_create_open', {
      description: '打开工程的快速创建表格，可提供待粘贴的表格文本作为草稿，不写入画板。',
      inputSchema: { projectId: projectIdSchema, text: z.string().max(1_000_000).optional() },
      execute: async ({ projectId, text }) => {
        try {
          await ctx.workcrateProjects.get(String(projectId))
          const table = text === undefined ? null : parseQuickTable(String(text))
          ctx.ipc.broadcast('workcrate:panel-open', { projectId, quickCreate: true, table })
          return mcpText(JSON.stringify({ projectId, table }))
        } catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_boards_quick_create', {
      description: '按表格有效行批量创建 A3 空白画布和原生物料栏（1–200 行）。每行一张，数量列只写物料数量；默认复用仅含空物料栏的唯一初始画板，否则追加。',
      inputSchema: { ...quickCreateSchema.shape, confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await quickCreate(args))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_document_open', {
      description: '在 VectorCraft 桌面程序打开工程并启用双向同步控制连接。',
      inputSchema: { projectId: projectIdSchema, confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async ({ projectId }) => {
        try { return mcpText(JSON.stringify(await openDesktop(String(projectId)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_boards_export', {
      description: '使用 VectorCraft 原生画板导出选中/全部页面为 PNG、JPG 或多页 PDF。省略 boardIds 导出全部；输出独立子文件夹，按原生页面顺序，不覆盖旧文件。',
      inputSchema: { ...exportBoardsSchema.shape, confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await exportBoards(args))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_pages_select', {
      description: '在页面管理面板中单选、多选、全选或取消选择页面。',
      inputSchema: { projectId: projectIdSchema, mode: z.enum(['single', 'multiple', 'all', 'clear']), boardIds: z.array(z.string().min(1).max(512)).max(MAX_BOARDS).default([]) },
      execute: async ({ projectId, mode, boardIds }) => {
        try {
          const catalog = (await readCache(String(projectId)))?.boards ?? []
          const ids = boardIds as string[]
          if ((mode === 'single' && ids.length !== 1) || new Set(ids).size !== ids.length || ids.some((id) => !catalog.some((board) => board.id === id))) throw new Error('请选择当前工程的有效页面')
          const selected = mode === 'all' ? catalog.map((board) => board.id) : mode === 'clear' ? [] : ids
          ctx.ipc.broadcast('workcrate:pages-selection', { projectId, mode, boardIds: selected })
          return mcpText(JSON.stringify({ projectId, mode, boardIds: selected }))
        } catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_board_catalog', {
      description: '读取 WorkCrate 工程的本地画板缓存，不启动 VectorCraft。',
      inputSchema: { projectId: z.string().uuid() },
      execute: async ({ projectId }) => {
        try { return mcpText(JSON.stringify((await readCache(String(projectId)))?.boards ?? [])) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_panel_open', {
      description: '在 DeskSuite 窗口中打开 WorkCrate 工程资料箱面板。',
      inputSchema: { projectId: projectIdSchema.optional(), boardId: z.string().optional(), section: z.enum(['connection', 'basic']).optional() },
      execute: async ({ projectId, boardId, section }) => {
        ctx.ipc.broadcast('workcrate:panel-open', { projectId, boardId, section, at: Date.now() })
        return mcpText('WorkCrate 面板已打开')
      }
    })
    ctx.mcp.registerTool('workcrate_vectorcraft_config_get', {
      description: '读取 WorkCrate 的 VectorCraft CLI、GUI 和控制端口设置。',
      execute: async () => {
        try { return mcpText(JSON.stringify(configSchema.parse(await ctx.settings.get('vectorcraft')))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_vectorcraft_config_set', {
      description: '配置 WorkCrate 使用的 VectorCraft CLI、GUI 和控制端口。需要完整 MCP 权限和明确确认。',
      inputSchema: { config: configSchema, confirm: z.literal(true) },
      mutating: true,
      impact: 'high',
      execute: async ({ config }) => {
        try {
          const parsed = configSchema.parse(config)
          if (!parsed.cliExecutable.trim()) throw new Error('VectorCraft CLI 路径不能为空')
          await access(parsed.cliExecutable)
          if (parsed.guiExecutable.trim()) await access(parsed.guiExecutable)
          await ctx.settings.set('vectorcraft', parsed)
          return mcpText(JSON.stringify(parsed))
        } catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_project_create', {
      description: '在指定文件夹创建 WorkCrate 物料工程、原生 VectorCraft 文档和初始物料栏。目录必须位于已配置 MCP 可写根目录中。',
      inputSchema: { name: z.string().min(1).max(120), directory: z.string().min(1).max(32768), confirm: z.literal(true) },
      mutating: true,
      impact: 'high',
      execute: async ({ name, directory }) => {
        try { return mcpText(JSON.stringify(await createProjectWithDocument(String(name), String(directory)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_boards_refresh', {
      description: '通过 VectorCraft 官方 CLI 同步工程文档中的画板和预览缓存。需要写权限。',
      inputSchema: { projectId: z.string().uuid() },
      mutating: true,
      impact: 'low',
      execute: async ({ projectId }) => {
        try { return mcpText(JSON.stringify(await refresh(String(projectId)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_board_create_page', {
      description: '在已关联的 VectorCraft 原生文档中新增 A3 横向画板。需要完整写权限与明确确认。',
      inputSchema: { projectId: z.string().uuid(), confirm: z.literal(true) },
      mutating: true,
      impact: 'high',
      execute: async ({ projectId }) => {
        try { return mcpText(JSON.stringify(await createPage(String(projectId)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_boards_reorder', {
      description: '调整工程内所有画板的顺序并保存到 VectorCraft 原生文档；boardIds 必须是当前完整目录。',
      inputSchema: { projectId: projectIdSchema, boardIds: z.array(z.string().min(1)).min(1).max(MAX_BOARDS), confirm: z.literal(true) },
      mutating: true, impact: 'high',
      execute: async ({ projectId, boardIds }) => {
        try { return mcpText(JSON.stringify(await reorderPages(String(projectId), boardIds as string[]))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_board_update_info', {
      description: '在 VectorCraft 原生画板上安装或更新 WorkCrate 材料栏及结构化字段。需要完整写权限与明确确认。',
      inputSchema: {
        boardId: z.string().min(1).max(512),
        info: boardFieldsSchema,
        confirm: z.literal(true)
      },
      mutating: true,
      impact: 'high',
      execute: async ({ boardId: boardIdValue, info }) => {
        try { return mcpText(JSON.stringify(await updateBoardInfo(String(boardIdValue), info))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_document_create', {
      description: '为 WorkCrate 工程创建并关联一个新的 A3 横向 VectorCraft 原生文档。需要完整写权限与明确确认。',
      inputSchema: { projectId: z.string().uuid(), directory: z.string().min(1), confirm: z.literal(true) },
      mutating: true,
      impact: 'high',
      execute: async ({ projectId, directory }) => {
        try { return mcpText(JSON.stringify(await createProjectDocument(String(projectId), String(directory)))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    return () => { disposed = true; clearInterval(syncTimer) }
  }
}

export default plugin
