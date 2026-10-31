import { app, shell } from 'electron'
import { readdir, stat } from 'node:fs/promises'
import { isAbsolute, join } from 'node:path'
import type { Context, Plugin } from 'cordis'
import { mcpError, mcpText } from '../../services/mcp'
import { isInside, normalize, samePath } from '../../services/paths'

export type StorageKind = 'file' | 'directory'

export interface StorageEntryInput {
  /** 展示名称，例如“文件暂存篮数据” */
  label: string
  description?: string
  /** store 服务已注册的文档键，路径由 store 服务解析 */
  storeKey?: string
  /** 相对 userData 的文件或目录路径 */
  relativePath?: string
  kind?: StorageKind
}

export interface StorageRegistrationInput {
  title: string
  entries: StorageEntryInput[]
}

export interface StorageEntryInfo {
  label: string
  description?: string
  path: string
  kind: StorageKind
  exists: boolean
  size: number
  files: number
}

export interface StorageGroupInfo {
  plugin: string
  title: string
  entries: StorageEntryInfo[]
  size: number
  files: number
}

export interface StorageSnapshot {
  userData: string
  groups: StorageGroupInfo[]
  size: number
  files: number
  measuredAt: number
}

export interface StorageService {
  register(pluginId: string, registration: StorageRegistrationInput): void
}

declare module 'cordis' {
  interface Context {
    storage: StorageService
  }
}

interface ResolvedEntry {
  label: string
  description?: string
  path: string
  kind: StorageKind
}

interface ResolvedGroup {
  plugin: string
  title: string
  entries: ResolvedEntry[]
}

interface Measurement {
  exists: boolean
  size: number
  files: number
}

const PLUGIN_ID = /^[a-z0-9][a-z0-9._-]{0,63}$/
const FILE_CONCURRENCY = 32
const GROUP_CONCURRENCY = 4

async function mapLimit<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results = new Array<R>(items.length)
  let index = 0
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = index++
      results[current] = await fn(items[current])
    }
  })
  await Promise.all(workers)
  return results
}

async function measureDirectory(root: string): Promise<{ size: number; files: number }> {
  let size = 0
  let files = 0
  const queue = [root]
  while (queue.length > 0) {
    const dir = queue.pop() as string
    let entries
    try {
      entries = await readdir(dir, { withFileTypes: true })
    } catch {
      continue
    }
    const measured = await mapLimit(entries, FILE_CONCURRENCY, async (entry): Promise<{ directory: string } | { size: number } | null> => {
      const full = join(dir, entry.name)
      if (entry.isDirectory()) return { directory: full }
      if (!entry.isFile()) return null
      try {
        return { size: (await stat(full)).size }
      } catch {
        return null
      }
    })
    for (const item of measured) {
      if (!item) continue
      if ('directory' in item) queue.push(item.directory)
      else {
        size += item.size
        files += 1
      }
    }
  }
  return { size, files }
}

async function measure(target: string): Promise<Measurement> {
  let info
  try {
    info = await stat(target)
  } catch {
    return { exists: false, size: 0, files: 0 }
  }
  if (!info.isDirectory()) return { exists: true, size: info.size, files: 1 }
  return { exists: true, ...(await measureDirectory(target)) }
}

