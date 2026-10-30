import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { ArrowLeft, ArrowRight, ExternalLink, FolderOpen, Grid2X2, Image, LayoutGrid, Plus, RefreshCw, X } from 'lucide-react'
import { call, useLayout, useUiKit } from '../../workbench/sdk'
import { PageManager, type PageExport } from './PageManager'
import { QuickCreate, type QuickTable } from './QuickCreate'
import { BasicInformation, PresetInput, materialFields, type FieldPresets } from './BasicInformation'

interface WorkCrateProject { id: string; name: string; createdAt: number; archived: boolean; mainImage: Preview | null }
interface Preview { path: string; sha256: string; width: number; height: number }
interface BoardInfo { materialCategory: string; material: string; size: string; sizeLabel: string; quantity: string; extra: Record<string, string> }
interface WorkCrateBoard { id: string; projectId: string; index: number; title: string; widthPt: number; heightPt: number; info: BoardInfo }
interface ProjectSnapshot { project: WorkCrateProject; documentPath: string | null }
interface VectorCraftConfig { cliExecutable: string; guiExecutable: string; defaultImageFormat: 'png' | 'jpg'; port: number }

export function WorkCratePanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopButton, DesktopIconButton, DesktopCardButton, DesktopInput } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayout()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'workcrate'
  const [projects, setProjects] = useState<WorkCrateProject[]>([])
  const [snapshot, setSnapshot] = useState<ProjectSnapshot | null>(null)
  const [boards, setBoards] = useState<WorkCrateBoard[]>([])
  const [activeBoard, setActiveBoard] = useState<WorkCrateBoard | null>(null)
  const [preview, setPreview] = useState('')
  const [projectPreviews, setProjectPreviews] = useState<Record<string, string>>({})
  const [projectCounts, setProjectCounts] = useState<Record<string, number>>({})
  const [projectPaths, setProjectPaths] = useState<Record<string, string | null>>({})
  const [name, setName] = useState('')
  const [query, setQuery] = useState('')
  const [view, setView] = useState<'projects' | 'pages' | 'page' | 'settings' | 'quick'>('projects')
  const [quickTable, setQuickTable] = useState<QuickTable | null>(null)
  const [settingsTab, setSettingsTab] = useState<'connection' | 'basic'>('connection')
  const [programPresets, setProgramPresets] = useState<FieldPresets>({ fields: [] })
  const [presets, setPresets] = useState<FieldPresets>({ fields: [] })
  const [config, setConfig] = useState<VectorCraftConfig>({ cliExecutable: '', guiExecutable: '', defaultImageFormat: 'png', port: 17979 })
  const [vectorCraftConfigured, setVectorCraftConfigured] = useState<boolean | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [syncError, setSyncError] = useState('')
  const [notice, setNotice] = useState('')
  const [draggedBoard, setDraggedBoard] = useState<string | null>(null)
  const selectedProject = useRef(snapshot?.project.id)
  selectedProject.current = snapshot?.project.id
  const catalogRequest = useRef(0)


  const loadProjects = useCallback(async (): Promise<void> => {
    try {
      const list = await call<WorkCrateProject[]>('workcrateProjects', 'list', false)
      setProjects(list)
      const thumbs: Record<string, string> = {}
      const counts: Record<string, number> = {}
      const paths: Record<string, string | null> = {}
      await Promise.all(list.map(async (project) => {
        try {
          const pages = await call<WorkCrateBoard[]>('workcrateBoards', 'boardCatalog', project.id)
          counts[project.id] = pages.length
          const first = pages[0]
          if (first) thumbs[project.id] = await call<string>('workcrateBoards', 'preview', project.id, first.id)
        } catch { /* 新项目尚无预览时显示空状态 */ }
        paths[project.id] = await call<string | null>('workcrateBoards', 'getDocumentPath', project.id).catch(() => null)
      }))
      setProjectPreviews(thumbs)
      setProjectCounts(counts)
      setProjectPaths(paths)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取工程列表') }
  }, [])

  const loadProject = useCallback(async (projectId: string, boardId?: string): Promise<void> => {
    catalogRequest.current++
    setBusy(true); setError(''); setSyncError(''); setNotice('')
    try {
      const [project, catalog] = await Promise.all([
        call<ProjectSnapshot>('workcrateProjects', 'get', projectId),
        call<WorkCrateBoard[]>('workcrateBoards', 'boardCatalog', projectId)
      ])
      setSnapshot(project); setBoards(catalog); setActiveBoard(catalog.find((board) => board.id === boardId) ?? null); setPreview(''); setView(boardId ? 'page' : 'pages')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取工程画板') }
    finally { setBusy(false) }
  }, [])

  useEffect(() => {
    if (!isOpen) return
    void loadProjects()
    void call<VectorCraftConfig>('workcrateBoards', 'getConfig').then((value) => {
      setConfig(value)
      setVectorCraftConfigured(Boolean(value.cliExecutable.trim()))
    }).catch(() => setVectorCraftConfigured(false))
  }, [isOpen, loadProjects])
  const loadPresets = useCallback(async (): Promise<void> => {
    try {
      const [program, effective] = await Promise.all([
        call<FieldPresets>('workcrateProjects', 'getProgramPresets'),
        call<FieldPresets>('workcrateProjects', 'effectivePresets', selectedProject.current)
      ])
      setProgramPresets(program); setPresets(effective)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取基础信息') }
  }, [])
  useEffect(() => { if (isOpen) void loadPresets() }, [isOpen, snapshot?.project.id, loadPresets])
  const savePresets = async (value: FieldPresets): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      await call('workcrateProjects', 'saveProgramPresets', value)
      await loadPresets(); setNotice('基础信息已保存，可在物料输入框旁选填')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '保存基础信息失败') }
    finally { setBusy(false) }
  }

  const reloadCatalog = useCallback(async (projectId: string): Promise<void> => {
    const request = ++catalogRequest.current
    try {
      const catalog = await call<WorkCrateBoard[]>('workcrateBoards', 'boardCatalog', projectId)
      if (selectedProject.current !== projectId || request !== catalogRequest.current) return
      setBoards(catalog)
      setActiveBoard((current) => current ? catalog.find((board) => board.id === current.id) ?? catalog[0] ?? null : null)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '无法更新画板') }
  }, [])

  useEffect(() => {
    if (!activeBoard) { setPreview(''); return }
    let alive = true
    void call<string>('workcrateBoards', 'preview', activeBoard.projectId, activeBoard.id).then((value) => { if (alive) setPreview(value) }).catch((cause) => { if (alive) setError(String(cause)) })
    return () => { alive = false }
  }, [activeBoard])

  useEffect(() => window.bridge.onEvent((channel, payload) => {
    const event = payload as { projectId?: string; boardId?: string; message?: string; section?: 'connection' | 'basic'; quickCreate?: boolean; table?: QuickTable | null } | undefined
    const projectId = event?.projectId
    if (channel === 'workcrate:panel-open') {
      if (event?.section) { setView('settings'); setSettingsTab(event.section) }
      else if (projectId) void loadProject(projectId, event?.boardId).then(() => { if (event?.quickCreate) { setQuickTable(event.table ?? null); setView('quick') } })
      else { setView('projects'); setSnapshot(null); setActiveBoard(null) }
    }
    if (channel === 'workcrate:boards-changed' && projectId) {
      void loadProjects()
      if (projectId === selectedProject.current) { setSyncError(''); void reloadCatalog(projectId) }
    }
    if (channel === 'workcrate:sync-error' && projectId === selectedProject.current) setSyncError(event?.message ?? '自动同步失败')
    if (channel === 'workcrate:sync-recovered' && projectId === selectedProject.current) setSyncError('')
    if (channel === 'workcrateProjects:changed') { void loadProjects(); void loadPresets() }
  }), [loadProject, loadProjects, reloadCatalog, loadPresets])

  const createProject = async (): Promise<void> => {
    if (!name.trim() || busy) return
    setBusy(true); setError(''); setNotice('')
    let created: WorkCrateProject | null = null
    try {
      const connection = await call<VectorCraftConfig>('workcrateBoards', 'getConfig')
      setConfig(connection)
      setVectorCraftConfigured(Boolean(connection.cliExecutable.trim()))
      if (!connection.cliExecutable.trim()) throw new Error('请先在“程序默认信息”中配置 VectorCraft CLI 可执行文件')
      const directory = await call<string | null>('filesystem', 'pickDirectory')
      if (!directory) return
      created = await call<WorkCrateProject>('workcrateProjects', 'create', name.trim())
      await call('workcrateBoards', 'createProjectDocument', { projectId: created.id, directory })
      await call('workcrateProjects', 'relocateProject', { projectId: created.id, directory })
      setName(''); setNotice(`已在所选文件夹创建「${created.name}」及 VectorCraft 原生文档`)
      await loadProjects(); await loadProject(created.id)
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : '创建 VectorCraft 工程失败'
      if (created) {
        const path = await call<string | null>('workcrateProjects', 'getDocumentPath', created.id).catch(() => null)
        if (!path) await call('workcrateProjects', 'delete', created.id).catch(() => undefined)
        else setNotice(`VectorCraft 文档已创建：${path}。项目资料位置更新失败，可稍后重新打开工程。`)
      }
      await loadProjects(); setError(message)
    } finally { setBusy(false) }
  }

  const openPage = async (board: WorkCrateBoard): Promise<void> => {
    setActiveBoard(board); setPreview(''); setView('page'); setError('')
  }

  const sync = async (): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const next = await call<WorkCrateBoard[]>('workcrateBoards', 'refresh', snapshot.project.id)
      setBoards(next)
      if (activeBoard) {
        const updated = next.find((item) => item.id === activeBoard.id) ?? next[0] ?? null
        setActiveBoard(updated)
        setPreview(updated ? await call<string>('workcrateBoards', 'preview', snapshot.project.id, updated.id) : '')
      }
      setNotice(`已从 VectorCraft 同步 ${next.length} 个画板及物料栏信息`)
      await loadProjects()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '同步 VectorCraft 画板失败') }
    finally { setBusy(false) }
  }

  const openInVectorCraft = async (): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true); setError(''); setNotice('')
    try { await call('workcrateBoards', 'openInVectorCraft', snapshot.project.id); setNotice('已在 VectorCraft 中打开工程，画板与物料栏将自动双向同步') }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开 VectorCraft') }
    finally { setBusy(false) }
  }

  const openSettings = async (): Promise<void> => {
    setView('settings'); setError('')
    try {
      const value = await call<VectorCraftConfig>('workcrateBoards', 'getConfig')
      setConfig(value)
      setVectorCraftConfigured(Boolean(value.cliExecutable.trim()))
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法读取 VectorCraft 设置') }
  }

  const saveSettings = async (): Promise<void> => {
    setBusy(true); setError(''); setNotice('')
    try {
      const value = await call<VectorCraftConfig>('workcrateBoards', 'setConfig', config)
      setConfig(value)
      setVectorCraftConfigured(Boolean(value.cliExecutable.trim()))
      setNotice('VectorCraft 连接设置已保存')
    }
    catch (cause) { setError(cause instanceof Error ? cause.message : '保存 VectorCraft 设置失败') }
    finally { setBusy(false) }
  }

  const createPage = async (): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true); setError('')
    try {
      const board = await call<WorkCrateBoard>('workcrateBoards', 'createPage', snapshot.project.id)
      await reloadCatalog(snapshot.project.id); await openPage(board)
      setNotice('已在 VectorCraft 文档中新增画板')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '新增 VectorCraft 画板失败') }
    finally { setBusy(false) }
  }

  const batchCreate = async (table: QuickTable, reuseInitial: boolean): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await call<{ count: number; reusedInitial: boolean; boards: WorkCrateBoard[] }>('workcrateBoards', 'quickCreate', { projectId: snapshot.project.id, table, reuseInitial })
      setBoards(result.boards); setView('pages'); setQuickTable(null)
      setNotice(`已创建 ${result.count} 张画布及相应物料${result.reusedInitial ? '，已复用空白初始画板' : ''}`)
      await loadProjects()
    } catch (cause) { setError(cause instanceof Error ? cause.message : '批量创建失败') }
    finally { setBusy(false) }
  }

  const reorderPage = async (fromId: string, toId: string): Promise<void> => {
    setDraggedBoard(null)
    if (!snapshot || busy || fromId === toId) return
    const ids = boards.map((board) => board.id)
    const from = ids.indexOf(fromId), to = ids.indexOf(toId)
    if (from < 0 || to < 0) return
    ids.splice(to, 0, ids.splice(from, 1)[0])
    setBusy(true); setError('')
    try {
      await call('workcrateBoards', 'reorderPages', { projectId: snapshot.project.id, boardIds: ids })
      await reloadCatalog(snapshot.project.id)
      setNotice('页面顺序已保存到 VectorCraft 文档')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '调整页面顺序失败') }
    finally { setBusy(false) }
  }

  const saveMaterialInfo = async (info: BoardInfo): Promise<void> => {
    if (!activeBoard || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const updated = await call<WorkCrateBoard>('workcrateBoards', 'updateInfo', { boardId: activeBoard.id, info })
      setActiveBoard(updated)
      setBoards((current) => current.map((board) => board.id === updated.id ? updated : board))
      setPreview(await call<string>('workcrateBoards', 'preview', updated.projectId, updated.id))
      setNotice('物料栏已通过 VectorCraft CLI 写入原生画布')
    } catch (cause) { setError(cause instanceof Error ? cause.message : '写入 VectorCraft 物料栏失败') }
    finally { setBusy(false) }
  }

  const exportPages = async (options: PageExport): Promise<void> => {
    if (!snapshot || busy) return
    setBusy(true); setError(''); setNotice('')
    try {
      const directory = await call<string | null>('filesystem', 'pickDirectory')
      if (!directory) return
      const result = await call<{ directory: string; files: string[]; warnings: string[] }>('workcrateBoards', 'exportBoards', { projectId: snapshot.project.id, directory, ...options })
      setNotice(`已导出 ${result.files.length} 个文件至 ${result.directory}${result.warnings.length ? `；${result.warnings.join('；')}` : ''}`)
    } catch (cause) { setError(cause instanceof Error ? cause.message : '导出页面失败') }
    finally { setBusy(false) }
  }

  const openFolder = async (): Promise<void> => {
    if (!snapshot?.documentPath) return
    try { await call('workcrateBoards', 'openProjectFolder', snapshot.project.id) }
    catch (cause) { setError(cause instanceof Error ? cause.message : '无法打开工程文件夹') }
  }

  if (!isOpen) return null
  const visibleProjects = projects.filter((project) => project.name.toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()))
  return <ThemeFloatingPanel title="WorkCrate" icon={<LayoutGrid className="h-3.5 w-3.5" />} badge={view === 'projects' ? `${projects.length} 个工程` : snapshot?.project.name} isOpen={isOpen} onClose={closeFloatingPanel} initialX={55} initialY={42} initialWidth={1320} initialHeight={820} minWidth={880} minHeight={560} headerActions={<DesktopButton size="xs" variant="ghost" icon={<RefreshCw className="h-3.5 w-3.5" />} disabled={busy} onClick={() => view === 'projects' ? void loadProjects() : void sync()}>刷新</DesktopButton>}>
    <div data-workcrate-view={view} data-active-board={activeBoard?.id} className="flex h-full min-h-0 flex-col overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-inset)]">
      <nav className="flex shrink-0 items-center justify-center gap-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
        <NavButton active={view === 'projects'} onClick={() => { setView('projects'); setSnapshot(null) }} icon={<Grid2X2 className="h-3.5 w-3.5"/>}>项目管理</NavButton>
        <NavButton active={view === 'pages'} disabled={!snapshot} onClick={() => setView('pages')} icon={<LayoutGrid className="h-3.5 w-3.5"/>}>页面管理</NavButton>
        <NavButton active={view === 'page'} disabled={!activeBoard} onClick={() => activeBoard && setView('page')} icon={<Image className="h-3.5 w-3.5"/>}>页面编辑</NavButton>
        <NavButton active={view === 'settings'} onClick={() => void openSettings()} icon={<FolderOpen className="h-3.5 w-3.5"/>}>程序默认信息</NavButton>
      </nav>
      {view === 'projects' && <section className="flex min-h-0 flex-1 flex-col p-4">
        <header className="mb-4 flex shrink-0 items-start gap-4"><div className="min-w-0 flex-1"><div data-ds-type="meta" className="ds-type-meta uppercase tracking-wide">Tier 1 · Project Repository · VectorCraft Ready</div><h2 data-ds-type="page-title" className="ds-type-page-title mt-1">项目工程大盘</h2><p data-ds-type="body" className="ds-type-body mt-1 max-w-3xl">每个工程对应一个文件夹和 VectorCraft 原生文档。页面与画布预览由 VectorCraft 提供，物料栏由 WorkCrate 写入原生画布。</p></div><div className="w-60 shrink-0"><DesktopInput value={query} onChange={(event) => setQuery(event.target.value)} placeholder="搜索项目"/></div><DesktopButton variant="primary" disabled={busy || !name.trim() || !vectorCraftConfigured} icon={<Plus className="h-4 w-4"/>} onClick={() => void createProject()}>新建工程</DesktopButton></header>
        <div className="min-h-0 flex-1 overflow-y-auto"><div className="grid grid-cols-1 gap-3 xl:grid-cols-3">{visibleProjects.map((project) => <article key={project.id} className="flex min-h-[400px] flex-col rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3"><div className="flex items-center gap-2"><DesktopButton type="button" size="sm" variant="ghost" onClick={() => void loadProject(project.id)} className="min-w-0 flex-1 justify-start truncate text-left font-semibold">{project.name}</DesktopButton><DesktopIconButton size="xs" icon={<ArrowRight className="h-4 w-4"/>} tooltip="打开页面管理" onClick={() => void loadProject(project.id)}/></div><div className="mt-1 text-xs text-[var(--ds-text-muted)]">{projectCounts[project.id] ?? 0} 个画布 · {new Date(project.createdAt).toLocaleDateString()}</div><DesktopCardButton onClick={() => void loadProject(project.id)} className="mt-3 flex min-h-[260px] flex-1 items-center justify-center overflow-hidden p-2">{projectPreviews[project.id] ? <img src={projectPreviews[project.id]} alt={`${project.name} 首页面板预览`} className="h-full max-h-[320px] w-full object-contain"/> : <div className="flex flex-col items-center gap-2 text-xs text-[var(--ds-text-muted)]"><Image className="h-7 w-7"/>尚未同步画板预览</div>}</DesktopCardButton><div className="mt-2 flex items-center gap-2 border-t border-[var(--ds-border)] pt-2 text-xs text-[var(--ds-text-muted)]"><span className="min-w-0 flex-1 truncate" title={projectPaths[project.id] ?? undefined}>{projectPaths[project.id] ?? 'VectorCraft 原生画板预览'}</span><DesktopButton type="button" size="xs" variant="ghost" onClick={() => void loadProject(project.id)} className="shrink-0">进入页面矩阵</DesktopButton></div></article>)}</div>
          {!visibleProjects.length && <div className="flex h-64 items-center justify-center text-sm text-[var(--ds-text-subtle)]">{projects.length ? '没有匹配的工程' : '还没有工程，请选择一个文件夹创建 VectorCraft 工程'}</div>}
        </div>
        <div className="mx-auto mt-3 w-full max-w-xl shrink-0 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><div className="flex items-center gap-3"><DesktopInput value={name} onChange={(event) => setName(event.target.value)} maxLength={120} placeholder="工程名称"/><DesktopButton variant="primary" disabled={busy || !name.trim() || !vectorCraftConfigured} icon={<Plus className="h-4 w-4"/>} onClick={() => void createProject()}>创建新物料工程（选择文件夹）</DesktopButton></div><p className="mt-2 text-xs text-[var(--ds-text-muted)]">{vectorCraftConfigured ? (name.trim() ? '选择文件夹创建工程后，在页面管理中使用“快速创建”粘贴物料表格。' : '请先输入工程名称，再选择保存文件夹。') : '请先在“程序默认信息”中配置 VectorCraft CLI 可执行文件。'}</p></div>
      </section>}

      {view === 'pages' && snapshot && <PageManager key={snapshot.project.id} projectId={snapshot.project.id} projectName={snapshot.project.name} hasDocument={Boolean(snapshot.documentPath)} boards={boards} busy={busy} onBack={() => { setView('projects'); setSnapshot(null) }} onOpen={(board) => { const page = boards.find((item) => item.id === board.id); if (page) void openPage(page) }} onSync={() => void sync()} onCreate={() => void createPage()} onQuickCreate={() => { setQuickTable(null); setError(''); setView('quick') }} onFolder={() => void openFolder()} onEditor={() => void openInVectorCraft()} onExport={(options) => void exportPages(options)}/>}

      {view === 'quick' && snapshot && <QuickCreate key={snapshot.project.id} initial={quickTable} busy={busy} onBack={() => setView('pages')} onCreate={batchCreate}/>}

      {view === 'page' && snapshot && activeBoard && <section className="flex min-h-0 flex-1 flex-col"><header className="flex shrink-0 items-center gap-3 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-2"><DesktopIconButton size="sm" icon={<ArrowLeft className="h-4 w-4"/>} tooltip="返回页面列表" onClick={() => setView('pages')}/><span className="min-w-0 flex-1 truncate text-sm font-medium">{activeBoard.title || `页面${String(activeBoard.index + 1).padStart(2, '0')}`}</span><DesktopButton icon={<Plus className="h-4 w-4"/>} disabled={busy} onClick={() => void createPage()}>新增画板</DesktopButton><DesktopButton variant="ghost" icon={<RefreshCw className="h-4 w-4"/>} disabled={busy} onClick={() => void sync()}>同步工程与预览</DesktopButton><DesktopButton variant="primary" icon={<ExternalLink className="h-4 w-4"/>} disabled={busy || !snapshot.documentPath} onClick={() => void openInVectorCraft()}>在 VectorCraft 中编辑</DesktopButton></header>
        <div className="grid min-h-0 flex-1 grid-cols-[210px_minmax(0,1fr)_300px]"><aside className="min-h-0 overflow-y-auto border-r border-[var(--ds-border)] p-3 dark:border-[var(--ds-border)]"><div className="mb-2 text-xs font-medium text-[var(--ds-text-muted)]">页面 · 拖动调整顺序</div><div className="space-y-2">{boards.map((board) => <div key={board.id} data-board-id={board.id} draggable={!busy} onDragStart={(event) => { setDraggedBoard(board.id); event.dataTransfer.setData('text/plain', board.id); event.dataTransfer.effectAllowed = 'move' }} onDragEnd={() => setDraggedBoard(null)} onDragOver={(event) => { if (draggedBoard) { event.preventDefault(); event.dataTransfer.dropEffect = 'move' } }} onDrop={(event) => { event.preventDefault(); void reorderPage(draggedBoard ?? event.dataTransfer.getData('text/plain'), board.id) }} className={draggedBoard === board.id ? 'opacity-40' : ''}><PageThumb board={board} active={board.id === activeBoard.id} onClick={() => void openPage(board)}/></div>)}</div></aside><main className="flex min-h-0 min-w-0 flex-col bg-[var(--ds-surface-subtle)] p-4"><div className="mb-2 flex items-center gap-2 text-xs text-[var(--ds-text-muted)]"><span>VectorCraft 原生画布预览</span><span className="ml-auto">{boardSize(activeBoard)}</span></div><div className="flex min-h-0 flex-1 items-center justify-center overflow-auto rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] p-4 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">{preview ? <img src={preview} alt={activeBoard.title} className="max-h-full max-w-full object-contain"/> : <div className="text-sm text-[var(--ds-text-subtle)]">同步后显示 VectorCraft 画板缓存</div>}</div></main><aside className="min-h-0 overflow-y-auto border-l border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"><MaterialPanel board={activeBoard} presets={presets} busy={busy} onSave={(info) => void saveMaterialInfo(info)}/></aside></div>
      </section>}

      {view === 'settings' && <section className="mx-auto flex min-h-0 w-full max-w-4xl flex-1 flex-col overflow-hidden p-5">
        <div className="mb-3 flex shrink-0 items-center gap-2"><h2 data-ds-type="section-title" className="ds-type-section-title mr-auto">程序默认信息</h2><NavButton active={settingsTab === 'connection'} onClick={() => setSettingsTab('connection')} icon={<ExternalLink className="h-3.5 w-3.5"/>}>程序连接</NavButton><NavButton active={settingsTab === 'basic'} onClick={() => setSettingsTab('basic')} icon={<Grid2X2 className="h-3.5 w-3.5"/>}>基础信息</NavButton></div>
        {settingsTab === 'basic' ? <BasicInformation presets={programPresets} busy={busy} onSave={savePresets}/> : <div className="flex min-h-0 flex-1 flex-col overflow-y-auto"><p data-ds-type="body" className="ds-type-body mb-5">配置 VectorCraft 程序，用于创建工程、同步画板和更新物料栏。</p><label data-ds-type="label" className="ds-type-label mb-4 block">VectorCraft CLI 可执行文件<input value={config.cliExecutable} onChange={(event) => setConfig((current) => ({ ...current, cliExecutable: event.target.value }))} placeholder="C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe" disabled={busy} className="mt-1.5 w-full rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"/></label><label data-ds-type="label" className="ds-type-label mb-4 block">VectorCraft GUI 可执行文件（可选）<input value={config.guiExecutable} onChange={(event) => setConfig((current) => ({ ...current, guiExecutable: event.target.value }))} placeholder="C:\\Program Files\\VectorCraft\\vectorcraft.exe" disabled={busy} className="mt-1.5 w-full rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"/></label><label data-ds-type="label" className="ds-type-label mb-4 block">VectorCraft GUI 控制端口<input type="number" min={1} max={65535} value={config.port} onChange={(event) => setConfig((current) => ({ ...current, port: Number(event.target.value) }))} disabled={busy} className="mt-1.5 w-40 rounded border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 text-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]"/></label><div className="mt-auto flex justify-end"><DesktopButton variant="primary" disabled={busy} onClick={() => void saveSettings()}>保存连接设置</DesktopButton></div></div>}
      </section>}
      <footer data-workcrate-notifications className="flex min-h-9 shrink-0 items-center gap-3 border-t border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-2 text-xs dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
        {(error || syncError) ? <span role="alert" className="min-w-0 flex-1 break-words text-[var(--ds-status-danger)]">{error || syncError}</span> : <span role="status" className="min-w-0 flex-1 break-words text-[var(--ds-accent)]">{busy ? '正在处理…' : notice || '就绪'}</span>}
      </footer>
    </div>
  </ThemeFloatingPanel>
}

