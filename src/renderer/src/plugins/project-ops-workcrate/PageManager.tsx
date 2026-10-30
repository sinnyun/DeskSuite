import { useEffect, useRef, useState } from 'react'
import type { MouseEvent, ReactElement } from 'react'
import { ArrowLeft, ExternalLink, FolderOpen, Image, Plus, RefreshCw } from 'lucide-react'
import { call, useUiKit } from '../../workbench/sdk'

interface Board { id: string; projectId: string; index: number; title: string; info: { materialCategory: string; material: string; size: string; quantity: string } }
export interface PageExport { format: 'png' | 'jpg' | 'pdf'; scale: number; boardIds?: string[] }

export function PageManager({ projectId, projectName, hasDocument, boards, busy, onBack, onOpen, onSync, onCreate, onQuickCreate, onFolder, onEditor, onExport }: {
  projectId: string; projectName: string; hasDocument: boolean; boards: Board[]; busy: boolean
  onBack: () => void; onOpen: (board: Board) => void; onSync: () => void; onCreate: () => void; onQuickCreate: () => void; onFolder: () => void; onEditor: () => void; onExport: (options: PageExport) => void
}): ReactElement {
  const { DesktopButton, DesktopSelect } = useUiKit()
  const [mode, setMode] = useState<'single' | 'multiple'>('single')
  const [selected, setSelected] = useState<string[]>([])
  const [format, setFormat] = useState<'png' | 'jpg'>('png')
  const [scale, setScale] = useState(1)
  const anchor = useRef<string | null>(null)
  useEffect(() => { setSelected([]); anchor.current = null }, [projectId])
  useEffect(() => { setSelected((current) => current.filter((id) => boards.some((board) => board.id === id))) }, [boards])
  useEffect(() => window.bridge.onEvent((channel, payload) => {
    if (channel !== 'workcrate:pages-selection') return
    const event = payload as { projectId: string; mode: string; boardIds: string[] }
    if (event.projectId !== projectId) return
    setMode(event.mode === 'single' ? 'single' : 'multiple'); setSelected(event.boardIds); anchor.current = event.boardIds.at(-1) ?? null
  }), [projectId])
  const choose = (id: string, event?: MouseEvent): void => {
    if (busy) return
    const multiple = mode === 'multiple' || Boolean(event?.ctrlKey || event?.metaKey || event?.shiftKey)
    if (multiple) setMode('multiple')
    if (event?.shiftKey && anchor.current) {
      const from = boards.findIndex((board) => board.id === anchor.current)
      const to = boards.findIndex((board) => board.id === id)
      if (from >= 0 && to >= 0) setSelected((current) => [...new Set([...current, ...boards.slice(Math.min(from, to), Math.max(from, to) + 1).map((board) => board.id)])])
    } else setSelected((current) => multiple ? current.includes(id) ? current.filter((item) => item !== id) : [...current, id] : current.length === 1 && current[0] === id ? [] : [id])
    anchor.current = id
  }
  const selectedIds = boards.filter((board) => selected.includes(board.id)).map((board) => board.id)
  return <section data-page-manager className="flex min-h-0 flex-1 flex-col p-4">
    <header className="mb-3 flex shrink-0 flex-wrap items-center gap-3"><DesktopButton variant="ghost" icon={<ArrowLeft className="h-4 w-4"/>} onClick={onBack}>返回</DesktopButton><div className="min-w-0 flex-1"><h2 data-ds-type="title" className="ds-type-title truncate">{projectName}</h2><p data-ds-type="meta" className="ds-type-meta">共 {boards.length} 页 · 已选 {selectedIds.length} 页</p></div><DesktopButton variant="ghost" icon={<FolderOpen className="h-4 w-4"/>} disabled={!hasDocument || busy} onClick={onFolder}>工程文件夹</DesktopButton><DesktopButton variant="ghost" icon={<RefreshCw className="h-4 w-4"/>} disabled={!hasDocument || busy} onClick={onSync}>同步</DesktopButton><DesktopButton disabled={!hasDocument || busy} onClick={onQuickCreate}>快速创建</DesktopButton><DesktopButton variant="primary" icon={<Plus className="h-4 w-4"/>} disabled={!hasDocument || busy} onClick={onCreate}>新增画板</DesktopButton></header>
    <div className="mb-3 flex shrink-0 flex-wrap items-center gap-2 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
      <DesktopButton size="xs" variant={mode === 'single' ? 'primary' : 'ghost'} disabled={busy} onClick={() => { setMode('single'); setSelected((current) => current.slice(-1)) }}>单选</DesktopButton><DesktopButton size="xs" variant={mode === 'multiple' ? 'primary' : 'ghost'} disabled={busy} onClick={() => setMode('multiple')}>多选</DesktopButton><DesktopButton size="xs" disabled={busy || !boards.length} onClick={() => { setMode('multiple'); setSelected(boards.map((board) => board.id)) }}>全选</DesktopButton><DesktopButton size="xs" disabled={busy || !selectedIds.length} onClick={() => { setSelected([]); anchor.current = null }}>取消选择</DesktopButton>
      <span className="ml-auto text-xs text-[var(--ds-text-muted)]">图片格式</span><fieldset disabled={busy} className="flex gap-2 border-0 p-0"><DesktopSelect title="导出图片格式" value={format} options={[{ value: 'png', label: 'PNG' }, { value: 'jpg', label: 'JPG' }]} onChange={(value) => setFormat(value as 'png' | 'jpg')}/><DesktopSelect title="导出图片倍率" value={String(scale)} options={[{ value: '1', label: '1×' }, { value: '2', label: '2×' }, { value: '4', label: '4×' }]} onChange={(value) => setScale(Number(value))}/></fieldset>
      <DesktopButton size="xs" disabled={busy || !selectedIds.length} onClick={() => onExport({ format, scale, boardIds: selectedIds })}>导出选中图片</DesktopButton><DesktopButton size="xs" disabled={busy || !boards.length} onClick={() => onExport({ format, scale })}>全部导出图片</DesktopButton><DesktopButton size="xs" disabled={busy || !boards.length} onClick={() => onExport({ format: 'pdf', scale: 1 })}>全部导出 PDF</DesktopButton>
    </div>
    <div className="min-h-0 flex-1 overflow-y-auto"><div className="grid grid-cols-1 gap-3 xl:grid-cols-2">{boards.map((board) => <SelectablePage key={board.id} board={board} selected={selectedIds.includes(board.id)} busy={busy} onChoose={(event) => choose(board.id, event)} onOpen={() => onOpen(board)}/>)}</div>{!boards.length && <div className="flex h-48 items-center justify-center text-sm text-[var(--ds-text-subtle)]">没有缓存画板，请同步工程。</div>}</div>
    <footer className="mt-3 flex shrink-0 flex-wrap items-center gap-3 border-t border-[var(--ds-border)] pt-3 text-xs text-[var(--ds-text-muted)]"><span className="flex-1">点击卡片选择 · Ctrl 多选 · Shift 连选 · 导出使用 VectorCraft 原生画板</span><DesktopButton icon={<ExternalLink className="h-4 w-4"/>} disabled={busy || !hasDocument} onClick={onEditor}>在 VectorCraft 中打开编辑</DesktopButton></footer>
  </section>
}

