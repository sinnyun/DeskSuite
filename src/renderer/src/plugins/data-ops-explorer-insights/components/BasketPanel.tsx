import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { Archive, File, Folder, Image, MapPin, Music2, Package, Trash2, Video, X } from 'lucide-react'
import { call, errorText, getService, log, useLayoutShallow, useUiKit, type ContextMenuEntry, type ContextMenuService } from '../../../workbench/sdk'
import { basketStore, useBasket } from '../basket'
import { KIND_LABEL, formatBytes } from '../format'

type BasketFilter = 'all' | 'folder' | 'image' | 'document' | 'archive' | 'video' | 'audio' | 'other'
const filterNames: Record<BasketFilter, string> = { all: '全部文件', folder: '文件夹', image: '图片', document: '文档', archive: '压缩包', video: '视频', audio: '音频', other: '其他文件' }
const extensions: Record<Exclude<BasketFilter, 'all' | 'folder' | 'other'>, string[]> = {
  image: ['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg', 'tif', 'tiff'],
  document: ['txt', 'md', 'pdf', 'doc', 'docx', 'xls', 'xlsx', 'ppt', 'pptx', 'rtf', 'csv'],
  archive: ['zip', '7z', 'rar', 'tar', 'gz', 'bz2'],
  video: ['mp4', 'mkv', 'mov', 'avi', 'webm'],
  audio: ['mp3', 'wav', 'flac', 'aac', 'ogg', 'm4a']
}
function category(item: { name: string; isDirectory: boolean }): BasketFilter {
  if (item.isDirectory) return 'folder'
  const ext = item.name.split('.').pop()?.toLowerCase() ?? ''
  return (Object.keys(extensions) as Array<keyof typeof extensions>).find((key) => extensions[key].includes(ext)) ?? 'other'
}
function categoryIcon(kind: BasketFilter): ReactElement {
  if (kind === 'folder') return <Folder className="h-5 w-5" />
  if (kind === 'image') return <Image className="h-5 w-5" />
  if (kind === 'archive') return <Package className="h-5 w-5" />
  if (kind === 'video') return <Video className="h-5 w-5" />
  if (kind === 'audio') return <Music2 className="h-5 w-5" />
  return <File className="h-5 w-5" />
}