function NavButton({ active, disabled, onClick, icon, children }: { active: boolean; disabled?: boolean; onClick: () => void; icon: ReactElement; children: ReactElement | string }): ReactElement {
  const { DesktopButton } = useUiKit()
  return <DesktopButton type="button" size="sm" variant="ghost" active={active} disabled={disabled} onClick={onClick} className="gap-2">{icon}{children}</DesktopButton>
}

function PageThumb({ board, active, onClick }: { board: WorkCrateBoard; active: boolean; onClick: () => void }): ReactElement {
  const { DesktopCardButton } = useUiKit()
  const [thumb, setThumb] = useState('')
  useEffect(() => { let alive = true; void call<string>('workcrateBoards', 'preview', board.projectId, board.id).then((image) => { if (alive) setThumb(image) }).catch(() => undefined); return () => { alive = false } }, [board])
  return <DesktopCardButton type="button" selected={active} onClick={onClick} className="w-full p-2"><div className="flex h-24 items-center justify-center">{thumb && <img src={thumb} alt="" draggable={false} className="h-full w-full object-contain"/>}</div><div className="mt-1 truncate text-xs text-[var(--ds-text-primary)]">{String(board.index + 1).padStart(2, '0')} {board.title || '未命名画板'}</div></DesktopCardButton>
}

