import { app, shell } from 'electron'
import type { Context, Plugin } from 'cordis'
import { createHash } from 'node:crypto'
import { promises as fs } from 'node:fs'
import { execFile } from 'node:child_process'
import { promisify } from 'node:util'
import { join, extname, basename } from 'node:path'
import { z } from 'zod'
import { mcpErrorFrom, mcpText } from '../../services/mcp'

const execFileAsync = promisify(execFile)
const CACHE_TTL = 24 * 60 * 60 * 1000
const CacheSchema = z.object({ createdAt: z.number(), entries: z.array(z.object({
  id: z.string(), name: z.string(), path: z.string(), kind: z.enum(['shortcut', 'application']),
  target: z.string().optional(), description: z.string().optional(), publisher: z.string().optional(),
  version: z.string().optional()
})).max(5000) })
const InstalledApplicationSchema = z.object({
  DisplayName: z.string().max(512).optional(),
  DisplayIcon: z.string().max(32768).optional(),
  InstallLocation: z.string().max(32768).optional(),
  Publisher: z.string().max(512).optional(),
  DisplayVersion: z.string().max(256).optional()
}).passthrough()
const LauncherGroupSchema = z.object({ id: z.string(), name: z.string().min(1).max(32), createdAt: z.number() })
const LauncherGroupsSchema = z.array(LauncherGroupSchema).max(100)
  const LauncherLibrarySchema = z.object({ groups: LauncherGroupsSchema, assignments: z.record(z.string(), z.string()), metadata: z.record(z.string(), z.object({ title: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(500).optional() })) .default({}) })
type LauncherLibrary = z.infer<typeof LauncherLibrarySchema>
type LauncherEntry = z.infer<typeof CacheSchema>['entries'][number]

function entryId(path: string): string {
  return createHash('sha1').update(path.toLowerCase()).digest('hex').slice(0, 16)
}

async function walkShortcuts(root: string): Promise<LauncherEntry[]> {
  const output: LauncherEntry[] = []
  const queue = [root]
  while (queue.length && output.length < 2500) {
    const dir = queue.pop()!
    let children
    try { children = await fs.readdir(dir, { withFileTypes: true }) } catch { continue }
    for (const child of children) {
      const full = join(dir, child.name)
      if (child.isDirectory()) queue.push(full)
      else if (child.isFile() && extname(child.name).toLowerCase() === '.lnk') {
        try {
          const info = shell.readShortcutLink(full)
          output.push({
            id: entryId(full), name: basename(child.name, '.lnk'), path: full, kind: 'shortcut',
            ...(info.target ? { target: info.target } : {}), ...(info.description ? { description: info.description } : {})
          })
        } catch {
          output.push({ id: entryId(full), name: basename(child.name, '.lnk'), path: full, kind: 'shortcut' })
        }
      }
    }
  }
  return output
}

async function installedApplications(): Promise<LauncherEntry[]> {
  if (process.platform !== 'win32') return []
  const script = [
    "$ErrorActionPreference='SilentlyContinue'",
    "$roots=@('HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\WOW6432Node\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*')",
    "$items=foreach($root in $roots){Get-ItemProperty $root | Where-Object { $_.DisplayName -and ($_.DisplayIcon -or $_.InstallLocation) } | Select-Object DisplayName,DisplayIcon,InstallLocation,Publisher,DisplayVersion}",
    "$items | ConvertTo-Json -Compress -Depth 2"
  ].join('; ')
  try {
    const { stdout } = await execFileAsync('powershell.exe', ['-NoLogo', '-NoProfile', '-NonInteractive', '-Command', script], {
      windowsHide: true, timeout: 15000, maxBuffer: 4 * 1024 * 1024
    })
    const parsed: unknown = JSON.parse(stdout.trim() || '[]')
    const rows = Array.isArray(parsed) ? parsed.slice(0, 5000) : [parsed]
    return rows.flatMap((raw: unknown) => {
      const validated = InstalledApplicationSchema.safeParse(raw)
      if (!validated.success) return []
      const row = validated.data
      const name = typeof row.DisplayName === 'string' ? row.DisplayName.trim() : ''
      const displayIconRaw = typeof row.DisplayIcon === 'string' ? row.DisplayIcon.trim() : ''
      const displayIconMatch = displayIconRaw.match(/^"?(.+?\.exe)"?(?:,\s*-?\d+)?$/i)
      const displayIcon = displayIconMatch?.[1] ?? displayIconRaw.replace(/^"|"$/g, '')
      const install = typeof row.InstallLocation === 'string' ? row.InstallLocation : ''
      const candidate = displayIcon.toLowerCase().endsWith('.exe') ? displayIcon : install
      if (!name || !candidate || !candidate.toLowerCase().endsWith('.exe')) return []
      return [{
        id: entryId(candidate), name, path: candidate, target: candidate, kind: 'application' as const,
        ...(typeof row.Publisher === 'string' ? { publisher: row.Publisher } : {}),
        ...(typeof row.DisplayVersion === 'string' ? { version: row.DisplayVersion } : {})
      }]
    })
  } catch {
    return []
  }
}

