import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { AppWindow, Archive, Boxes, Grid2X2, Pencil, Plus, RefreshCw, Search, Trash2 } from 'lucide-react'
import { call, callValidated, errorText, getService, useLayoutShallow, useUiKit } from '../../workbench/sdk'
import type { ContextMenuService } from '../../workbench/sdk'
import { LauncherEntriesSchema, LauncherGroupsSchema, LauncherIconSchema, LauncherSummarySchema } from './schemas'

interface LauncherGroup { id: string; name: string; createdAt: number }
interface LauncherSummary { total: number; applications: number; shortcuts: number; groupCounts: Record<string, number> }
interface LauncherEntry {
  id: string
  name: string
  title?: string
  path: string
  kind: 'shortcut' | 'application'
  target?: string
  description?: string
  publisher?: string
  version?: string
  groupId?: string
}
type LauncherFilter = 'all' | 'application' | 'shortcut' | `group:${string}`

const iconCache = new Map<string, string | null>()

function LauncherIcon({ entry, className = 'h-9 w-9' }: { entry: LauncherEntry; className?: string }): ReactElement {
  const element = useRef<HTMLSpanElement>(null)
  const [icon, setIcon] = useState<string | null>(iconCache.get(entry.id) ?? null)
  useEffect(() => {
    if (iconCache.has(entry.id)) { setIcon(iconCache.get(entry.id) ?? null); return }
    const node = element.current
    if (!node) return
    let alive = true
    const load = (): void => {
      void callValidated(LauncherIconSchema, 'launcher', 'icon', entry.id).then((value) => { iconCache.set(entry.id, value); if (alive) setIcon(value) }).catch(() => { iconCache.set(entry.id, null) })
    }
    if (typeof IntersectionObserver === 'undefined') load()
    else {
      const observer = new IntersectionObserver((items) => { if (!items.some((item) => item.isIntersecting)) return; observer.disconnect(); load() })
      observer.observe(node)
      return () => { alive = false; observer.disconnect() }
    }
    return () => { alive = false }
  }, [entry.id])
  return <span ref={element} className={`flex shrink-0 items-center justify-center ${className}`}>{icon ? <img src={icon} alt="" className="h-full w-full object-contain" /> : <AppWindow className="h-7 w-7 text-[var(--ds-text-muted)]" />}</span>
}