function MaterialPanel({ board, presets, busy, onSave }: { board: WorkCrateBoard; presets: FieldPresets; busy: boolean; onSave: (info: BoardInfo) => void }): ReactElement {
  const { DesktopButton, DesktopIconButton } = useUiKit()
  const [draft, setDraft] = useState<BoardInfo>(board.info)
  const [extraRows, setExtraRows] = useState<Array<{ key: string; value: string }>>([])
  useEffect(() => { setDraft(board.info); setExtraRows(Object.entries(board.info.extra ?? {}).map(([key, value]) => ({ key, value }))) }, [board.id, JSON.stringify(board.info)])
  const update = (key: keyof Omit<BoardInfo, 'extra'>, value: string): void => setDraft((current) => ({ ...current, [key]: value }))
  const setExtra = (index: number, key: 'key' | 'value', value: string): void => setExtraRows((current) => current.map((row, rowIndex) => rowIndex === index ? { ...row, [key]: value } : row))
  const save = (): void => {
    const extra: Record<string, string> = {}
    for (const row of extraRows) if (row.key.trim()) extra[row.key.trim()] = row.value.trim()
    onSave({ ...draft, extra })
  }
  return <div className="space-y-4"><section className="rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] p-3"><div className="mb-3 flex items-center"><span className="h-2 w-2 rounded-full bg-[var(--ds-accent)]"/><h3 className="ml-2 flex-1 text-sm font-medium">页面物料栏</h3><span className="text-xs text-[var(--ds-text-muted)]">写入 VectorCraft</span></div><div className="space-y-2">{materialFields.map(({ key, label, placeholder }) => <div key={key} className="grid grid-cols-[60px_minmax(0,1fr)] items-center gap-1 text-xs"><span className="text-[var(--ds-text-muted)]">{label}</span><PresetInput label={label} value={draft[key]} options={presets.fields.find((field) => field.key === key)?.values ?? []} busy={busy} placeholder={placeholder} onChange={(value) => update(key, value)}/></div>)}</div><div className="mt-3 border-t border-[var(--ds-border)] pt-3"><div className="mb-2 text-xs font-medium text-[var(--ds-text-muted)]">扩展物料参数</div>{extraRows.map((row, index) => <div key={index} className="mb-2 space-y-1 rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] p-2"><div className="flex items-center gap-1"><div className="min-w-0 flex-1"><PresetInput label={`参数 ${index + 1} 名称`} value={row.key} options={presets.fields.filter((field) => !materialFields.some((item) => item.key === field.key)).map((field) => field.label)} busy={busy} placeholder="参数名称" onChange={(value) => setExtra(index, 'key', value)}/></div><DesktopIconButton size="xs" variant="danger" aria-label="删除参数行" tooltip="删除参数行" disabled={busy} onClick={() => setExtraRows((current) => current.filter((_, rowIndex) => rowIndex !== index))} icon={<X className="h-3.5 w-3.5"/>}/></div><PresetInput label={`参数 ${index + 1} 内容`} value={row.value} options={presets.fields.find((field) => field.key === row.key || field.label === row.key)?.values ?? []} busy={busy} placeholder="参数值" onChange={(value) => setExtra(index, 'value', value)}/></div>)}<DesktopButton type="button" size="xs" variant="ghost" disabled={busy} onClick={() => setExtraRows((current) => [...current, { key: '', value: '' }])} className="mt-1">＋ 新增物料参数行</DesktopButton></div><DesktopButton type="button" variant="primary" disabled={busy} onClick={save} className="mt-3 w-full">保存物料栏到 VectorCraft</DesktopButton><p className="mt-2 text-xs leading-5 text-[var(--ds-text-muted)]">保存会通过 VectorCraft CLI 更新原生画布并刷新当前页面缓存。</p></section><section className="rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] p-3"><div className="mb-2 flex items-center"><span className="h-2 w-2 rounded-full bg-[var(--ds-accent)]"/><h3 className="ml-2 text-sm font-medium">VectorCraft 画板</h3></div><div className="text-xs text-[var(--ds-text-muted)]">{boardSize(board)}</div><div className="mt-1 text-xs text-[var(--ds-text-subtle)]">画布内容的编辑、显示和导出由 VectorCraft 完成。</div></section></div>
}

function boardSize(board: WorkCrateBoard): string { return `${board.widthPt.toFixed(1)} × ${board.heightPt.toFixed(1)} pt` }