const launcherPlugin: Plugin = {
    inject: ['ipc', 'store', 'mcp', 'storage'],
  apply(ctx: Context): void {
    ctx.store.register('launcher-cache', { schema: CacheSchema, default: { createdAt: 0, entries: [] }, version: 1 })
      ctx.store.register('launcher-library', { schema: LauncherLibrarySchema, default: { groups: [], assignments: {}, metadata: {} }, version: 1 })
    ctx.storage.register('system-basic-launcher', {
      title: '启动台',
      entries: [
        { label: '应用扫描缓存', storeKey: 'launcher-cache' },
        { label: '分组与固定项', storeKey: 'launcher-library' }
      ]
    })
    const scan = async (): Promise<LauncherEntry[]> => {
      const roots = process.platform === 'win32'
        ? [join(app.getPath('appData'), 'Microsoft', 'Windows', 'Start Menu', 'Programs'), join(process.env.ProgramData ?? 'C:\\ProgramData', 'Microsoft', 'Windows', 'Start Menu', 'Programs')]
        : []
      const shortcuts = (await Promise.all(roots.map(walkShortcuts))).flat()
      const applications = await installedApplications()
      const unique = new Map<string, LauncherEntry>()
      for (const item of [...shortcuts, ...applications]) {
        const key = item.name.trim().toLocaleLowerCase()
        if (!unique.has(key)) unique.set(key, item)
      }
      const entries = [...unique.values()].sort((a, b) => a.name.localeCompare(b.name, 'zh-CN')).slice(0, 5000)
      await ctx.store.write('launcher-cache', { createdAt: Date.now(), entries })
      return entries
    }
    const matchingEntries = async (query = ''): Promise<{ entries: LauncherEntry[]; library: LauncherLibrary }> => {
      const cache = await ctx.store.read<z.infer<typeof CacheSchema>>('launcher-cache')
      const entries = Date.now() - cache.createdAt < CACHE_TTL ? cache.entries : await scan()
      const library = await ctx.store.read<LauncherLibrary>('launcher-library')
      const needle = String(query ?? '').trim().toLocaleLowerCase()
      const matched = needle ? entries.filter((entry) => `${library.metadata[entry.id]?.title ?? entry.name} ${entry.name} ${entry.target ?? ''} ${entry.publisher ?? ''}`.toLocaleLowerCase().includes(needle)) : entries
      return { entries: matched, library }
    }
    const list = async (query = '', offset = 0): Promise<LauncherEntry[]> => {
      const { entries, library } = await matchingEntries(query)
      const start = Math.max(0, Math.floor(Number(offset) || 0))
        return entries.slice(start, start + 250).map((entry) => ({ ...entry, ...(library.metadata[entry.id] ?? {}), ...(library.assignments[entry.id] ? { groupId: library.assignments[entry.id] } : {}) }))
    }
    const updateLibrary = (update: (library: LauncherLibrary) => LauncherLibrary): Promise<LauncherLibrary> =>
      ctx.store.update<LauncherLibrary>('launcher-library', update)
    ctx.ipc.handle('launcher', {
      list,
      summary: async (query = '') => {
        const { entries, library } = await matchingEntries(query)
        const groupCounts = Object.fromEntries(library.groups.map((group) => [group.id, 0])) as Record<string, number>
        for (const entry of entries) {
          const groupId = library.assignments[entry.id]
          if (groupId && groupId in groupCounts) groupCounts[groupId] += 1
        }
        return { total: entries.length, applications: entries.filter((entry) => entry.kind === 'application').length, shortcuts: entries.filter((entry) => entry.kind === 'shortcut').length, groupCounts }
      },
      groups: async () => (await ctx.store.read<LauncherLibrary>('launcher-library')).groups,
      createGroup: async (name: string) => {
        const label = String(name ?? '').trim()
        if (!label || label.length > 32) throw new Error('分类名称需为 1 到 32 个字符')
        const result = await updateLibrary((library) => {
          if (library.groups.some((group) => group.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('分类名称已存在')
          if (library.groups.length >= 100) throw new Error('最多创建 100 个分类')
          return { ...library, groups: [...library.groups, { id: createHash('sha1').update(`${Date.now()}-${label}`).digest('hex').slice(0, 12), name: label, createdAt: Date.now() }] }
        })
        return result.groups
      },
      renameGroup: async (id: string, name: string) => {
        const label = String(name ?? '').trim()
        if (!label || label.length > 32) throw new Error('分类名称需为 1 到 32 个字符')
        const result = await updateLibrary((library) => {
          if (library.groups.some((group) => group.id !== id && group.name.toLocaleLowerCase() === label.toLocaleLowerCase())) throw new Error('分类名称已存在')
          return { ...library, groups: library.groups.map((group) => group.id === id ? { ...group, name: label } : group) }
        })
        return result.groups
      },
      deleteGroup: async (id: string) => {
        const result = await updateLibrary((library) => {
          const assignments = Object.fromEntries(Object.entries(library.assignments).filter(([, groupId]) => groupId !== id))
            return { ...library, groups: library.groups.filter((group) => group.id !== id), assignments }
        })
        return result.groups
      },
      assignGroup: async (id: string, groupId: string | null) => {
        await updateLibrary((library) => {
          if (groupId && !library.groups.some((group) => group.id === groupId)) throw new Error('目标分类不存在')
          const assignments = { ...library.assignments }
          if (groupId) assignments[id] = groupId
          else delete assignments[id]
          return { ...library, assignments }
        })
        return true
      },
      refresh: () => scan(),
      open: async (id: string) => {
        const { entries } = await ctx.store.read<z.infer<typeof CacheSchema>>('launcher-cache')
        const item = entries.find((entry) => entry.id === id)
        if (!item) throw new Error('启动项不存在，请刷新启动台')
        const error = await shell.openPath(item.path)
        if (error) throw new Error(error)
        return true
      },
      icon: async (id: string) => {
        const { entries } = await ctx.store.read<z.infer<typeof CacheSchema>>('launcher-cache')
        const item = entries.find((entry) => entry.id === id)
        if (!item) return null
        try { return (await app.getFileIcon(item.target ?? item.path, { size: 'normal' })).toDataURL() } catch { return null }
      }
    }, {
      list: z.tuple([z.string().max(512).optional(), z.number().int().min(0).max(10_000_000).optional()]),
      summary: z.tuple([z.string().max(512).optional()]),
      groups: z.tuple([]),
      createGroup: z.tuple([z.string().trim().min(1).max(32)]),
      renameGroup: z.tuple([z.string().min(1).max(128), z.string().trim().min(1).max(32)]),
      deleteGroup: z.tuple([z.string().min(1).max(128)]),
      assignGroup: z.tuple([z.string().min(1).max(128), z.string().min(1).max(128).nullable()]),
      refresh: z.tuple([]),
      open: z.tuple([z.string().min(1).max(128)]),
      icon: z.tuple([z.string().min(1).max(128)])
    })
    ctx.mcp.registerTool('launcher_list', { description: '列出启动台程序、分类和用户补充的标题/说明', inputSchema: { query: z.string().optional(), offset: z.number().int().min(0).optional() }, execute: async (args) => mcpText(JSON.stringify(await list(String(args.query ?? ''), Number(args.offset ?? 0)))) })
    ctx.mcp.registerTool('launcher_groups', { description: '列出启动台分类及程序数量', inputSchema: {}, execute: async () => mcpText(JSON.stringify(await ctx.store.read<LauncherLibrary>('launcher-library'))) })
    ctx.mcp.registerTool('launcher_group_create', { description: '创建启动台分类', inputSchema: { name: z.string().trim().min(1).max(32) }, mutating: true, execute: async (args) => {
      try {
        const label = String(args.name)
        const result = await updateLibrary((library) => {
          if (library.groups.some((group) => group.name.toLowerCase() === label.toLowerCase())) throw new Error('分类名称已存在')
          if (library.groups.length >= 100) throw new Error('最多创建 100 个分类')
          return { ...library, groups: [...library.groups, { id: createHash('sha1').update(`${Date.now()}-${label}`).digest('hex').slice(0, 12), name: label, createdAt: Date.now() }] }
        })
        return mcpText(JSON.stringify(result.groups))
      } catch (error) { return mcpErrorFrom(error) }
    } })
    ctx.mcp.registerTool('launcher_program_update', { description: '更新启动台程序的分类、显示标题和说明；省略字段表示保留原值，groupId 传空字符串表示取消分类', inputSchema: { id: z.string().min(1), groupId: z.string().optional(), title: z.string().trim().min(1).max(100).optional(), description: z.string().trim().max(500).optional() }, mutating: true, execute: async (args) => {
      try {
        const id = String(args.id)
        const { entries } = await matchingEntries()
        if (!entries.some((entry) => entry.id === id)) throw new Error('启动项不存在，请先刷新启动台')
        await updateLibrary((library) => {
          const assignments = { ...library.assignments }
          if (args.groupId !== undefined) {
            const groupId = String(args.groupId)
            if (groupId && !library.groups.some((group) => group.id === groupId)) throw new Error('目标分类不存在')
            if (groupId) assignments[id] = groupId; else delete assignments[id]
          }
          const metadata = { ...library.metadata }
          const previous = metadata[id] ?? {}
          const next = { ...previous, ...(args.title !== undefined ? { title: String(args.title) } : {}), ...(args.description !== undefined ? { description: String(args.description) } : {}) }
          if (!next.title && !next.description) delete metadata[id]; else metadata[id] = next
          return { ...library, assignments, metadata }
        })
        return mcpText(JSON.stringify({ updated: id }))
      } catch (error) { return mcpErrorFrom(error) }
    } })
  }
}

export default launcherPlugin