function SelectablePage({ board, selected, busy, onChoose, onOpen }: { board: Board; selected: boolean; busy: boolean; onChoose: (event: MouseEvent) => void; onOpen: () => void }): ReactElement {
  const { DesktopButton, DesktopCardButton } = useUiKit()
  const [preview, setPreview] = useState('')
  useEffect(() => { let alive = true; void call<string>('workcrateBoards', 'preview', board.projectId, board.id).then((value) => { if (alive) setPreview(value) }).catch(() => { if (alive) setPreview('') }); return () => { alive = false } }, [board])
  return <article data-page-id={board.id} data-selected={selected} className={`rounded-lg border p-3 ${selected ? 'border-[var(--ds-accent)] bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)]' : 'border-[var(--ds-border)] bg-[var(--ds-surface)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]'}`}>
    <div className="flex items-center gap-2"><input type="checkbox" aria-label={`选择第 ${board.index + 1} 页`} checked={selected} disabled={busy} onChange={() => undefined} onClick={onChoose} className="h-4 w-4 accent-[var(--ds-accent)]"/><span className="text-xs text-[var(--ds-text-muted)]">{String(board.index + 1).padStart(2, '0')}</span><DesktopButton type="button" size="sm" variant="ghost" disabled={busy} onClick={onChoose} className="min-w-0 flex-1 justify-start truncate text-left font-semibold">{board.title}</DesktopButton><DesktopButton size="xs" disabled={busy} onClick={onOpen}>编辑页面</DesktopButton></div>
    <DesktopCardButton type="button" selected={selected} aria-label={`选择页面：${board.title}`} aria-pressed={selected} disabled={busy} onClick={onChoose} className="mt-3 flex h-[260px] w-full items-center justify-center overflow-hidden p-2">{preview ? <img src={preview} alt={`${board.title} 预览`} draggable={false} className="h-full w-full object-contain"/> : <Image className="h-6 w-6 text-[var(--ds-text-subtle)]"/>}</DesktopCardButton>
    <div className="mt-2 truncate text-xs text-[var(--ds-text-muted)]">{[board.info.materialCategory, board.info.material, board.info.size, board.info.quantity].filter(Boolean).join(' · ') || '暂无物料信息'}</div>
  </article>
}