const storagePlugin: Plugin = {
  name: 'system-provider-storage',
  inject: ['ipc', 'store', 'mcp'],
  apply(ctx: Context): void {
    const userData = normalize(app.getPath('userData'))
    const groups = new Map<string, ResolvedGroup>()

    function resolveEntry(pluginId: string, entry: StorageEntryInput): ResolvedEntry {
      if (!entry || typeof entry.label !== 'string' || !entry.label.trim()) {
        throw new TypeError(`存储登记缺少名称：${pluginId}`)
      }
      const hasStore = typeof entry.storeKey === 'string' && entry.storeKey.length > 0
      const hasPath = typeof entry.relativePath === 'string' && entry.relativePath.length > 0
      if (hasStore === hasPath) {
        throw new TypeError(`存储登记必须且只能提供 storeKey 或 relativePath：${pluginId}/${entry.label}`)
      }
      if (entry.description !== undefined && typeof entry.description !== 'string') {
        throw new TypeError(`存储登记描述必须是字符串：${pluginId}/${entry.label}`)
      }
      if (entry.kind !== undefined && entry.kind !== 'file' && entry.kind !== 'directory') {
        throw new TypeError(`存储登记类型无效：${pluginId}/${entry.label}`)
      }
      if (hasStore) {
        return {
          label: entry.label,
          description: entry.description,
          path: normalize(ctx.store.resolvePath(entry.storeKey as string)),
          kind: 'file'
        }
      }
      const relativePath = entry.relativePath as string
      if (isAbsolute(relativePath) || relativePath.includes('\0')) {
        throw new TypeError(`存储登记路径必须是 userData 下的相对路径：${pluginId}/${entry.label}`)
      }
      const target = normalize(join(userData, relativePath))
      if (!isInside(userData, target)) {
        throw new TypeError(`存储登记路径超出 userData：${pluginId}/${entry.label}`)
      }
      return {
        label: entry.label,
        description: entry.description,
        path: target,
        kind: entry.kind ?? 'file'
      }
    }

    const api: StorageService = {
      register(pluginId, registration) {
        if (typeof pluginId !== 'string' || !PLUGIN_ID.test(pluginId)) {
          throw new TypeError(`非法存储登记标识：${String(pluginId)}`)
        }
        if (groups.has(pluginId)) throw new Error(`存储登记重复：${pluginId}`)
        if (!registration || typeof registration.title !== 'string' || !registration.title.trim()) {
          throw new TypeError(`存储登记缺少标题：${pluginId}`)
        }
        if (!Array.isArray(registration.entries) || registration.entries.length === 0) {
          throw new TypeError(`存储登记缺少条目：${pluginId}`)
        }
        groups.set(pluginId, {
          plugin: pluginId,
          title: registration.title.trim(),
          entries: registration.entries.map((entry) => resolveEntry(pluginId, entry))
        })
      }
    }

    api.register('application', {
      title: '应用程序',
      entries: [
        {
          label: '应用配置',
          description: '窗口位置、MCP 端口与访问权限',
          relativePath: 'config.json'
        }
      ]
    })

    function registeredEntries(): ResolvedEntry[] {
      return [...groups.values()].flatMap((group) => group.entries)
    }

    function isRegisteredPath(target: string): boolean {
      return registeredEntries().some((entry) => samePath(entry.path, target))
    }

    function isCoveredBy(target: string): boolean {
      return registeredEntries().some((entry) =>
        entry.kind === 'directory' ? isInside(entry.path, target) : samePath(entry.path, target)
      )
    }

    async function snapshot(): Promise<StorageSnapshot> {
      const measuredGroups = await mapLimit([...groups.values()], GROUP_CONCURRENCY, async (group) => {
        const entries = await mapLimit(group.entries, GROUP_CONCURRENCY, async (entry) => ({
          ...entry,
          ...(await measure(entry.path))
        }))
        return {
          plugin: group.plugin,
          title: group.title,
          entries,
          size: entries.reduce((sum, entry) => sum + entry.size, 0),
          files: entries.reduce((sum, entry) => sum + entry.files, 0)
        }
      })

      const unclaimed = ctx.store.listDocuments().filter((document) => !isCoveredBy(normalize(document.path)))
      if (unclaimed.length > 0) {
        const entries = await mapLimit(unclaimed, GROUP_CONCURRENCY, async (document) => ({
          label: document.key,
          path: normalize(document.path),
          kind: 'file' as const,
          ...(await measure(document.path))
        }))
        measuredGroups.push({
          plugin: 'unclassified',
          title: '其他数据',
          entries,
          size: entries.reduce((sum, entry) => sum + entry.size, 0),
          files: entries.reduce((sum, entry) => sum + entry.files, 0)
        })
      }

      measuredGroups.sort((a, b) => {
        if (a.plugin === 'application') return -1
        if (b.plugin === 'application') return 1
        return a.plugin.localeCompare(b.plugin)
      })

      return {
        userData,
        groups: measuredGroups,
        size: measuredGroups.reduce((sum, group) => sum + group.size, 0),
        files: measuredGroups.reduce((sum, group) => sum + group.files, 0),
        measuredAt: Date.now()
      }
    }

    async function openLocation(target: string): Promise<true> {
      if (typeof target !== 'string' || !isRegisteredPath(target)) {
        throw new Error('未登记的存储位置')
      }
      let info
      try {
        info = await stat(target)
      } catch {
        throw new Error('存储位置尚未创建')
      }
      if (info.isDirectory()) {
        const error = await shell.openPath(target)
        if (error) throw new Error(error)
      } else {
        shell.showItemInFolder(target)
      }
      return true
    }

    ctx.reflect.provide('storage', api)
    ctx.ipc.handle('storage', {
      list: () => snapshot(),
      open: (target: string) => openLocation(target)
    })
    ctx.mcp.registerTool('plugin_storage', {
      description: '列出各插件在本机用户数据目录中的存储位置与占用大小（只读，不修改文件）',
      execute: async () => {
        try {
          return mcpText(JSON.stringify(await snapshot(), null, 2))
        } catch (error) {
          return mcpError(error instanceof Error ? error.message : String(error))
        }
      }
    })
  }
}

export default storagePlugin
