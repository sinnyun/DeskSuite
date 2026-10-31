import { app, dialog, shell } from 'electron'
import { promises as fs } from 'node:fs'
import type { Dirent, Dir } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { dirname, extname, isAbsolute, join } from 'node:path'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpText } from '../../services/mcp'

type FileKind =
  | 'folder'
  | 'code'
  | 'image'
  | 'document'
  | 'data'
  | 'archive'
  | 'video'
  | 'audio'
  | 'other'

interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  kind: FileKind
  size: number
  modifiedAt: number
}

interface ListDirResult {
  path: string
  parent: string | null
  entries: FsEntry[]
  truncated: boolean
}

interface DriveInfo {
  name: string
  path: string
  total: number
  free: number
  isNetwork: boolean
}

interface QuickAccessItem {
  id: string
  label: string
  path: string
}

const KIND_BY_EXT: Record<string, FileKind> = {
  ts: 'code',
  tsx: 'code',
  js: 'code',
  jsx: 'code',
  mjs: 'code',
  cjs: 'code',
  css: 'code',
  scss: 'code',
  html: 'code',
  json: 'data',
  yaml: 'data',
  yml: 'data',
  toml: 'data',
  xml: 'data',
  csv: 'data',
  md: 'document',
  txt: 'document',
  log: 'document',
  pdf: 'document',
  doc: 'document',
  docx: 'document',
  xls: 'document',
  xlsx: 'document',
  ppt: 'document',
  pptx: 'document',
  png: 'image',
  jpg: 'image',
  jpeg: 'image',
  gif: 'image',
  webp: 'image',
  svg: 'image',
  bmp: 'image',
  ico: 'image',
  zip: 'archive',
  rar: 'archive',
  '7z': 'archive',
  tar: 'archive',
  gz: 'archive',
  mp4: 'video',
  mkv: 'video',
  mov: 'video',
  webm: 'video',
  mp3: 'audio',
  wav: 'audio',
  flac: 'audio',
  ogg: 'audio'
}

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  ico: 'image/x-icon',
  svg: 'image/svg+xml'
}

const MEDIA_MIME: Record<string, string> = {
  mp4: 'video/mp4',
  webm: 'video/webm',
  mov: 'video/quicktime',
  mkv: 'video/x-matroska',
  mp3: 'audio/mpeg',
  wav: 'audio/wav',
  ogg: 'audio/ogg',
  flac: 'audio/flac',
  m4a: 'audio/mp4',
  aac: 'audio/aac'
}

const DEFAULT_PAGE_SIZE = 200
const MAX_PAGE_SIZE = 500
const MAX_DIRECTORY_CURSORS = 32
const CURSOR_TTL_MS = 2 * 60 * 1000
const MAX_TEXT_BYTES = 2 * 1024 * 1024
const MAX_IMAGE_BYTES = 12 * 1024 * 1024
const MAX_MEDIA_BYTES = 64 * 1024 * 1024

function classify(name: string, isDirectory: boolean): FileKind {
  if (isDirectory) return 'folder'
  const ext = extname(name).replace('.', '').toLowerCase()
  return KIND_BY_EXT[ext] ?? 'other'
}

function assertAbsolute(path: string): void {
  if (typeof path !== 'string' || !isAbsolute(path)) {
    throw new Error('路径必须是绝对路径')
  }
}

async function describe(dirent: Dirent, parent: string): Promise<FsEntry | null> {
  const full = join(parent, dirent.name)
  try {
    const stat = await fs.lstat(full)
    const isDirectory = dirent.isSymbolicLink() ? false : dirent.isDirectory()
    return {
      name: dirent.name,
      path: full,
      isDirectory,
      kind: classify(dirent.name, isDirectory),
      size: isDirectory ? 0 : stat.size,
      modifiedAt: stat.mtimeMs
    }
  } catch {
    return null
  }
}

interface DirectoryCursor {
  path: string
  directory: Dir
  iterator: AsyncIterator<Dirent>
  mtimeMs: number
  pending: Dirent | null
  expiresAt: number
}