export function LauncherPanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopInput, DesktopSelect, DesktopButton, DesktopIconButton, DesktopCardButton, prompt } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'launcher'
  const [entries, setEntries] = useState<LauncherEntry[]>([])
  const [summary, setSummary] = useState<LauncherSummary>({ total: 0, applications: 0, shortcuts: 0, groupCounts: {} })
  const [groups, setGroups] = useState<LauncherGroup[]>([])
  const [query, setQuery] = useState('')
  const [filter, setFilter] = useState<LauncherFilter>('all')
  const [selectedId, setSelectedId] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  const load = async (refresh = false): Promise<void> => {
    setBusy(true); setError('')
    try {
      if (refresh) await call('launcher', 'refresh')
      const [next, nextGroups, nextSummary] = await Promise.all([callValidated(LauncherEntriesSchema, 'launcher', 'list', query, 0), callValidated(LauncherGroupsSchema, 'launcher', 'groups'), callValidated(LauncherSummarySchema, 'launcher', 'summary', query)])
      setEntries(next); setGroups(nextGroups); setSummary(nextSummary)
    } catch (cause) { setError(errorText(cause, '无法读取启动项')) }
    finally { setBusy(false) }
  }

  useEffect(() => { if (isOpen) void load() }, [isOpen])
  useEffect(() => {
    if (!isOpen) return
    const timer = window.setTimeout(() => void load(), 180)
    return () => window.clearTimeout(timer)
  }, [query, isOpen])

  const visible = useMemo(() => entries.filter((entry) => {
    if (filter === 'all') return true
    if (filter === 'application' || filter === 'shortcut') return entry.kind === filter
    return entry.groupId === filter.slice('group:'.length)
  }), [entries, filter])
  const selected = visible.find((entry) => entry.id === selectedId) ?? visible[0]
  const groupCounts = useMemo(() => groups.map((group) => ({ ...group, count: summary.groupCounts[group.id] ?? 0 })), [groups, summary])
  const loadMore = async (): Promise<void> => {
    setBusy(true)
    try {
      const next = await callValidated(LauncherEntriesSchema, 'launcher', 'list', query, entries.length)
      setEntries((current) => [...current, ...next])
    } catch (cause) { setError(errorText(cause, '加载更多失败')) }
    finally { setBusy(false) }
  }
  const launch = async (entry: LauncherEntry): Promise<void> => {
    setError('')
    try { await call('launcher', 'open', entry.id) }
    catch (cause) { setError(errorText(cause, '启动失败')) }
  }
  const createGroup = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!newGroup.trim()) return
    try { setGroups(await callValidated(LauncherGroupsSchema, 'launcher', 'createGroup', newGroup)); setNewGroup('') }
    catch (cause) { setError(errorText(cause, '创建分类失败')) }
  }
  const assignEntry = async (entry: LauncherEntry, groupId: string | null): Promise<void> => {
    try {
      await call('launcher', 'assignGroup', entry.id, groupId)
      setEntries((current) => current.map((item) => item.id === entry.id ? { ...item, groupId: groupId ?? undefined } : item))
      setSummary((current) => {
        const groupCounts = { ...current.groupCounts }
        if (entry.groupId && groupCounts[entry.groupId] > 0) groupCounts[entry.groupId] -= 1
        if (groupId) groupCounts[groupId] = (groupCounts[groupId] ?? 0) + 1
        return { ...current, groupCounts }
      })
    } catch (cause) { setError(errorText(cause, '更新分类失败')) }
  }
  const assignGroup = async (groupId: string): Promise<void> => {
    if (selected) await assignEntry(selected, groupId || null)
  }
  const renameGroup = async (group: LauncherGroup): Promise<void> => {
    const name = await prompt({ title: '重命名分类', value: group.name, confirmText: '保存' })
    if (name === null || !name.trim()) return
    try { setGroups(await callValidated(LauncherGroupsSchema, 'launcher', 'renameGroup', group.id, name)) }
    catch (cause) { setError(errorText(cause, '重命名分类失败')) }
  }
  const deleteGroup = async (group: LauncherGroup): Promise<void> => {
    try {
      setGroups(await callValidated(LauncherGroupsSchema, 'launcher', 'deleteGroup', group.id))
      setEntries((current) => current.map((entry) => entry.groupId === group.id ? { ...entry, groupId: undefined } : entry))
      setSummary((current) => ({ ...current, groupCounts: Object.fromEntries(Object.entries(current.groupCounts).filter(([id]) => id !== group.id)) }))
      if (filter === `group:${group.id}`) setFilter('all')
    } catch (cause) { setError(errorText(cause, '删除分类失败')) }
  }

  useEffect(() => {
    const cm = getService<ContextMenuService>('contextMenu')
    if (!cm) return
    return cm.register('launcher.panel', ({ target }) => {
      const element = target instanceof Element ? target : null
      const groupRow = element?.closest<HTMLElement>('[data-launcher-group]')
      if (groupRow) {
        const group = groups.find((item) => item.id === groupRow.dataset.launcherGroup)
        if (!group) return null
        return [
          { id: 'rename', label: '重命名分类…', onSelect: () => void renameGroup(group) },
          { id: 'delete', label: '删除分类', danger: true, onSelect: () => { if (window.confirm(`删除分类「${group.name}」？分类内程序会回到未分类。`)) void deleteGroup(group) } }
        ]
      }
      const card = element?.closest<HTMLElement>('[data-launcher-entry]')
      if (card) {
        const entry = entries.find((item) => item.id === card.dataset.launcherEntry)
        if (!entry) return null
        setSelectedId(entry.id)
        return [
          { id: 'launch', label: '启动', onSelect: () => void launch(entry) },
          { id: 'reveal', label: '打开文件位置', disabled: !entry.path, onSelect: () => { void call('filesystem', 'reveal', entry.path).catch(() => {}) } },
          { id: 'copyPath', label: '复制路径', disabled: !entry.path, onSelect: () => { void call('clipboard', 'writeText', entry.path).catch(() => {}) } },
          { separator: true, id: 'sep-assign' },
          { id: 'assign', label: '分配到分类', submenu: [
            { id: 'assign-none', label: '未分类', checked: !entry.groupId, onSelect: () => void assignEntry(entry, null) },
            ...groups.map((group) => ({ id: `assign-${group.id}`, label: group.name, checked: entry.groupId === group.id, onSelect: () => void assignEntry(entry, group.id) }))
          ] }
        ]
      }
      return [{ id: 'refresh', label: '重新扫描', disabled: busy, onSelect: () => void load(true) }]
    }, { order: 10 })
  }, [entries, groups, busy, launch, assignEntry, renameGroup, deleteGroup, load])

  return (
    <ThemeFloatingPanel title="应用启动台" icon={<Grid2X2 className="w-3.5 h-3.5" />} badge={`${entries.length} 项`} isOpen={isOpen} onClose={closeFloatingPanel} initialX={40} initialY={50} initialWidth={1240} initialHeight={760} minWidth={900} minHeight={500}
      headerActions={<DesktopIconButton size="xs" icon={<RefreshCw className="w-3.5 h-3.5" />} tooltip="重新扫描开始菜单和已安装应用" disabled={busy} onClick={() => void load(true)} />}>
      <div data-context-zone="launcher.panel" className="grid h-full min-h-0 grid-cols-[165px_minmax(0,1fr)_255px] overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-inset)]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-2 px-2 py-2"><div data-ds-type="section-title" className="ds-type-section-title flex items-center gap-2"><Grid2X2 className="h-4 w-4 text-[var(--ds-accent)]"/>启动台</div><div data-ds-type="meta" className="ds-type-meta mt-1 pl-6">个人程序工作台</div></div>
          <div className="space-y-0.5 border-b border-[var(--ds-border)] pb-2">{([['all', '全部程序', summary.total, <Grid2X2 className="h-4 w-4"/>], ['application', '已安装应用', summary.applications, <AppWindow className="h-4 w-4"/>], ['shortcut', '快捷方式', summary.shortcuts, <Boxes className="h-4 w-4"/>]] as const).map(([key, label, count, icon]) => <DesktopButton key={key} type="button" size="sm" variant="ghost" active={filter === key} onClick={() => setFilter(key)} className="w-full justify-start"><span className="flex w-full items-center gap-2 text-left">{icon}<span className="flex-1">{label}</span><span className="text-xs text-[var(--ds-text-muted)]">{count}</span></span></DesktopButton>)}</div>
          <div className="flex items-center px-2 pb-1 pt-3 text-xs font-semibold text-[var(--ds-text-muted)]">我的分类 <span className="ml-auto text-[var(--ds-text-subtle)]">{groups.length}</span></div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{groupCounts.map((group) => <div key={group.id} data-launcher-group={group.id} data-launcher-group-name={group.name} className="group flex items-center"><DesktopButton type="button" size="sm" variant="ghost" active={filter === `group:${group.id}`} onClick={() => setFilter(`group:${group.id}`)} className="min-w-0 flex-1 justify-start"><span className="flex w-full min-w-0 items-center gap-2 text-left"><Archive className="h-4 w-4 shrink-0"/><span className="truncate">{group.name}</span><span className="ml-auto text-xs text-[var(--ds-text-muted)]">{group.count}</span></span></DesktopButton><DesktopIconButton size="xs" icon={<Pencil className="h-3 w-3"/>} tooltip="重命名分类" onClick={() => void renameGroup(group)} className="hidden group-hover:inline-flex"/><DesktopIconButton size="xs" icon={<Trash2 className="h-3 w-3"/>} tooltip="删除分类" onClick={() => void deleteGroup(group)} className="hidden group-hover:inline-flex text-[var(--ds-status-danger)]"/></div>)}</div>
          <form onSubmit={(event) => void createGroup(event)} className="mt-2 flex gap-1 border-t border-[var(--ds-border)] pt-2"><DesktopInput value={newGroup} onChange={(event) => setNewGroup(event.target.value)} maxLength={32} placeholder="新分类名称" className="min-w-0 flex-1"/><DesktopIconButton type="submit" size="xs" icon={<Plus className="h-3.5 w-3.5"/>} tooltip="添加分类" disabled={!newGroup.trim()} active/></form>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-inset)]">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><DesktopInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索程序名称或路径" icon={<Search className="h-3.5 w-3.5"/>}/><span className="shrink-0 text-xs text-[var(--ds-text-subtle)]">{summary.total} 个程序</span></div>
          {error && <div className="shrink-0 border-b border-[var(--ds-status-danger)]/35 bg-[var(--ds-status-danger-soft)] px-3 py-1.5 text-xs text-[var(--ds-status-danger)] dark:border-[var(--ds-status-danger)]/35 dark:bg-[var(--ds-status-danger-soft)] dark:text-[var(--ds-status-danger)]">{error}</div>}
          <div className="flex min-h-0 flex-1 flex-col"><div className="flex shrink-0 items-center justify-between px-3 py-2"><div data-ds-type="section-title" className="ds-type-section-title">{filter === 'all' ? '全部程序' : filter === 'application' ? '已安装应用' : filter === 'shortcut' ? '快捷方式' : groups.find((group) => `group:${group.id}` === filter)?.name ?? '我的分类'}</div><span data-ds-type="meta" className="ds-type-meta">已加载 {visible.length} / {summary.total} · 双击启动</span></div>
            <div className="min-h-0 flex-1 overflow-y-auto px-3 pb-3"><div className="grid grid-cols-3 gap-2 xl:grid-cols-4 2xl:grid-cols-5">{visible.map((entry) => <div key={entry.id} data-launcher-entry={entry.id} data-launcher-entry-name={entry.title ?? entry.name} data-launcher-entry-path={entry.path} className="min-w-0"><DesktopCardButton selected={selected?.id === entry.id} onClick={() => setSelectedId(entry.id)} onDoubleClick={() => void launch(entry)} className="flex h-[128px] w-full flex-col items-center p-2 text-center"><span className="flex h-12 w-12 items-center justify-center"><LauncherIcon entry={entry}/></span><span data-ds-type="body" className="ds-type-body mt-2 w-full truncate font-medium" title={entry.name}>{entry.title ?? entry.name}</span><span data-ds-type="meta" className="ds-type-meta mt-1 w-full truncate">{entry.publisher || (entry.kind === 'shortcut' ? '快捷方式' : '已安装应用')}</span></DesktopCardButton></div>)}</div>
              {!visible.length && <div className="flex h-48 flex-col items-center justify-center gap-2 text-center text-xs text-[var(--ds-text-subtle)]"><AppWindow className="h-7 w-7 text-[var(--ds-text-subtle)]"/>{busy ? '正在扫描程序…' : '没有匹配的程序'}</div>}{entries.length < summary.total && <div className="flex justify-center py-3"><DesktopButton size="xs" variant="ghost" disabled={busy} onClick={() => void loadMore()}>{busy ? '加载中…' : '加载更多程序'}</DesktopButton></div>}</div>
          </div>
        </main>
        <aside className="flex min-h-0 flex-col border-l border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-4 flex items-center justify-between text-xs font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]"><span>程序信息</span><span className="text-xs font-normal text-[var(--ds-text-subtle)]">{selected ? '已选中' : ''}</span></div>
          {selected ? <><div className="flex h-20 items-center justify-center"><LauncherIcon entry={selected} className="h-14 w-14"/></div><div className="mt-2 text-center text-xs font-semibold text-[var(--ds-text-primary)]">{selected.title ?? selected.name}</div><div className="mt-4 min-h-0 flex-1 space-y-3 overflow-y-auto border-t border-[var(--ds-border)] pt-3 text-xs"><div><div className="mb-1 text-[var(--ds-text-muted)]">程序说明</div><div className="leading-relaxed text-[var(--ds-text-secondary)]">{selected.description || selected.publisher || '未提供程序说明'}</div></div><div><div className="mb-1 text-[var(--ds-text-muted)]">分类</div><DesktopSelect value={selected.groupId ?? ''} aria-label="程序分类" options={[{ value: '', label: '未分类' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={(value) => void assignGroup(value)} className="w-full"/></div><div><div className="mb-1 text-[var(--ds-text-muted)]">发布者</div><div className="break-words text-[var(--ds-text-secondary)]">{selected.publisher || '未知'}</div></div>{selected.version && <div><div className="mb-1 text-[var(--ds-text-muted)]">版本</div><div className="text-[var(--ds-text-secondary)]">{selected.version}</div></div>}<div><div className="mb-1 text-[var(--ds-text-muted)]">路径</div><div className="break-all leading-relaxed text-[var(--ds-text-secondary)]">{selected.path}</div></div></div><DesktopButton size="xs" variant="primary" icon={<AppWindow className="h-3.5 w-3.5"/>} onClick={() => void launch(selected)}>启动程序</DesktopButton></> : <div className="flex flex-1 items-center justify-center text-center text-xs text-[var(--ds-text-subtle)]">选择程序卡片<br/>查看程序信息</div>}
        </aside>
      </div>
    </ThemeFloatingPanel>
  )
}
