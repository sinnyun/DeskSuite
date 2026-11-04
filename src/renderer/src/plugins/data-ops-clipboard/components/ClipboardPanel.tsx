import { useEffect, useMemo, useRef, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { z } from 'zod'
import { Archive, Clipboard, ClipboardPaste, ClipboardPen, FileImage, FileText, Image as ImageIcon, Link2, Pencil, Plus, RefreshCw, Search, Star, Trash2, Type, Upload, X } from 'lucide-react'
import { call, callValidated, errorText, getService, useLayoutShallow, useUiKit, type ContextMenuService } from '../../../workbench/sdk'

const LEGACY_HISTORY_KEY = 'desksuite.clipboard.history'
const POLL_MS = 1500
interface HistoryItem {
  id: string
  kind: 'text' | 'image'
  content?: string
  imageSlot?: number
  category: 'text' | 'link' | 'code' | 'image'
  favorite: boolean
  createdAt: number
  expiresAt: number
  groupId?: string
}
interface ClipboardGroup { id: string; name: string; createdAt: number }
type ClipboardFilter = 'all' | 'favorites' | 'temporary' | 'text' | 'link' | 'code' | 'image' | `group:${string}`
const categoryNames = { text: '文本', link: '链接', code: '代码', image: '图片' } as const
const historyItemSchema = z.object({
  id: z.string().min(1).max(128),
  kind: z.enum(['text', 'image']),
  content: z.string().max(1_000_000).optional(),
  imageSlot: z.number().int().min(0).max(49).optional(),
  category: z.enum(['text', 'link', 'code', 'image']),
  favorite: z.boolean(),
  createdAt: z.number().finite().nonnegative(),
  expiresAt: z.number().finite().nonnegative(),
  groupId: z.string().max(128).optional()
}).strict()
const historySchema = z.array(historyItemSchema).max(50)
const groupsSchema = z.array(z.object({
  id: z.string().min(1).max(128), name: z.string().min(1).max(32), createdAt: z.number().finite().nonnegative()
}).strict()).max(50)
const currentTextSchema = z.string().max(4_000_000)
const imageDataUrlSchema = z.string().max(12 * 1024 * 1024).regex(/^data:image\/png;base64,[A-Za-z0-9+/]+={0,2}$/)
const nullableImageDataUrlSchema = imageDataUrlSchema.nullable()
const historyImageSchema = nullableImageDataUrlSchema
const historyItemOrNullSchema = historyItemSchema.nullable()

function legacyHistory(): string[] {
  try {
    const raw = localStorage.getItem(LEGACY_HISTORY_KEY)
    const parsed: unknown = raw ? JSON.parse(raw) : []
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === 'string') : []
  } catch { return [] }
}