interface PagedListDirResult extends ListDirResult {
  nextCursor: string | null
  stale: boolean
}

const directoryCursors = new Map<string, DirectoryCursor>()

async function closeCursor(cursor: DirectoryCursor): Promise<void> {
  try {
    await cursor.directory.close()
  } catch {
    // The async iterator may already have closed the directory.
  }
}

async function pruneCursors(): Promise<void> {
  const now = Date.now()
  for (const [id, cursor] of directoryCursors) {
    if (cursor.expiresAt <= now) {
      directoryCursors.delete(id)
      await closeCursor(cursor)
    }
  }
  while (directoryCursors.size >= MAX_DIRECTORY_CURSORS) {
    const oldest = directoryCursors.entries().next().value as [string, DirectoryCursor] | undefined
    if (!oldest) break
    directoryCursors.delete(oldest[0])
    await closeCursor(oldest[1])
  }
}

async function describePage(dirents: Dirent[], parent: string): Promise<FsEntry[]> {
  const results: Array<FsEntry | null> = new Array(dirents.length).fill(null)
  let next = 0
  const workers = Array.from({ length: Math.min(64, dirents.length) }, async () => {
    while (true) {
      const index = next++
      if (index >= dirents.length) return
      results[index] = await describe(dirents[index], parent)
    }
  })
  await Promise.all(workers)
  return results.filter((entry): entry is FsEntry => entry !== null)
}

async function readPage(cursor: DirectoryCursor, limit: number): Promise<{ entries: FsEntry[]; hasMore: boolean }> {
  const dirents: Dirent[] = []
  if (cursor.pending) {
    dirents.push(cursor.pending)
    cursor.pending = null
  }
  while (dirents.length < limit) {
    const next = await cursor.iterator.next()
    if (next.done) break
    dirents.push(next.value)
  }
  let next = await cursor.iterator.next()
  const hasMore = !next.done
  cursor.pending = hasMore ? next.value : null
  cursor.expiresAt = Date.now() + CURSOR_TTL_MS
  return { entries: await describePage(dirents, cursor.path), hasMore }
}

function pageLimit(value?: number): number {
  if (value === undefined) return DEFAULT_PAGE_SIZE
  if (!Number.isFinite(value)) throw new Error('分页大小无效')
  return Math.max(1, Math.min(MAX_PAGE_SIZE, Math.floor(value)))
}

const MAX_STAT_PATHS = 2000

async function statPaths(pathsValue: unknown): Promise<FsEntry[]> {
  if (!Array.isArray(pathsValue)) throw new Error('路径列表无效')
  const paths = (pathsValue as unknown[])
    .filter((item): item is string => typeof item === 'string' && item.length > 0)
    .slice(0, MAX_STAT_PATHS)
  const results: Array<FsEntry | null> = new Array(paths.length).fill(null)
  let nextIndex = 0
  const worker = async (): Promise<void> => {
    while (true) {
      const index = nextIndex++
      if (index >= paths.length) return
      const full = paths[index]
      try {
        const stat = await fs.stat(full)
        const isDirectory = stat.isDirectory()
        const name = full.split(/[\\/]/).filter(Boolean).pop() ?? full
        results[index] = {
          name,
          path: full,
          isDirectory,
          kind: classify(name, isDirectory),
          size: isDirectory ? 0 : stat.size,
          modifiedAt: stat.mtimeMs
        }
      } catch {
        results[index] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(64, paths.length) }, () => worker()))
  return results.filter((entry): entry is FsEntry => entry !== null)
}

