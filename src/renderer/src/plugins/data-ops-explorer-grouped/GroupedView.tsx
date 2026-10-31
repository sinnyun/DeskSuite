import { useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import { ChevronDown, ChevronRight } from 'lucide-react'
import { call, errorText, useUiKit } from '../../workbench/sdk'
import { useStore } from 'zustand'
import { groupOptionsStore, type GroupBy } from './group-state'

interface FsEntry {
  name: string
  path: string
  isDirectory: boolean
  kind: string
  size: number
  modifiedAt: number
}

interface GroupedViewProps {
  entries: FsEntry[]
  allEntries: FsEntry[]
  path: string | null
  filterEntries: (entries: FsEntry[]) => FsEntry[]
  prepareEntries: (entries: FsEntry[]) => Promise<void>
  registerEntries: (entries: FsEntry[]) => void
  renderLayout?: (navigation: ReactElement) => ReactElement
  renderGroup: (entries: FsEntry[]) => ReactNode
  getRating: (path: string) => number
}

const KIND_NAMES: Record<string, string> = {
  folder: '文件夹', image: '图片', video: '视频', audio: '音频', document: '文档',
  code: '代码', data: '数据', archive: '压缩文件', other: '其他'
}

const GROUP_ORDER = ['folder', 'image', 'video', 'document', 'code', 'data', 'archive', 'audio', 'other']
const MAX_RECURSIVE_DIRECTORIES = 500
const MAX_RECURSIVE_ENTRIES = 25000

async function listAll(path: string): Promise<FsEntry[]> {
  let page = await call<{ entries: FsEntry[]; nextCursor?: string | null; stale?: boolean }>('filesystem', 'listDir', path)
  if (page.stale) throw new Error('目录正在变化，请关闭并重新打开子文件夹显示')
  const result = [...page.entries]
  let cursor = page.nextCursor ?? null
  while (cursor) {
    page = await call<{ entries: FsEntry[]; nextCursor?: string | null; stale?: boolean }>('filesystem', 'listMore', cursor)
    if (page.stale) throw new Error('目录正在变化，请关闭并重新打开子文件夹显示')
    result.push(...page.entries)
    cursor = page.nextCursor ?? null
    if (result.length >= MAX_RECURSIVE_ENTRIES) break
  }
  return result
}

function minuteLabel(timestamp: number): string {
  const date = new Date(timestamp)
  if (!Number.isFinite(date.getTime())) return '时间未知'
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

function parentPath(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index > 0 ? path.slice(0, index) : path
}

function lastSegment(path: string): string {
  const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'))
  return index >= 0 ? path.slice(index + 1) : path
}

function splitSegments(path: string): string[] {
  return path.split(/[\\/]/).filter(Boolean)
}

function commonDirectoryPrefix(paths: string[]): string {
  if (paths.length === 0) return ''
  let common = splitSegments(paths[0])
  for (const path of paths.slice(1)) {
    const parts = splitSegments(path)
    const next: string[] = []
    for (let index = 0; index < Math.min(common.length, parts.length); index++) {
      if (common[index].toLowerCase() !== parts[index].toLowerCase()) break
      next.push(parts[index])
    }
    common = next
  }
  if (common.length === 0) return ''
  const usesBackslash = paths[0].includes('\\')
  return (paths[0].startsWith('/') && !usesBackslash ? '/' : '') + common.join(usesBackslash ? '\\' : '/')
}

function relativeDirectory(path: string, base: string): string {
  if (path.length <= base.length) return ''
  return path.slice(base.length).replace(/^[\\/]+/, '').replace(/[\\/]+$/, '').replace(/\\/g, '/')
}

function groupFor(entry: FsEntry, groupBy: GroupBy, getRating: (path: string) => number, basePath: string | null): { id: string; label: string } {
  if (groupBy === 'modifiedMinute') {
    const label = minuteLabel(entry.modifiedAt)
    return { id: `time:${label}`, label }
  }
  if (groupBy === 'rating') {
    const rating = entry.isDirectory ? 0 : getRating(entry.path)
    const label = rating > 0 ? `${rating} 星` : '未评分'
    return { id: `rating:${rating}`, label }
  }
  if (groupBy === 'folder') {
    const parent = parentPath(entry.path)
    if (basePath) {
      const normalizedBase = basePath.replace(/[\\/]+$/, '')
      const prefix = lastSegment(normalizedBase) || normalizedBase
      const relative = relativeDirectory(parent, normalizedBase)
      return { id: `folder:${parent}`, label: relative ? `${prefix}/${relative}` : prefix }
    }
    return { id: `folder:${parent}`, label: '' }
  }
  const kind = entry.isDirectory ? 'folder' : entry.kind
  return { id: `kind:${kind}`, label: KIND_NAMES[kind] ?? '其他' }
}

export function GroupedView({ entries, allEntries, path, filterEntries, prepareEntries, registerEntries, renderLayout, renderGroup, getRating }: GroupedViewProps): ReactElement {
  const { DesktopButton } = useUiKit()
  const groupBy = useStore(groupOptionsStore, (state) => state.groupBy)
  const includeChildren = useStore(groupOptionsStore, (state) => state.includeChildren)
  const [descendants, setDescendants] = useState<FsEntry[]>([])
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set())
  const registerRef = useRef(registerEntries)
  registerRef.current = registerEntries

  useEffect(() => {
    setDescendants([])
    registerRef.current([])
    setError('')
    setLoading(false)
    if (!includeChildren || !path) return
    let alive = true
    setLoading(true)
    void (async () => {
      const queue = allEntries.filter((entry) => entry.isDirectory).map((entry) => entry.path)
      const visited = new Set<string>()
      const found: FsEntry[] = []
      while (queue.length && visited.size < MAX_RECURSIVE_DIRECTORIES && found.length < MAX_RECURSIVE_ENTRIES) {
        const directory = queue.shift()!
        if (visited.has(directory)) continue
        visited.add(directory)
        try {
          const children = await listAll(directory)
          found.push(...children)
          for (const child of children) if (child.isDirectory) queue.push(child.path)
        } catch (cause) {
          if (alive) setError(errorText(cause, '递归读取分组内容失败'))
        }
      }
      if (alive) {
        await prepareEntries(found)
        if (!alive) return
        const collected = found.slice(0, MAX_RECURSIVE_ENTRIES)
        setDescendants(collected)
        registerRef.current(collected)
        if (queue.length || found.length >= MAX_RECURSIVE_ENTRIES) setError(`已达到递归读取上限（${MAX_RECURSIVE_DIRECTORIES} 个文件夹或 ${MAX_RECURSIVE_ENTRIES} 个条目）`)
        setLoading(false)
      }
    })()
    return () => { alive = false; registerRef.current([]) }
  }, [includeChildren, path, allEntries])

  const grouped = useMemo(() => {
    const combined = includeChildren ? filterEntries([...allEntries, ...descendants]) : entries
    const map = new Map<string, { label: string; items: FsEntry[] }>()
    for (const entry of combined) {
      const group = groupFor(entry, groupBy, getRating, path)
      const existing = map.get(group.id) ?? { label: group.label, items: [] }
      existing.items.push(entry)
      map.set(group.id, existing)
    }
    const groups = [...map.entries()]
    if (groupBy === 'kind') {
      groups.sort(([a], [b]) => GROUP_ORDER.indexOf(a.slice(5)) - GROUP_ORDER.indexOf(b.slice(5)))
    } else if (groupBy === 'folder' && path) {
      const currentId = `folder:${path.replace(/[\\/]+$/, '')}`
      groups.sort(([a], [b]) => {
        if (a === currentId) return -1
        if (b === currentId) return 1
        return a.localeCompare(b, 'zh-Hans-CN', { numeric: true })
      })
    } else if (groupBy === 'folder') {
      const parents = groups.map(([id]) => id.slice('folder:'.length))
      const base = commonDirectoryPrefix(parents)
      const baseName = base ? lastSegment(base) || base : ''
      for (const [id, group] of groups) {
        const parent = id.slice('folder:'.length)
        const relative = relativeDirectory(parent, base)
        group.label = baseName ? (relative ? `${baseName}/${relative}` : baseName) : relative || lastSegment(parent)
      }
      groups.sort(([a], [b]) => a.localeCompare(b, 'zh-Hans-CN', { numeric: true }))
    }
    return groups
  }, [includeChildren, allEntries, descendants, entries, filterEntries, groupBy, getRating, path])

  const navigation = <div data-grouped-view className="h-full min-h-0 overflow-auto bg-[var(--ds-surface-subtle)] p-3">
    {loading && <div className="mb-2 h-0.5 animate-pulse bg-[var(--ds-accent)]/40" />}
    {error && <div className="mb-2 rounded border border-[var(--ds-status-warning)]/30 bg-[var(--ds-status-warning-soft)] px-2 py-1 text-xs text-[var(--ds-status-warning)]">{error}</div>}
    {grouped.length === 0 && !loading && <div className="p-8 text-center text-xs text-[var(--ds-text-subtle)]">没有符合条件的条目</div>}
    {grouped.map(([id, group]) => {
      const isCollapsed = collapsed.has(id)
      return <section data-file-group={id} key={id} className="mb-5">
        <DesktopButton size="sm" variant="ghost" onClick={() => setCollapsed((current) => {
          const next = new Set(current)
          if (next.has(id)) next.delete(id); else next.add(id)
          return next
        })} className="!h-auto !w-full !justify-start !rounded-none !border-0 !bg-transparent !px-0 !py-1 !shadow-none mb-2 gap-1.5 text-left">
          {isCollapsed ? <ChevronRight className="h-4 w-4" /> : <ChevronDown className="h-4 w-4" />}
          <span className="text-xs font-semibold text-[var(--ds-text-primary)]">{group.label}</span>
          <span className="text-xs text-[var(--ds-text-subtle)]">{group.items.length}</span>
        </DesktopButton>
        {!isCollapsed && renderGroup(group.items)}
      </section>
    })}
  </div>
  return renderLayout ? renderLayout(navigation) : navigation
}

export const groupedViewComponent: ComponentType<GroupedViewProps> = GroupedView