export function BasketPanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopButton, DesktopIconButton, DesktopCardButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const items = useBasket()
  const [filter, setFilter] = useState<BasketFilter>('all')
  const [selectedPath, setSelectedPath] = useState('')
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'basket'
  const counts = useMemo(() => items.reduce<Record<BasketFilter, number>>((result, item) => { result[category(item)] += 1; return result }, { all: items.length, folder: 0, image: 0, document: 0, archive: 0, video: 0, audio: 0, other: 0 }), [items])
  const visible = useMemo(() => items.filter((item) => filter === 'all' || category(item) === filter), [items, filter])
  const selected = visible.find((item) => item.path === selectedPath) ?? visible[0]
  const totalSize = items.reduce((sum, item) => sum + (item.isDirectory ? 0 : item.size), 0)

  const copyPaths = async (): Promise<void> => {
    if (!items.length) return
    try { await call('clipboard', 'writeText', items.map((item) => item.path).join('\n')); log('event', 'Insights', `已复制 ${items.length} 条暂存路径`) }
    catch (error) { log('error', 'Insights', '复制暂存路径失败', errorText(error, '复制暂存路径失败')) }
  }

  useEffect(() => {
    const contextMenu = getService<ContextMenuService>('contextMenu')
    if (!contextMenu) return
    return contextMenu.register('insights.basket', (context) => {
      const hit = context.target.closest('[data-basket-path]')?.getAttribute('data-basket-path') ?? null
      if (hit) {
        return [
          { id: 'basket-reveal', label: '定位文件', onSelect: () => { void call('filesystem', 'reveal', hit).catch(() => {}) } },
          { id: 'basket-open', label: '打开', onSelect: () => { void call('filesystem', 'open', hit).catch((error) => log('error', 'Insights', '打开失败', errorText(error))) } },
          { id: 'basket-copy', label: '复制路径', onSelect: () => { void call('clipboard', 'writeText', hit).catch(() => {}) } },
          { id: 'basket-remove', label: '移出暂存', danger: true, onSelect: () => { basketStore.remove(hit); log('event', 'Insights', '已移出暂存') } }
        ]
      }
      const entries: ContextMenuEntry[] = [
        { id: 'basket-copy-all', label: `复制全部路径（${items.length}）`, disabled: !items.length, onSelect: () => { void copyPaths() } }
      ]
      if (items.length > 0) {
        entries.push({
          id: 'basket-clear',
          label: '清空暂存篮',
          danger: true,
          onSelect: () => {
            if (!window.confirm(`清空暂存篮中的 ${items.length} 项？文件本身不受影响。`)) return
            basketStore.clear()
            setSelectedPath('')
            log('event', 'Insights', '已清空暂存篮')
          }
        })
      }
      return entries
    }, { order: 10 })
  }, [items.length])

  return (
    <ThemeFloatingPanel title="文件暂存篮" icon={<Archive className="w-3.5 h-3.5" />} badge={`${items.length} 项`} isOpen={isOpen} onClose={closeFloatingPanel} initialX={64} initialY={56} initialWidth={1180} initialHeight={720} minWidth={900} minHeight={500}
      headerActions={<><DesktopButton size="xs" variant="ghost" onClick={() => void copyPaths()} disabled={!items.length}>复制全部路径</DesktopButton><DesktopIconButton size="xs" icon={<Trash2 className="w-3.5 h-3.5" />} tooltip="清空暂存篮" disabled={!items.length} onClick={() => { basketStore.clear(); setSelectedPath(''); log('event', 'Insights', '已清空暂存篮') }} /></>}>
      <div data-context-zone="insights.basket" className="grid h-full min-h-0 grid-cols-[156px_minmax(0,1fr)_250px] overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-inset)]">
        <aside className="flex min-h-0 flex-col border-r border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-2 px-2 py-2"><div className="text-xs font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">文件暂存</div><div className="mt-1 text-xs text-[var(--ds-text-subtle)]">临时收集，集中处理</div></div>
          <div className="flex-1 space-y-0.5 overflow-y-auto">{(Object.keys(filterNames) as BasketFilter[]).map((key) => <DesktopButton key={key} size="xs" variant="ghost" active={filter === key} onClick={() => setFilter(key)} className="w-full justify-start gap-2 px-2.5 text-left"><span className="text-[var(--ds-text-muted)]">{categoryIcon(key)}</span><span className="flex-1">{filterNames[key]}</span><span className="text-xs text-[var(--ds-text-subtle)]">{counts[key]}</span></DesktopButton>)}</div>
          <div className="border-t border-[var(--ds-border)] px-2 pt-2 text-xs leading-relaxed text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)]">从文件浏览器选择条目并点击「暂存」，即可在这里集中整理。</div>
        </aside>
        <main className="flex min-h-0 min-w-0 flex-col bg-[var(--ds-surface-inset)]">
          <div className="flex h-12 shrink-0 items-center gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><div className="text-xs font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">{filterNames[filter]} <span className="ml-1 font-normal text-[var(--ds-text-subtle)]">({visible.length})</span></div><span className="ml-auto text-xs text-[var(--ds-text-subtle)]">选择卡片查看文件信息</span></div>
          {visible.length ? <div className="min-h-0 flex-1 overflow-y-auto p-3"><div className="grid grid-cols-2 gap-2 xl:grid-cols-3">{visible.map((item) => { const kind = category(item); const active = selected?.path === item.path; return <div key={item.path} data-basket-path={item.path} className="group relative min-h-[132px] min-w-0">
            <DesktopCardButton selected={active} onClick={() => setSelectedPath(item.path)} className="flex h-full w-full flex-col p-2.5">
              <span className="mb-2 flex w-full items-start justify-between pr-7"><span className={`flex h-9 w-9 items-center justify-center rounded-[var(--ds-radius-control)] ${kind === 'folder' ? 'bg-[var(--ds-status-warning-soft)] text-[var(--ds-status-warning)]' : kind === 'image' ? 'bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : kind === 'audio' ? 'bg-[var(--ds-status-info-soft)] text-[var(--ds-status-info)]' : 'bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)]'}`}>{categoryIcon(kind)}</span></span>
              <span className="w-full truncate text-xs font-semibold text-[var(--ds-text-primary)]" title={item.name}>{item.name}</span><span className="mt-1 w-full truncate text-xs text-[var(--ds-text-subtle)]" title={item.path}>{item.path}</span><span className="mt-auto w-full pt-2 text-xs text-[var(--ds-text-muted)]">{item.isDirectory ? '文件夹' : formatBytes(item.size)}</span>
            </DesktopCardButton>
            <span className="absolute right-1.5 top-1.5 z-10 opacity-60 transition-opacity group-hover:opacity-100 focus-within:opacity-100"><DesktopIconButton size="xs" icon={<X className="h-3 w-3" />} tooltip="移出暂存" onClick={() => basketStore.remove(item.path)} /></span>
          </div> })}</div></div> : <div className="flex flex-1 flex-col items-center justify-center gap-2 text-center"><Archive className="h-8 w-8 text-[var(--ds-text-subtle)]"/><span className="text-xs font-medium text-[var(--ds-text-muted)]">{filter === 'all' ? '暂存篮为空' : `没有${filterNames[filter]}`}</span><span className="max-w-64 text-xs text-[var(--ds-text-subtle)]">在文件浏览器中选择文件，然后点击工具栏「暂存」。</span></div>}
          <div className="flex h-8 shrink-0 items-center justify-between border-t border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 text-xs text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><span>共 {items.length} 项</span><span>文件合计 {formatBytes(totalSize)}</span></div>
        </main>
        <aside className="flex min-h-0 flex-col border-l border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
          <div className="mb-3 flex items-center justify-between text-xs font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]"><span>文件信息</span><DesktopIconButton size="xs" icon={<Trash2 className="h-3.5 w-3.5" />} tooltip="移出暂存" disabled={!selected} onClick={() => selected && basketStore.remove(selected.path)} /></div>
          {selected ? <><div className="flex h-28 items-center justify-center rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] text-[var(--ds-accent)]">{categoryIcon(category(selected))}</div><div className="mt-3 truncate text-xs font-semibold text-[var(--ds-text-primary)]" title={selected.name}>{selected.name}</div><div className="mt-1 break-all text-xs leading-relaxed text-[var(--ds-text-subtle)]" title={selected.path}>{selected.path}</div><dl className="mt-3 space-y-2 border-t border-[var(--ds-border)] pt-3 text-xs"><div className="flex justify-between gap-2"><dt className="text-[var(--ds-text-subtle)]">类型</dt><dd className="text-right text-[var(--ds-text-muted)] dark:text-[var(--ds-text-secondary)]">{selected.isDirectory ? '文件夹' : KIND_LABEL[selected.kind] ?? category(selected)}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--ds-text-subtle)]">大小</dt><dd className="text-right text-[var(--ds-text-muted)] dark:text-[var(--ds-text-secondary)]">{selected.isDirectory ? '—' : formatBytes(selected.size)}</dd></div><div className="flex justify-between gap-2"><dt className="text-[var(--ds-text-subtle)]">添加时间</dt><dd className="text-right text-[var(--ds-text-muted)] dark:text-[var(--ds-text-secondary)]">{new Date(selected.addedAt).toLocaleString()}</dd></div></dl><div className="mt-auto space-y-1.5 pt-3"><DesktopButton size="xs" variant="subtle" icon={<MapPin className="h-3.5 w-3.5" />} onClick={() => void call('filesystem', 'reveal', selected.path).catch(() => {})}>定位文件</DesktopButton><DesktopButton size="xs" variant="ghost" icon={<Trash2 className="h-3.5 w-3.5" />} onClick={() => basketStore.remove(selected.path)}>移出暂存</DesktopButton></div></> : <div className="flex flex-1 items-center justify-center text-center text-xs text-[var(--ds-text-subtle)]">选择一张文件卡片<br/>查看完整信息</div>}
        </aside>
      </div>
    </ThemeFloatingPanel>
  )
}