async function listDir(path: string, requestedLimit?: number): Promise<PagedListDirResult> {
  assertAbsolute(path)
  const limit = pageLimit(requestedLimit)
  const stat = await fs.stat(path)
  const directory = await fs.opendir(path)
  await pruneCursors()
  const cursor: DirectoryCursor = {
    path,
    directory,
    iterator: directory[Symbol.asyncIterator](),
    mtimeMs: stat.mtimeMs,
    pending: null,
    expiresAt: Date.now() + CURSOR_TTL_MS
  }
  let page: { entries: FsEntry[]; hasMore: boolean }
  try {
    page = await readPage(cursor, limit)
  } catch (error) {
    await closeCursor(cursor)
    throw error
  }
  const after = await fs.stat(path).catch(() => null)
  if (!after || after.mtimeMs !== cursor.mtimeMs) {
    await closeCursor(cursor)
    return {
      path,
      parent: dirname(path) === path ? null : dirname(path),
      entries: [],
      truncated: false,
      nextCursor: null,
      stale: true
    }
  }
  const nextCursor = page.hasMore ? randomUUID() : null
  if (nextCursor) directoryCursors.set(nextCursor, cursor)
  else await closeCursor(cursor)
  return {
    path,
    parent: dirname(path) === path ? null : dirname(path),
    entries: page.entries,
    truncated: page.hasMore,
    nextCursor,
    stale: false
  }
}

async function listMore(cursorId: string, requestedLimit?: number): Promise<PagedListDirResult> {
  if (typeof cursorId !== 'string' || !cursorId) throw new Error('目录游标无效')
  const cursor = directoryCursors.get(cursorId)
  if (!cursor || cursor.expiresAt <= Date.now()) {
    if (cursor) {
      directoryCursors.delete(cursorId)
      await closeCursor(cursor)
    }
    throw new Error('目录分页已过期，请刷新目录')
  }
  const limit = pageLimit(requestedLimit)
  directoryCursors.delete(cursorId)
  const before = await fs.stat(cursor.path).catch(() => null)
  if (!before || before.mtimeMs !== cursor.mtimeMs) {
    await closeCursor(cursor)
    return {
      path: cursor.path,
      parent: dirname(cursor.path) === cursor.path ? null : dirname(cursor.path),
      entries: [],
      truncated: false,
      nextCursor: null,
      stale: true
    }
  }
  let page: { entries: FsEntry[]; hasMore: boolean }
  try {
    page = await readPage(cursor, limit)
  } catch (error) {
    await closeCursor(cursor)
    throw error
  }
  const after = await fs.stat(cursor.path).catch(() => null)
  if (!after || after.mtimeMs !== cursor.mtimeMs) {
    await closeCursor(cursor)
    return {
      path: cursor.path,
      parent: dirname(cursor.path) === cursor.path ? null : dirname(cursor.path),
      entries: [],
      truncated: false,
      nextCursor: null,
      stale: true
    }
  }
  const nextCursor = page.hasMore ? randomUUID() : null
  if (nextCursor) directoryCursors.set(nextCursor, cursor)
  else await closeCursor(cursor)
  return {
    path: cursor.path,
    parent: dirname(cursor.path) === cursor.path ? null : dirname(cursor.path),
    entries: page.entries,
    truncated: page.hasMore,
    nextCursor,
    stale: false
  }
}

async function listDrives(): Promise<DriveInfo[]> {
  if (process.platform !== 'win32') {
    return [{ name: '/', path: '/', total: 0, free: 0, isNetwork: false }]
  }
  // Use OS drive types: mapped network drives also have ordinary drive letters.
  const networkLetters = new Set<string>()
  try {
    const { stdout } = await promisify(execFile)('powershell.exe', [
      '-NoLogo', '-NoProfile', '-NonInteractive', '-Command',
      'Get-CimInstance Win32_LogicalDisk -Filter "DriveType=4" | ForEach-Object { $_.DeviceID }'
    ], { windowsHide: true, timeout: 8000, maxBuffer: 65536 })
    for (const letter of stdout.split(/\r?\n/)) {
      if (/^[A-Z]:$/i.test(letter.trim())) networkLetters.add(letter.trim().toUpperCase())
    }
  } catch {
    // Keep browsing available when the OS management provider is unavailable.
  }
  const letters = Array.from({ length: 26 }, (_, index) => `${String.fromCharCode(65 + index)}:\\`)
  const drives = await Promise.all(
    letters.map(async (path) => {
      try {
        const stats = await fs.statfs(path)
        return {
          name: path.slice(0, 2),
          path,
          total: stats.blocks * stats.bsize,
          free: stats.bavail * stats.bsize,
          isNetwork: networkLetters.has(path.slice(0, 2))
        }
      } catch {
        return null
      }
    })
  )
  return drives.filter((drive): drive is DriveInfo => drive !== null)
}