function HistoryCard({ item, active, groupName, onSelect, onFavorite, onRemove }: {
  item: HistoryItem
  active: boolean
  groupName?: string
  onSelect: () => void
  onFavorite: () => void
  onRemove: () => void
}): ReactElement {
  const [image, setImage] = useState<string | null>(null)
  useEffect(() => {
    if (item.kind !== 'image') return
    let alive = true
    void callValidated(historyImageSchema, 'clipboard', 'historyImage', item.id).then((value) => { if (alive) setImage(value) }).catch(() => { if (alive) setImage(null) })
    return () => { alive = false }
  }, [item.id, item.kind])
  const Icon = item.kind === 'image' ? FileImage : item.category === 'link' ? Link2 : FileText
  return (
    <div onClick={onSelect} data-clip-id={item.id} data-clip-favorite={item.favorite ? '1' : '0'} className={`group relative flex w-full min-w-0 cursor-pointer flex-col rounded-lg border p-2.5 text-left transition ${active ? 'border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)]' : 'border-[var(--ds-border)] bg-[var(--ds-surface)] hover:border-[var(--ds-accent)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]'}`}>
      <span className="flex min-w-0 items-center gap-2"><span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)] dark:bg-[var(--ds-surface-muted)]"><Icon className="h-4 w-4"/></span><span data-ds-type="body" className="ds-type-body min-w-0 flex-1 truncate font-medium">{item.kind === 'image' ? '剪贴板图片' : (item.content ?? '').replace(/\s+/g, ' ').slice(0, 96) || '空文本'}</span><span className="flex shrink-0 items-center gap-0.5 opacity-60 group-hover:opacity-100"><span role="button" tabIndex={0} title={item.favorite ? '取消收藏' : '收藏'} onClick={(event) => { event.stopPropagation(); onFavorite() }} onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onFavorite() } }} className={`rounded p-1 ${item.favorite ? 'text-[var(--ds-status-warning)]' : 'text-[var(--ds-text-subtle)] hover:text-[var(--ds-status-warning)]'}`}><Star className="h-3.5 w-3.5" fill={item.favorite ? 'currentColor' : 'none'}/></span><span role="button" tabIndex={0} title="移除记录" onClick={(event) => { event.stopPropagation(); onRemove() }} onKeyDown={(event) => { if (event.key === 'Enter') { event.stopPropagation(); onRemove() } }} className="rounded p-1 text-[var(--ds-text-subtle)] hover:text-[var(--ds-status-danger)]"><X className="h-3.5 w-3.5"/></span></span></span>
      {item.kind === 'image' && image && <img src={image} alt="剪贴板图片预览" className="mt-2 h-24 w-full rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface)] object-contain dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-inset)]"/>}
      <span className="mt-2 flex items-center gap-2"><span data-ds-type="meta" className="ds-type-meta">{new Date(item.createdAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</span><span data-ds-type="meta" className="ds-type-meta">{item.kind === 'image' ? '图片' : `${(item.content ?? '').length} 字 · ${categoryNames[item.category]}`}</span><span data-ds-type="label" className="ds-type-label ml-auto rounded-full border border-[var(--ds-border)] px-1.5 py-0.5">{groupName ?? '未分组'}</span></span>
    </div>
  )
}

