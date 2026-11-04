import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { ChevronDown, ChevronRight, Folder, MoreHorizontal, Pencil, Plus, X } from 'lucide-react'
import { errorText, useUiKit } from '../../../workbench/sdk'
import { addSelectedBookmarks, bookmarkAction, openBookmark, type BookmarkGroup } from '../bookmarks'
import { useExplorerShallow } from '../store'

type Editor = { groupId?: string; itemId?: string; name: string; path: string }

export function QuickBookmarks(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopInput } = useUiKit()
  const state = useExplorerShallow((s) => ({ entries: s.entries, selectedPaths: s.selectedPaths, path: s.path }))
  const [groups, setGroups] = useState<BookmarkGroup[]>([])
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [menu, setMenu] = useState<string | null>(null)
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set())
  const [editor, setEditor] = useState<Editor | null>(null)
  const [deleting, setDeleting] = useState<string | null>(null)
  const selectedCount = state.entries.filter((item) => item.isDirectory && state.selectedPaths.includes(item.path)).length
  const run = async (task: () => Promise<unknown>): Promise<void> => {
    setBusy(true)
    setError('')
    try { await task() } catch (error) { setError(errorText(error, '收藏操作失败')) }
    finally { setBusy(false) }
  }
  useEffect(() => {
    let alive = true
    const refresh = (): void => { void bookmarkAction({ action: 'list' }).then((value) => { if (alive) setGroups(value) }).catch((error) => { if (alive) setError(errorText(error, '无法读取快速收藏')) }) }
    const stop = window.bridge.onEvent((channel) => { if (channel === 'quickBookmarks:changed') refresh() })
    const onToggleGroup = (event: Event): void => {
      const groupId = (event as CustomEvent<{ groupId?: string }>).detail?.groupId
      if (!groupId) return
      setCollapsed((prev) => { const next = new Set(prev); if (next.has(groupId)) next.delete(groupId); else next.add(groupId); return next })
    }
    window.addEventListener('explorer:toggle-bookmark-group', onToggleGroup)
    refresh()
    return () => { alive = false; stop(); window.removeEventListener('explorer:toggle-bookmark-group', onToggleGroup) }
  }, [])
  const save = (): void => {
    if (!editor) return
    void run(async () => {
      setGroups(await bookmarkAction({ action: editor.itemId ? 'edit' : editor.groupId ? 'renameGroup' : 'createGroup', ...editor }))
      setEditor(null)
    })
  }
  return <div data-quick-bookmarks className="flex flex-col gap-3 min-w-0">
    <div className="px-1.5 font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)]">快速收藏</div>
    <p className="px-2 text-xs text-[var(--ds-text-muted)]">选中文件夹后，点击分组 ＋ 收藏</p>
    {groups.map((group) => <section key={group.id} data-bookmark-group={group.id} data-tree-kind="bookmark-group" className="min-w-0">
      <div className="flex items-center gap-1 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)]">
        <DesktopButton size="xs" variant="ghost" className="!h-auto !min-w-0 !flex-1 !justify-start !px-1 !py-1 !bg-transparent !border-0 !shadow-none !rounded-none gap-1 text-left text-[var(--ds-text-secondary)]" onClick={() => setCollapsed((prev) => { const next = new Set(prev); if (next.has(group.id)) next.delete(group.id); else next.add(group.id); return next })} aria-expanded={!collapsed.has(group.id)}>
          {collapsed.has(group.id) ? <ChevronRight size={13} /> : <ChevronDown size={13} />}<span className="truncate font-medium">{group.name}</span><span className="text-xs opacity-60">{group.items.length}</span>
        </DesktopButton>
        <DesktopIconButton size="xs" icon={<MoreHorizontal size={14} />} tooltip={`管理分组：${group.name}`} onClick={() => { setMenu(menu === group.id ? null : group.id); setDeleting(null) }} />
        <DesktopIconButton size="xs" icon={<Plus size={15} />} disabled={busy || selectedCount === 0} tooltip={selectedCount ? `收藏选中的 ${selectedCount} 个文件夹到${group.name}` : '请先在中间文件视图选中文件夹'} onClick={() => void run(async () => { setGroups(await addSelectedBookmarks(group.id)); setCollapsed((prev) => { const next = new Set(prev); next.delete(group.id); return next }) })} />
      </div>
      {menu === group.id && <div className="flex flex-wrap gap-1 p-1 rounded bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)]">
        <DesktopButton size="xs" variant="ghost" onClick={() => { setEditor({ groupId: group.id, name: group.name, path: '' }); setMenu(null) }}>重命名</DesktopButton>
        {deleting === group.id ? <><span className="text-xs w-full">删除分组和其中的收藏？文件不受影响。</span><DesktopButton size="xs" variant="danger" disabled={busy} onClick={() => void run(async () => { setGroups(await bookmarkAction({ action: 'deleteGroup', groupId: group.id })); setDeleting(null); setMenu(null) })}>确认删除</DesktopButton><DesktopButton size="xs" onClick={() => setDeleting(null)}>取消</DesktopButton></> : <DesktopButton size="xs" variant="ghost" onClick={() => setDeleting(group.id)}>删除分组</DesktopButton>}
      </div>}
      {!collapsed.has(group.id) && <div className="flex flex-col gap-0.5 mt-1">
        {group.items.map((item) => <div key={item.id} className="group flex items-center min-w-0 rounded-md hover:bg-[var(--ds-surface-muted)]">
          <DesktopButton size="sm" variant="ghost" active={state.path === item.path} title={`${item.name}\n${item.path}`} data-bookmark-path={item.path} data-bookmark-item={item.id} className="!h-auto !min-w-0 !flex-1 !justify-start !px-2 !py-1.5 !border-0 !shadow-none gap-2 text-left" onClick={() => void run(() => openBookmark(group.id, item.id))}>
            <Folder size={14} className="shrink-0 text-[var(--ds-status-warning)]" /><span className="min-w-0"><span className="block truncate">{item.name}</span><span className="block truncate text-xs text-[var(--ds-text-muted)]">{item.path}</span></span>
          </DesktopButton>
          <DesktopIconButton size="xs" icon={<Pencil size={11} />} tooltip={`编辑收藏：${item.name}`} onClick={() => setEditor({ groupId: group.id, itemId: item.id, name: item.name, path: item.path })} />
          <DesktopIconButton size="xs" icon={<X size={12} />} tooltip={`移除收藏：${item.name}`} disabled={busy} onClick={() => void run(async () => { setGroups(await bookmarkAction({ action: 'remove', groupId: group.id, itemId: item.id })) })} />
        </div>)}
        {group.items.length === 0 && <span className="px-2 py-2 text-xs text-[var(--ds-text-muted)]">暂无收藏，选中文件夹后点击 ＋</span>}
      </div>}
    </section>)}
    {editor && <form className="flex flex-col gap-2 p-2 rounded-lg border border-[var(--ds-border)] dark:border-[var(--ds-border)]" onSubmit={(event) => { event.preventDefault(); save() }}>
      <span className="font-medium">{editor.itemId ? '编辑收藏' : editor.groupId ? '重命名分组' : '新建分组'}</span>
      <DesktopInput aria-label="名称" placeholder="名称" autoFocus maxLength={120} required value={editor.name} onChange={(event) => setEditor({ ...editor, name: event.target.value })} />
      {editor.itemId && <DesktopInput aria-label="文件夹地址" placeholder="文件夹绝对路径" required value={editor.path} onChange={(event) => setEditor({ ...editor, path: event.target.value })} />}
      <div className="flex gap-2"><DesktopButton type="submit" size="xs" variant="primary" disabled={busy || !editor.name.trim()}>保存</DesktopButton><DesktopButton size="xs" type="button" onClick={() => setEditor(null)}>取消</DesktopButton></div>
    </form>}
    {error && <p role="alert" className="text-xs text-[var(--ds-status-danger)] break-words px-2">{error}</p>}
    <DesktopButton size="sm" variant="subtle" icon={<Plus size={14} />} onClick={() => { setEditor({ name: '', path: '' }); setError('') }}>新建分组</DesktopButton>
  </div>
}