function quickAccess(): QuickAccessItem[] {
  return [
    { id: 'home', label: '主目录', path: app.getPath('home') },
    { id: 'desktop', label: '桌面', path: app.getPath('desktop') },
    { id: 'documents', label: '文档', path: app.getPath('documents') },
    { id: 'downloads', label: '下载', path: app.getPath('downloads') },
    { id: 'pictures', label: '图片', path: app.getPath('pictures') }
  ]
}

async function readText(path: string): Promise<{ path: string; content: string; truncated: boolean }> {
  assertAbsolute(path)
  const stat = await fs.stat(path)
  if (stat.isDirectory()) throw new Error('文件夹不支持文本预览')
  if (stat.size > MAX_TEXT_BYTES) throw new Error('文件超过 2MB，已跳过预览')
  const buffer = await fs.readFile(path)
  if (buffer.subarray(0, 8000).includes(0)) throw new Error('二进制文件不支持文本预览')
  const content = buffer.toString('utf8')
  const truncated = content.length > 200000
  return { path, content: truncated ? content.slice(0, 200000) : content, truncated }
}

async function readImage(path: string): Promise<{ path: string; dataUrl: string }> {
  assertAbsolute(path)
  const stat = await fs.stat(path)
  if (stat.size > MAX_IMAGE_BYTES) throw new Error('图片超过 12MB，已跳过预览')
  const ext = extname(path).replace('.', '').toLowerCase()
  const mimeType = IMAGE_MIME[ext]
  if (!mimeType) throw new Error('该文件不是可预览的图片格式')
  const buffer = await fs.readFile(path)
  return { path, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
}

async function readMedia(
  path: string
): Promise<{ path: string; dataUrl: string; mimeType: string }> {
  assertAbsolute(path)
  const stat = await fs.stat(path)
  if (stat.isDirectory()) throw new Error('文件夹没有媒体预览')
  if (stat.size > MAX_MEDIA_BYTES) throw new Error('音视频超过 64MB，已跳过预览')
  const ext = extname(path).replace('.', '').toLowerCase()
  const mimeType = MEDIA_MIME[ext]
  if (!mimeType) throw new Error('该文件不是可预览的音视频格式')
  const buffer = await fs.readFile(path)
  return { path, mimeType, dataUrl: `data:${mimeType};base64,${buffer.toString('base64')}` }
}

function formatEntries(result: ListDirResult): string {
  const lines = result.entries
    .sort((a, b) => {
      if (a.isDirectory !== b.isDirectory) return a.isDirectory ? -1 : 1
      return a.name.localeCompare(b.name)
    })
    .map((entry) => `${entry.isDirectory ? '[DIR] ' : '      '}${entry.name}${entry.isDirectory ? '' : `  (${entry.size} B, ${entry.kind})`}`)
  return [
    `目录：${result.path}`,
    `条目：${result.entries.length}${result.truncated ? '（已截断）' : ''}`,
    ...('stale' in result && result.stale ? ['目录在分页期间发生变化，请从第一页重新读取'] : []),
    ...('nextCursor' in result && result.nextCursor ? [`下一页游标：${result.nextCursor}（下次调用 list_directory 时传入 cursor）`] : []),
    ...lines
  ].join('\n')
}

const filesystemPlugin: Plugin = {
  inject: ['ipc', 'mcp', 'window', 'store', 'storage'],
  apply(ctx: Context): void {
    const preferencesKey = 'explorer-drive-preferences'
    const preferencesSchema = z.object({ showNetworkDrives: z.boolean() })
    ctx.store.register(preferencesKey, { schema: preferencesSchema, default: { showNetworkDrives: true } })
    ctx.storage.register('data-ops-filesystem', {
      title: '文件浏览器',
      entries: [{ label: '驱动器显示偏好', storeKey: preferencesKey }]
    })
    const getDrivePreferences = () => ctx.store.read<z.infer<typeof preferencesSchema>>(preferencesKey)
    const setDrivePreferences = async (input: unknown) => {
      const preferences = preferencesSchema.parse(input)
      await ctx.store.write(preferencesKey, preferences)
      ctx.ipc.broadcast('filesystem:drivePreferences', preferences)
      return preferences
    }
    ctx.ipc.handle('filesystem', {
      drives: () => listDrives(),
      getDrivePreferences,
      setDrivePreferences,
      quickAccess: () => quickAccess(),
      listDir: (path: string, limit?: number) => listDir(path, limit),
      listMore: (cursor: string, limit?: number) => listMore(cursor, limit),
      statPaths: (paths: string[]) => statPaths(paths),
      readText: (path: string) => readText(path),
      readImage: (path: string) => readImage(path),
      readMedia: (path: string) => readMedia(path),
      open: async (path: string) => {
        assertAbsolute(path)
        const error = await shell.openPath(path)
        if (error) throw new Error(error)
        return true
      },
      reveal: (path: string) => {
        assertAbsolute(path)
        shell.showItemInFolder(path)
        return true
      },
      pickDirectory: async () => {
        const win = ctx.window.getMainWindow()
        const result = win
          ? await dialog.showOpenDialog(win, { properties: ['openDirectory'] })
          : await dialog.showOpenDialog({ properties: ['openDirectory'] })
        return result.canceled ? null : result.filePaths[0] ?? null
      }
    })

    ctx.mcp.registerTool('explorer_drive_preferences', {
      description: 'Read the file sidebar network drive visibility preference, or set it with showNetworkDrives. Does not disconnect drives.',
      inputSchema: { showNetworkDrives: z.boolean().optional() },
      mutating: true,
      execute: async (args) => {
        try {
          const result = args.showNetworkDrives === undefined ? await getDrivePreferences() : await setDrivePreferences(args)
          return mcpText(JSON.stringify(result))
        } catch (error) { return mcpError(String(error)) }
      }
    })
    ctx.mcp.registerTool('list_drives', {
      description: '列出本机磁盘驱动器及容量信息',
      execute: async () => mcpText(JSON.stringify(await listDrives(), null, 2))
    })

    ctx.mcp.registerTool('list_directory', {
      description: '分页列出指定绝对路径目录下的条目（名称、类型、大小、修改时间）。缺省列出用户主目录；返回 nextCursor 后可继续读取',
      inputSchema: {
        path: z.string().optional(),
        cursor: z.string().optional(),
        limit: z.number().int().min(1).max(MAX_PAGE_SIZE).optional()
      },
      execute: async (args) => {
        const target = (args.path as string | undefined) ?? app.getPath('home')
        try {
          const limit = args.limit as number | undefined
          const cursor = args.cursor as string | undefined
          const result = cursor ? await listMore(cursor, limit) : await listDir(target, limit)
          return mcpText(formatEntries(result))
        } catch (error) {
          return mcpError(error instanceof Error ? error.message : String(error))
        }
      }
    })

    ctx.mcp.registerTool('read_text_file', {
      description: '读取指定绝对路径文本文件的内容（最大 2MB，二进制文件拒绝）',
      inputSchema: {
        path: z.string()
      },
      execute: async (args) => {
        try {
          const result = await readText(args.path as string)
          return mcpText(result.content)
        } catch (error) {
          return mcpError(error instanceof Error ? error.message : String(error))
        }
      }
    })
  }
}

export default filesystemPlugin