export function ClipboardPanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopButton, DesktopIconButton, DesktopInput, DesktopSelect, DesktopTextarea, prompt } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'clipboard'
  const [current, setCurrent] = useState('')
  const [currentImage, setCurrentImage] = useState<string | null>(null)
  const [selectedImage, setSelectedImage] = useState<string | null>(null)
  const [history, setHistory] = useState<HistoryItem[]>([])
  const [groups, setGroups] = useState<ClipboardGroup[]>([])
  const [filter, setFilter] = useState<ClipboardFilter>('all')
  const [query, setQuery] = useState('')
  const [selectedId, setSelectedId] = useState('')
  const [newGroup, setNewGroup] = useState('')
  const [detailDraft, setDetailDraft] = useState('')
  const [newText, setNewText] = useState(false)
  const [busy, setBusy] = useState(false)
  const [feedback, setFeedback] = useState('')
  const feedbackTimer = useRef<number | null>(null)
  const notify = (message: string): void => {
    setFeedback(message)
    if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current)
    feedbackTimer.current = window.setTimeout(() => setFeedback(''), 2200)
  }
  const refreshHistory = async (): Promise<HistoryItem[]> => {
    await call('clipboard', 'capture')
    const next = await callValidated(historySchema, 'clipboard', 'history')
    setHistory(next)
    return next
  }

  useEffect(() => {
    let alive = true
    const migrate = async (): Promise<void> => {
      const old = legacyHistory()
      if (old.length) await call('clipboard', 'importLegacy', old)
      localStorage.removeItem(LEGACY_HISTORY_KEY)
      const [next, nextGroups] = await Promise.all([callValidated(historySchema, 'clipboard', 'history'), callValidated(groupsSchema, 'clipboard', 'groups')])
      if (alive) { setHistory(next); setGroups(nextGroups) }
    }
    void migrate().catch(() => {})
    return () => { alive = false }
  }, [])
  useEffect(() => {
    if (!isOpen) return
    let alive = true
    const poll = async (): Promise<void> => {
      try {
        const [text, image] = await Promise.all([callValidated(currentTextSchema, 'clipboard', 'readText'), callValidated(nullableImageDataUrlSchema, 'clipboard', 'readImage')])
        if (!alive) return
        setCurrent(text); setCurrentImage(image)
        const next = await refreshHistory()
        if (alive && !selectedId && next.length) setSelectedId(next[0].id)
      } catch { /* 保留上次成功读取的内容 */ }
    }
    void poll()
    const timer = window.setInterval(() => void poll(), POLL_MS)
    return () => { alive = false; window.clearInterval(timer) }
  }, [isOpen, selectedId])
  useEffect(() => () => { if (feedbackTimer.current !== null) window.clearTimeout(feedbackTimer.current) }, [])

  const groupName = (id?: string): string | undefined => groups.find((group) => group.id === id)?.name
  const counts = useMemo(() => ({ all: history.length, favorites: history.filter((item) => item.favorite).length, temporary: history.filter((item) => !item.favorite).length, text: history.filter((item) => item.category === 'text').length, link: history.filter((item) => item.category === 'link').length, code: history.filter((item) => item.category === 'code').length, image: history.filter((item) => item.category === 'image').length }), [history])
  const visible = useMemo(() => history.filter((item) => {
    const matchesFilter = filter === 'all' || filter === 'favorites' && item.favorite || filter === 'temporary' && !item.favorite || ['text', 'link', 'code', 'image'].includes(filter) && item.category === filter || filter.startsWith('group:') && item.groupId === filter.slice('group:'.length)
    const text = item.kind === 'image' ? '图片' : item.content ?? ''
    return matchesFilter && (!query.trim() || text.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  }), [history, filter, query])
  const selected = visible.find((item) => item.id === selectedId) ?? (!newText ? visible[0] : undefined)
  useEffect(() => { if (selected?.kind === 'text') setDetailDraft(selected.content ?? '') }, [selected?.id, selected?.content])
  const imageRequest = async (item: HistoryItem): Promise<string | null> => item.kind === 'image' ? callValidated(historyImageSchema, 'clipboard', 'historyImage', item.id) : null
  useEffect(() => {
    let alive = true
    if (!selected) { setSelectedImage(null); return }
    void imageRequest(selected).then((value) => { if (alive) setSelectedImage(value) }).catch(() => { if (alive) setSelectedImage(null) })
    return () => { alive = false }
  }, [selected?.id])

  const createGroup = async (event: FormEvent): Promise<void> => {
    event.preventDefault()
    if (!newGroup.trim()) return
    try { setGroups(await callValidated(groupsSchema, 'clipboard', 'createGroup', newGroup)); setNewGroup('') }
    catch (cause) { notify(errorText(cause, '创建分组失败')) }
  }
  const deleteGroup = async (group: ClipboardGroup): Promise<void> => {
    try {
      setGroups(await callValidated(groupsSchema, 'clipboard', 'deleteGroup', group.id))
      setHistory(await callValidated(historySchema, 'clipboard', 'history'))
      if (filter === `group:${group.id}`) setFilter('all')
    } catch (cause) { notify(errorText(cause, '删除分组失败')) }
  }
  const renameGroup = async (group: ClipboardGroup): Promise<void> => {
    const name = await prompt({ title: '重命名分组', value: group.name, confirmText: '保存' })
    if (name === null || !name.trim()) return
    try { setGroups(await callValidated(groupsSchema, 'clipboard', 'renameGroup', group.id, name)) }
    catch (cause) { notify(errorText(cause, '重命名分组失败')) }
  }
  const createGroupNamed = async (name: string): Promise<void> => {
    try { setGroups(await callValidated(groupsSchema, 'clipboard', 'createGroup', name)) }
    catch (cause) { notify(errorText(cause, '创建分组失败')) }
  }
  const assignGroup = async (groupId: string): Promise<void> => {
    if (!selected) return
    try {
      await call('clipboard', 'assignGroup', selected.id, groupId || null)
      setHistory((items) => items.map((item) => item.id === selected.id ? { ...item, groupId: groupId || undefined } : item))
    } catch (cause) { notify(errorText(cause, '分组更新失败')) }
  }
  const toggleFavorite = async (item: HistoryItem): Promise<void> => {
    await call('clipboard', 'setFavorite', item.id, !item.favorite)
    setHistory((items) => items.map((entry) => entry.id === item.id ? { ...entry, favorite: !entry.favorite } : entry))
  }
  const removeHistory = async (item: HistoryItem): Promise<void> => {
    await call('clipboard', 'removeHistory', item.id)
    const next = history.filter((entry) => entry.id !== item.id)
    setHistory(next)
    if (selectedId === item.id) { setSelectedId(next[0]?.id ?? ''); setNewText(false) }
  }
  const saveContent = async (): Promise<void> => {
    setBusy(true)
    try {
      if (newText) {
        await call('clipboard', 'writeText', detailDraft)
        const next = await refreshHistory()
        setSelectedId(next[0]?.id ?? ''); setNewText(false)
        notify('内容已写入并保存')
      } else if (selected) {
        const updated = await callValidated(historyItemOrNullSchema, 'clipboard', 'updateHistory', selected.id, detailDraft)
        if (updated) { setHistory((items) => [updated, ...items.filter((item) => item.id !== selected.id && item.id !== updated.id)]); setSelectedId(updated.id) }
        notify('内容已保存')
      }
    } catch (cause) { notify(errorText(cause, '保存失败')) }
    finally { setBusy(false) }
  }
  const copySelected = async (): Promise<void> => {
    if (!selected) return
    try { await call('clipboard', 'useHistory', selected.id); notify('已复制到系统剪贴板'); await refreshHistory() }
    catch (cause) { notify(errorText(cause, '复制失败')) }
  }
  const clearTemporary = async (): Promise<void> => {
    await call('clipboard', 'clearHistory')
    setHistory(await callValidated(historySchema, 'clipboard', 'history'))
    if (selected && !selected.favorite) { setSelectedId(''); setNewText(false) }
  }
  const startNewText = (): void => { setSelectedId(''); setNewText(true); setDetailDraft('') }

  useEffect(() => {
    const contextMenu = getService<ContextMenuService>('contextMenu')
    if (!contextMenu) return
    return contextMenu.register('clipboard.panel', (context) => {
      const itemEl = context.target.closest('[data-clip-id]')
      if (itemEl) {
        const id = itemEl.getAttribute('data-clip-id') ?? ''
        const item = history.find((entry) => entry.id === id)
        if (!item) return null
        return [
          { id: 'clip-use', label: '写回剪贴板', onSelect: () => { void call('clipboard', 'useHistory', item.id).then(() => refreshHistory()).catch((cause) => notify(errorText(cause, '写回失败'))) } },
          { id: 'clip-copy', label: '复制文本', disabled: item.kind !== 'text' ? '图片记录没有文本内容' : !item.content, onSelect: () => { if (item.content) void call('clipboard', 'writeText', item.content).catch(() => {}) } },
          { id: 'clip-edit', label: '编辑草稿', onSelect: () => { setSelectedId(item.id); setNewText(false) } },
          { id: 'clip-favorite', label: '收藏', checked: item.favorite, onSelect: () => { void toggleFavorite(item) } },
          { id: 'clip-remove', label: '删除此条', danger: true, onSelect: () => { void removeHistory(item) } }
        ]
      }
      const groupEl = context.target.closest('[data-clip-group]')
      if (groupEl) {
        const id = groupEl.getAttribute('data-clip-group') ?? ''
        const group = groups.find((entry) => entry.id === id)
        if (!group) return null
        return [
          { id: 'clip-group-rename', label: '重命名…', onSelect: () => { void renameGroup(group) } },
          {
            id: 'clip-group-delete',
            label: '删除分组',
            danger: true,
            onSelect: () => {
              if (!window.confirm(`删除分组「${group.name}」？分组内的记录会回到未分组。`)) return
              void deleteGroup(group)
            }
          }
        ]
      }
      return [
        {
          id: 'clip-group-new',
          label: '新建分组…',
          onSelect: () => {
            void prompt({ title: '新建剪贴板分组', placeholder: '分组名称', confirmText: '创建' })
              .then((name) => { if (name?.trim()) return createGroupNamed(name.trim()) })
              .catch(() => {})
          }
        },
        { id: 'clip-clear', label: `清空临时记录（${counts.temporary}）`, disabled: !counts.temporary ? '没有临时记录' : false, danger: true, onSelect: () => { void clearTemporary() } }
      ]
    }, { order: 10 })
  }, [history, groups, counts.temporary, prompt])

  const navItems: Array<[ClipboardFilter, string, number, ReactElement]> = [
    ['all', '全部历史', counts.all, <Clipboard className="h-4 w-4"/>], ['favorites', '收藏', counts.favorites, <Star className="h-4 w-4"/>], ['temporary', '临时', counts.temporary, <Archive className="h-4 w-4"/>]
  ]
  const typeItems: Array<[ClipboardFilter, string, number, ReactElement]> = ([['text', '文本', counts.text, <Type className="h-4 w-4"/>], ['link', '链接', counts.link, <Link2 className="h-4 w-4"/>], ['code', '代码', counts.code, <FileText className="h-4 w-4"/>], ['image', '图片', counts.image, <ImageIcon className="h-4 w-4"/>]])

  return (
    <ThemeFloatingPanel title="剪贴板工作台" icon={<ClipboardPen className="w-3.5 h-3.5"/>} badge={`${history.length} 条`} isOpen={isOpen} onClose={closeFloatingPanel} initialX={48} initialY={50} initialWidth={1260} initialHeight={760} minWidth={920} minHeight={520} headerActions={<DesktopIconButton size="xs" icon={<RefreshCw className="h-3.5 w-3.5"/>} tooltip="立即读取系统剪贴板" onClick={() => { void refreshHistory().then(notify.bind(null, '已刷新剪贴板历史')) }}/>}>
      <div data-context-zone="clipboard.panel" className="grid h-full min-h-0 grid-cols-[166px_minmax(0,1fr)_280px] overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-inset)]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-2 px-2 py-2"><div className="flex items-center gap-2 text-xs font-semibold text-[var(--ds-text-muted)] dark:text-[var(--ds-text-primary)]"><Clipboard className="h-4 w-4 text-[var(--ds-accent)]"/>剪贴板</div></div>
          <DesktopInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索内容" icon={<Search className="h-3.5 w-3.5"/>}/>
          <div className="mt-3 space-y-0.5">{navItems.map(([key, label, count, icon]) => <DesktopButton key={key} type="button" size="sm" variant="ghost" active={filter === key} onClick={() => setFilter(key)} className="w-full justify-start"><span className="flex w-full items-center gap-2 text-left">{icon}<span className="flex-1">{label}</span><span className="text-xs text-[var(--ds-text-muted)]">{count}</span></span></DesktopButton>)}</div>
          <div className="mt-3 border-t border-[var(--ds-border)] pt-2"><div className="px-2 pb-1 text-xs font-medium text-[var(--ds-text-muted)]">内容类型 · 自动识别</div>{typeItems.map(([key, label, count, icon]) => <DesktopButton key={key} type="button" size="sm" variant="ghost" active={filter === key} onClick={() => setFilter(key)} className="w-full justify-start"><span className="flex w-full items-center gap-2 text-left">{icon}<span className="flex-1">{label}</span><span className="text-xs text-[var(--ds-text-muted)]">{count}</span></span></DesktopButton>)}</div>
          <div className="mt-3 flex items-center border-t border-[var(--ds-border)] px-2 pb-1 pt-3 text-xs font-semibold text-[var(--ds-text-muted)] dark:border-[var(--ds-border)]">我的分组 <span className="ml-auto text-xs font-normal text-[var(--ds-text-subtle)]">{groups.length}</span></div>
          <div className="min-h-0 flex-1 space-y-0.5 overflow-y-auto">{groups.map((group) => <div key={group.id} data-clip-group={group.id} data-clip-group-name={group.name} className="group flex items-center"><DesktopButton type="button" size="sm" variant="ghost" active={filter === `group:${group.id}`} onClick={() => setFilter(`group:${group.id}`)} className="min-w-0 flex-1 justify-start"><span className="flex w-full items-center gap-2 text-left"><Archive className="h-4 w-4 shrink-0"/><span className="truncate">{group.name}</span><span className="ml-auto text-xs text-[var(--ds-text-muted)]">{history.filter((item) => item.groupId === group.id).length}</span></span></DesktopButton><DesktopIconButton size="xs" icon={<Pencil className="h-3 w-3"/>} tooltip="重命名分组" onClick={() => void renameGroup(group)} className="hidden group-hover:inline-flex"/><DesktopIconButton size="xs" icon={<Trash2 className="h-3 w-3"/>} tooltip="删除分组" onClick={() => void deleteGroup(group)} className="hidden group-hover:inline-flex text-[var(--ds-status-danger)]"/></div>)}</div>
          <form onSubmit={(event) => void createGroup(event)} className="mt-2 flex gap-1 border-t border-[var(--ds-border)] pt-2"><DesktopInput value={newGroup} onChange={(event) => setNewGroup(event.target.value)} maxLength={32} placeholder="创建分组" className="min-w-0 flex-1"/><DesktopIconButton type="submit" size="xs" icon={<Plus className="h-3.5 w-3.5"/>} tooltip="创建分组" disabled={!newGroup.trim()} active/></form>
          <div className="mt-2 border-t border-[var(--ds-border)] px-2 pt-2 text-xs text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)]">{currentImage ? '正在捕获图片剪贴板' : current ? `剪贴板 · ${current.length} 字符` : '自动捕获文本与图片'}<div className="mt-1">Ctrl+Shift+V 唤醒工作台</div></div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-inset)]">
          <div className="flex h-12 shrink-0 items-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><div className="text-xs font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">{filter.startsWith('group:') ? groupName(filter.slice(6)) ?? '分组' : ({ all: '全部历史', favorites: '收藏', temporary: '临时', text: '文本', link: '链接', code: '代码', image: '图片' } as Record<string, string>)[filter]} <span className="ml-1 font-normal text-[var(--ds-text-subtle)]">({visible.length})</span></div><DesktopButton size="xs" variant="subtle" icon={<Plus className="h-3.5 w-3.5"/>} onClick={startNewText}>新建文本</DesktopButton><DesktopButton size="xs" variant="ghost" disabled={!counts.temporary} onClick={() => void clearTemporary()}>清空临时项</DesktopButton></div>
          <div className="min-h-0 flex-1 overflow-y-auto p-3">{visible.length ? <div className="space-y-1.5">{visible.map((item, index) => <div key={item.id}>{(index === 0 || new Date(item.createdAt).toDateString() !== new Date(visible[index - 1].createdAt).toDateString()) && <div className="mb-1.5 mt-1 px-1 text-xs text-[var(--ds-text-subtle)]">{new Date(item.createdAt).toLocaleDateString()}</div>}<HistoryCard item={item} active={selected?.id === item.id && !newText} groupName={groupName(item.groupId)} onSelect={() => { setSelectedId(item.id); setNewText(false) }} onFavorite={() => void toggleFavorite(item)} onRemove={() => void removeHistory(item)}/></div>)}</div> : <div className="flex h-full flex-col items-center justify-center gap-2 text-center"><Clipboard className="h-8 w-8 text-[var(--ds-text-subtle)]"/><div className="text-xs font-medium text-[var(--ds-text-muted)]">{query ? '没有匹配的历史记录' : '这里还没有剪贴板记录'}</div><div className="max-w-56 text-xs text-[var(--ds-text-subtle)]">复制文本或图片后会自动保存，也可以新建一条文本记录。</div><DesktopButton size="xs" variant="subtle" icon={<Plus className="h-3.5 w-3.5"/>} onClick={startNewText}>新建文本</DesktopButton></div>}</div>
          <div className="flex h-7 shrink-0 items-center border-t border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 text-xs text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">内容类型自动识别 · 临时记录保留 7 天</div>
        </main>
        <aside className="flex min-h-0 flex-col border-l border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[var(--ds-text-muted)] dark:text-[var(--ds-text-primary)]"><span>{newText ? '新建文本' : '编辑内容'}</span><DesktopIconButton size="xs" icon={<Trash2 className="h-3.5 w-3.5"/>} tooltip="移除历史记录" disabled={!selected || newText} onClick={() => selected && void removeHistory(selected)}/></div>
          {selected || newText ? <><div className="relative flex-1"><DesktopTextarea value={detailDraft} onChange={(event) => setDetailDraft(event.target.value)} disabled={!newText && selected?.kind === 'image'} placeholder={selected?.kind === 'image' ? '图片内容无法作为文本编辑' : '输入剪贴板文本…'} className="h-full min-h-24 w-full resize-none"/>{selected?.kind === 'image' && selectedImage && <div className="absolute inset-x-2 bottom-2 top-2 flex items-center justify-center rounded bg-[var(--ds-surface)]/90"><img src={selectedImage} alt="剪贴板图片" className="max-h-full max-w-full object-contain"/></div>}</div>
            <div className="mt-2 flex justify-between text-xs text-[var(--ds-text-subtle)]"><span>{detailDraft.length} 字符</span><span>{newText ? '新建内容' : selected?.kind === 'image' ? '图片内容' : '内容已载入'}</span></div>
            {!newText && selected && <div className="mt-3 space-y-2 border-t border-[var(--ds-border)] pt-3 dark:border-[var(--ds-border)]"><label className="block text-xs text-[var(--ds-text-subtle)]">分组<DesktopSelect value={selected.groupId ?? ''} onChange={(value) => void assignGroup(value)} className="mt-1 w-full" options={[{ value: '', label: '未分组' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} /></label>
              <DesktopButton type="button" size="sm" variant="subtle" active={selected.favorite} onClick={() => void toggleFavorite(selected)} className="w-full justify-between"><span>收藏</span><span className="flex items-center gap-1">{selected.favorite ? '已收藏' : '收藏到本地'}<Star className={`h-3.5 w-3.5 ${selected.favorite ? 'fill-[var(--ds-status-warning)] text-[var(--ds-status-warning)]' : ''}`}/></span></DesktopButton>
              <div className="grid grid-cols-2 gap-y-1 text-xs"><span className="text-[var(--ds-text-subtle)]">内容类型</span><span className="text-right text-[var(--ds-text-muted)]">{categoryNames[selected.category]}</span><span className="text-[var(--ds-text-subtle)]">首次收录</span><span className="text-right text-[var(--ds-text-muted)]">{new Date(selected.createdAt).toLocaleString()}</span></div>
            </div>}
            <div className="mt-3 space-y-1.5"><DesktopButton size="xs" variant="primary" icon={<Upload className="h-3.5 w-3.5"/>} disabled={busy || newText && !detailDraft.trim() || !newText && selected?.kind === 'image'} onClick={() => void saveContent()}>{busy ? '保存中…' : newText ? '保存并写入剪贴板' : '保存内容'}</DesktopButton>{selected && !newText && <DesktopButton size="xs" variant="ghost" icon={<ClipboardPaste className="h-3.5 w-3.5"/>} onClick={() => void copySelected()}>复制到剪贴板</DesktopButton>}{feedback && <div className="text-center text-xs text-[var(--ds-status-success)]">{feedback}</div>}</div>
          </> : <div className="flex flex-1 items-center justify-center text-center text-xs text-[var(--ds-text-subtle)]">选择一条历史记录<br/>查看、编辑或归类</div>}
        </aside>
      </div>
    </ThemeFloatingPanel>
  )
}
