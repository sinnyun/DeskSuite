import { useCallback, useEffect, useMemo, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { Archive, GitBranch, History, RotateCcw, Save, ShieldCheck } from 'lucide-react'
import { mutateVersion, VersionActionCancelled } from './version-actions'
import { call, getService, useUiKit, type SelectionSnapshot, type SelectionService } from '../../workbench/sdk'

interface VersionEntry {
  versionId: string
  revisionNumber: number
  parentRevisionIds: string[]
  title: string
  createdAt: string
  sizeBytes: number
  contentType: string | null
  thumbnailPath: string | null
  isCurrent: boolean
  branchNames?: string[]
}
interface VersionState {
  operation?: string | null
  synchronizationError?: string | null
  status: 'unversioned' | 'saved' | 'matches_saved_version' | 'modified' | 'interrupted_restore' | 'unknown' | 'unavailable'
  currentVersionId: string | null
  currentTitle: string | null
  matchingVersionId: string | null
  matchingTitle: string | null
  pendingRestore?: {
    pending: boolean
    sourcePath: string | null
    versionId: string | null
    sourceAvailable: boolean
    sameSourceBytes: boolean
    sourceIsTarget: boolean
    diagnostic?: string
  } | null
}
interface Branch {
  branchId: string
  name: string
  category: string
  headRevisionId: string | null
  isCurrent: boolean
  isArchived: boolean
  createdAtUnix: number
  stack: Array<{ branchId: string; revisionId: string }>
  revisions: VersionEntry[]
}
interface VersionGraph { branches: Branch[]; graphState: string; pendingMerge: { sourceBranch: string; targetBranch: string; conflictFiles: string[]; targetBaseRevisionId: string } | null }
interface JobDone { id: string; state: 'done' | 'failed' | 'canceled'; error?: string }
const emptySelection: SelectionSnapshot = { path: null, entries: [], selected: [] }
const emptySubscribe = (): (() => void) => () => {}
const branchActionNames: Record<string, string> = {
  create: '创建分支', switch: '切换分支', archive: '归档分支', merge: '合并分支', resolve: '解决冲突', abort: '中止合并'
}

function statusCopy(state: VersionState | null): { label: string; tone: string; detail: string } {
  if (!state) return { label: '读取中', tone: 'text-[var(--ds-text-subtle)]', detail: '正在检查文件版本状态' }
  if (state.status === 'interrupted_restore') {
    const pending = state.pendingRestore
    if (!pending?.sourceAvailable) return { label: '恢复中断', tone: 'text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]', detail: pending?.diagnostic ?? '原文件暂不可访问；恢复记录仍保留' }
    if (pending.sameSourceBytes) return { label: '恢复中断', tone: 'text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]', detail: '原文件字节未变化，可以继续完成该版本恢复' }
    if (pending.sourceIsTarget) return { label: '恢复待收尾', tone: 'text-[var(--ds-status-info)]', detail: '原文件已匹配目标版本，可以继续完成恢复记录清理' }
    return { label: '恢复中断', tone: 'text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]', detail: '检测到原文件在恢复期间被改写；可解除阻塞并保留当前文件' }
  }
  if (state.status === 'unversioned') return { label: '尚未保存', tone: 'text-[var(--ds-text-subtle)]', detail: '为该文件创建第一个历史版本' }
  if (state.status === 'unknown') return { label: '版本信息待同步', tone: 'text-[var(--ds-status-warning)]', detail: '现有历史尚未同步到版本信息库，请执行版本信息同步' }
  if (state.status === 'unavailable') return { label: '文件不可访问', tone: 'text-[var(--ds-status-warning)]', detail: '历史版本信息仍保留在版本信息库中' }
  if (state.status === 'modified') return { label: '有未保存修改', tone: 'text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]', detail: '当前文件内容与已保存版本不同' }
  if (state.status === 'matches_saved_version') return { label: '匹配旧版本', tone: 'text-[var(--ds-status-info)]', detail: `当前内容与「${state.matchingTitle ?? '历史版本'}」相同` }
  return { label: '与当前版本一致', tone: 'text-[var(--ds-status-success)] dark:text-[var(--ds-status-success)]', detail: state.currentTitle ?? '当前内容已保存' }
}

export function FileVersionsPanel(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopInput } = useUiKit()
  const selectionService = getService<SelectionService>('selection')
  const selection = useSyncExternalStore(
    selectionService?.subscribe ?? emptySubscribe,
    selectionService?.getSnapshot ?? (() => emptySelection),
    selectionService?.getSnapshot ?? (() => emptySelection)
  )
  const selected = selection.selected.filter((item) => !item.isDirectory)
  const current = selected[0]
  const path = current?.path ?? ''
  const [entries, setEntries] = useState<VersionEntry[]>([])
  const [state, setState] = useState<VersionState | null>(null)
  const [graph, setGraph] = useState<VersionGraph | null>(null)
  const [showArchivedBranches, setShowArchivedBranches] = useState(false)
  const [title, setTitle] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [previews, setPreviews] = useState<Record<string, string>>({})
  const pathRef = useRef(path)
  const refreshSequence = useRef(0)
  const stateRefreshSequence = useRef(0)
  const refreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const stateRefreshTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const refreshRunning = useRef(0)
  const stateRefreshPending = useRef(false)
  const flushPendingStateRefresh = useRef<() => void>(() => {})
  const previewPath = useRef(path)
  const entriesPath = useRef(path)
  const previewCache = useRef(new Map<string, string>())
  const previewRequests = useRef(new Map<string, Promise<string | null>>())
  const activeJob = useRef<{ id: string; path: string } | null>(null)
  const completedJobs = useRef(new Map<string, JobDone>())
  pathRef.current = path
  const selectedLabel = current ? (selected.length > 1 ? `${current.name}（另有 ${selected.length - 1} 个文件）` : current.name) : ''

  const refresh = useCallback(async (): Promise<void> => {
    const request = ++refreshSequence.current
    stateRefreshSequence.current += 1
    const requestedPath = path
    if (!requestedPath) {
      setEntries([]); setState(null); setGraph(null); setPreviews({}); setBusy(false)
      return
    }
    refreshRunning.current += 1
    setBusy(true); setError('')
    try {
      const [listResult, stateResult] = await Promise.all([
        call<VersionEntry[]>('versions', 'list', requestedPath),
        call<VersionState>('versions', 'state', requestedPath)
      ])
      if (refreshSequence.current !== request || pathRef.current !== requestedPath) return
      let graphResult: VersionGraph | null = null
      let graphError = ''
      try {
        graphResult = await call<VersionGraph>('versions', 'branchGraph', requestedPath, true)
      } catch (cause) {
        graphError = cause instanceof Error ? cause.message : '无法读取 Lore 分支状态'
      }
      if (refreshSequence.current !== request || pathRef.current !== requestedPath) return
      const merged = new Map<string, VersionEntry>()
      for (const entry of listResult) merged.set(entry.versionId, { ...entry, branchNames: [] })
      for (const branch of graphResult?.branches ?? []) {
        for (const revision of branch.revisions) {
          const existing = merged.get(revision.versionId)
          const branchNames = [...new Set([...(existing?.branchNames ?? []), branch.name])]
          merged.set(revision.versionId, {
            ...revision,
            ...existing,
            isCurrent: Boolean(existing?.isCurrent || revision.isCurrent),
            branchNames
          })
        }
      }
      entriesPath.current = requestedPath
      setEntries([...merged.values()].sort((left, right) =>
        Date.parse(right.createdAt) - Date.parse(left.createdAt) || right.revisionNumber - left.revisionNumber
      ))
      setState(stateResult)
      setGraph(graphResult)
      if (graphError) setError(`版本时间线已加载；${graphError}`)
    } catch (cause) {
      if (refreshSequence.current !== request || pathRef.current !== requestedPath) return
      setError(cause instanceof Error ? cause.message : '无法读取 Lore 历史')
    } finally {
      if (refreshSequence.current === request && pathRef.current === requestedPath) setBusy(false)
      refreshRunning.current -= 1
      if (refreshRunning.current === 0 && stateRefreshPending.current) {
        stateRefreshPending.current = false
        flushPendingStateRefresh.current()
      }
    }
  }, [path])

  const scheduleRefresh = useCallback((): void => {
    if (stateRefreshTimer.current) clearTimeout(stateRefreshTimer.current)
    stateRefreshTimer.current = null
    if (refreshTimer.current) clearTimeout(refreshTimer.current)
    refreshTimer.current = setTimeout(() => {
      refreshTimer.current = null
      void refresh()
    }, 120)
  }, [refresh])

  const refreshState = useCallback(async (): Promise<void> => {
    const requestedPath = path
    if (!requestedPath) return
    const request = ++stateRefreshSequence.current
    try {
      const next = await call<VersionState>('versions', 'state', requestedPath)
      if (stateRefreshSequence.current === request && pathRef.current === requestedPath) setState(next)
    } catch (cause) {
      if (stateRefreshSequence.current === request && pathRef.current === requestedPath) {
        setError(cause instanceof Error ? cause.message : '无法读取文件版本状态')
      }
    }
  }, [path])

  const scheduleStateRefresh = useCallback((): void => {
    if (refreshTimer.current) return
    if (refreshRunning.current) {
      stateRefreshPending.current = true
      return
    }
    if (stateRefreshTimer.current) clearTimeout(stateRefreshTimer.current)
    stateRefreshTimer.current = setTimeout(() => {
      stateRefreshTimer.current = null
      void refreshState()
    }, 120)
  }, [refreshState])
  flushPendingStateRefresh.current = scheduleStateRefresh

  const settleJob = useCallback((job: JobDone, jobPath: string): void => {
    if (activeJob.current?.id !== job.id) return
    activeJob.current = null
    if (pathRef.current !== jobPath) return
    setNotice('')
    if (job.state !== 'done') setError(job.error ?? (job.state === 'canceled' ? '版本任务已取消' : '版本任务失败'))
  }, [])

  const trackJob = useCallback((jobId: string, jobPath: string): void => {
    activeJob.current = { id: jobId, path: jobPath }
    const finished = completedJobs.current.get(jobId)
    if (finished) settleJob(finished, jobPath)
  }, [settleJob])

  useEffect(() => {
    entriesPath.current = ''
    setEntries([]); setState(null); setGraph(null); setShowArchivedBranches(false); setPreviews({}); setError(''); setNotice('')
  }, [path])

  useEffect(() => {
    const requestedPath = path
    if (previewPath.current !== requestedPath) {
      previewPath.current = requestedPath
      previewCache.current.clear()
      previewRequests.current.clear()
      setPreviews({})
    }
    if (!requestedPath || entriesPath.current !== requestedPath) return
    const available = entries.filter((entry) => entry.thumbnailPath).slice(0, 30)
    if (!available.length) return
    void Promise.all(available.map(async (entry): Promise<[string, string] | null> => {
      const key = `${requestedPath}\u0000${entry.versionId}`
      const cached = previewCache.current.get(key)
      if (cached) return [entry.versionId, cached]
      let request = previewRequests.current.get(key)
      if (!request) {
        request = call<string | null>('versions', 'preview', requestedPath, entry.versionId)
          .then((preview) => {
            if (preview) previewCache.current.set(key, preview)
            return preview
          })
          .catch(() => null)
          .finally(() => previewRequests.current.delete(key))
        previewRequests.current.set(key, request)
      }
      try {
        const preview = await request
        return preview ? [entry.versionId, preview] : null
      } catch { return null }
    })).then((items) => {
      if (pathRef.current !== requestedPath) return
      setPreviews((current) => ({
        ...current,
        ...Object.fromEntries(items.filter((item): item is [string, string] => item !== null))
      }))
    })
  }, [path, entries])

  useEffect(() => {
    scheduleRefresh()
    return () => {
      if (refreshTimer.current) clearTimeout(refreshTimer.current)
      if (stateRefreshTimer.current) clearTimeout(stateRefreshTimer.current)
      refreshTimer.current = null
      stateRefreshTimer.current = null
    }
  }, [scheduleRefresh])
  useEffect(() => window.bridge.onEvent((channel, payload) => {
    if (channel === 'versions:changed') {
      if (!payload || typeof payload !== 'object' || !('path' in payload) || (payload as { path?: unknown }).path !== path) return
      if ('kind' in payload && (payload as { kind?: unknown }).kind === 'source') scheduleStateRefresh()
      else scheduleRefresh()
      return
    }
    if (channel === 'job:done' && payload && typeof payload === 'object' && 'id' in payload) {
      const job = payload as JobDone
      completedJobs.current.set(job.id, { id: job.id, state: job.state, error: job.error })
      while (completedJobs.current.size > 50) completedJobs.current.delete(completedJobs.current.keys().next().value!)
      const current = activeJob.current
      if (current?.id === job.id) settleJob(job, current.path)
    }
  }), [path, scheduleRefresh, scheduleStateRefresh, settleJob])

  const status = useMemo(() => statusCopy(state), [state])
  const pendingRestore = state?.pendingRestore?.pending ? state.pendingRestore : null
  const pendingRestoreEntry = pendingRestore?.versionId ? entries.find((entry) => entry.versionId === pendingRestore.versionId) : undefined
  const currentEntry = entries.find((entry) => entry.isCurrent)
  const visibleBranches = (graph?.branches ?? []).filter((branch) => showArchivedBranches || !branch.isArchived)
  const stateIconTone = pendingRestore || state?.status === 'modified'
    ? 'border-[var(--ds-status-warning)]/35 bg-[var(--ds-status-warning-soft)] text-[var(--ds-status-warning)] dark:border-[var(--ds-status-warning)]/35 dark:bg-[var(--ds-status-warning-soft)] dark:text-[var(--ds-status-warning)]'
    : state?.status === 'matches_saved_version'
      ? 'border-[var(--ds-status-info)]/35 bg-[var(--ds-status-info-soft)] text-[var(--ds-status-info)]'
      : state?.status === 'saved'
        ? 'border-[var(--ds-status-success)]/35 bg-[var(--ds-status-success-soft)] text-[var(--ds-status-success)] dark:border-[var(--ds-status-success)]/35 dark:bg-[var(--ds-status-success-soft)] dark:text-[var(--ds-status-success)]'
        : 'border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]'
  const createVersion = async (): Promise<void> => {
    if (!path || busy || pendingRestore) return
    const requestedPath = path
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await mutateVersion<{ jobId: string }>('create', [requestedPath, title.trim()], '保存当前文件的新版本？')
      trackJob(result.jobId, requestedPath)
      if (pathRef.current !== requestedPath) return
      setTitle('')
      setNotice(`版本保存任务已提交（${result.jobId}）；完成后会自动刷新历史`)
    } catch (cause) { if (!(cause instanceof VersionActionCancelled) && pathRef.current === requestedPath) setError(cause instanceof Error ? cause.message : '无法创建版本') }
    finally { if (pathRef.current === requestedPath) setBusy(false) }
  }

  const restore = async (entry: VersionEntry, resumeInterrupted = false): Promise<void> => {
    if (!path || busy || (entry.isCurrent && !resumeInterrupted)) return
    if (pendingRestore && (!resumeInterrupted || pendingRestore.versionId !== entry.versionId)) return
    const requestedPath = path
    const confirmation = resumeInterrupted
      ? `继续完成「${entry.title}」的中断恢复。系统会重新检查原文件字节；若已被改写则不会覆盖。继续吗？`
      : `将「${entry.title}」恢复到原文件路径并覆盖当前内容。此操作会检查文件是否有未保存修改。继续吗？`
    if (!window.confirm(confirmation)) return
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await mutateVersion<{ jobId: string }>('restore', [requestedPath, entry.versionId, true], confirmation, true)
      trackJob(result.jobId, requestedPath)
      if (pathRef.current !== requestedPath) return
      setNotice(`恢复任务已提交（${result.jobId}）；完成后 Explorer 会刷新文件信息`)
    } catch (cause) { if (!(cause instanceof VersionActionCancelled) && pathRef.current === requestedPath) setError(cause instanceof Error ? cause.message : '无法恢复版本') }
    finally { if (pathRef.current === requestedPath) setBusy(false) }
  }

  const reconcileMetadata = async (): Promise<void> => {
    if (!path || busy) return
    const requestedPath = path
    setBusy(true); setError(''); setNotice('')
    try {
      await mutateVersion('reconcile', [requestedPath, true], '同步版本信息？此操作不会修改原文件。')
      if (pathRef.current === requestedPath) await refresh()
    } catch (cause) { if (!(cause instanceof VersionActionCancelled) && pathRef.current === requestedPath) setError(cause instanceof Error ? cause.message : '版本信息同步失败') }
    finally { if (pathRef.current === requestedPath) setBusy(false) }
  }

  const abandonInterruptedRestore = async (): Promise<void> => {
    if (!path || busy || !pendingRestore?.versionId || !pendingRestore.sourceAvailable) return
    const requestedPath = path
    const title = pendingRestoreEntry?.title ?? pendingRestore.versionId
    if (!window.confirm(`「${title}」的恢复期间原文件被改写。解除恢复阻塞会保留当前文件字节与 Lore 历史，不会覆盖文件。确认解除吗？`)) return
    setBusy(true); setError(''); setNotice('')
    try {
      await mutateVersion('abandonInterruptedRestore', [requestedPath, pendingRestore.versionId, true], '', true)
      if (pathRef.current !== requestedPath) return
      await refresh()
      if (pathRef.current === requestedPath) setNotice('已解除恢复阻塞，当前文件内容与 Lore 历史均已保留')
    } catch (cause) { if (!(cause instanceof VersionActionCancelled) && pathRef.current === requestedPath) setError(cause instanceof Error ? cause.message : '无法解除中断恢复') }
    finally { if (pathRef.current === requestedPath) setBusy(false) }
  }

  const branchAction = async (action: 'create' | 'switch' | 'archive' | 'merge' | 'resolve' | 'abort', params: Record<string, unknown>): Promise<void> => {
    if (!path || busy || pendingRestore) return
    const requestedPath = path
    setBusy(true); setError(''); setNotice('')
    try {
      const result = await mutateVersion<{ jobId: string }>('branchAction', [requestedPath, { action, ...params }, true], `确认${branchActionNames[action]}？`)
      trackJob(result.jobId, requestedPath)
      if (pathRef.current === requestedPath) setNotice(`${branchActionNames[action]}任务已提交${result.jobId ? `（${result.jobId}）` : ''}`)
    } catch (cause) {
      if (!(cause instanceof VersionActionCancelled) && pathRef.current === requestedPath) setError(cause instanceof Error ? cause.message : `${branchActionNames[action]}失败`)
    }
    finally { if (pathRef.current === requestedPath) setBusy(false) }
  }

  const createBranch = (): void => {
    const name = window.prompt('输入新分支名称')
    if (name?.trim()) void branchAction('create', { name: name.trim() })
  }

  const mergeBranch = (branch: Branch): void => {
    if (!window.confirm(`将分支「${branch.name}」合并到当前分支？`)) return
    void branchAction('merge', { sourceBranch: branch.name })
  }

  const resolveMerge = (strategy: 'ours' | 'theirs'): void => {
    if (!graph?.pendingMerge) return
    if (!window.confirm(`使用“${strategy === 'ours' ? '当前分支' : '来源分支'}”解决 ${graph.pendingMerge.conflictFiles.length} 个冲突，并更新原文件？`)) return
    void branchAction('resolve', { strategy })
  }

  if (!current) return <div className="flex h-full min-h-0 flex-col items-center justify-center gap-2 p-4 text-center text-xs text-[var(--ds-text-subtle)]"><History className="h-6 w-6 text-[var(--ds-text-subtle)]" />选择一个文件查看版本历史</div>

  const canContinueRestore = Boolean(pendingRestore?.sourceAvailable && (pendingRestore.sameSourceBytes || pendingRestore.sourceIsTarget))
  const canAbandonRestore = Boolean(pendingRestore?.sourceAvailable && !pendingRestore.sameSourceBytes && !pendingRestore.sourceIsTarget)
  return <div className="flex h-full min-h-0 flex-col gap-2.5 overflow-y-auto bg-[var(--ds-surface-subtle)] p-2.5 text-xs dark:bg-[var(--ds-surface)]">
    <section className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2.5 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
      <div className="flex items-start gap-2">
        <div className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border ${stateIconTone}`}><ShieldCheck className="h-4 w-4"/></div>
        <div className="min-w-0 flex-1"><div className="truncate font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]" title={path}>{selectedLabel}</div><div className={`mt-0.5 font-semibold ${status.tone}`}>{status.label}</div><div className="mt-0.5 text-xs leading-relaxed text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">{status.detail}</div></div>
        <DesktopIconButton size="xs" tooltip="刷新版本状态" icon={<RotateCcw className="h-3.5 w-3.5"/>} onClick={() => void refresh()} disabled={busy}/>
      </div>
      <div className="mt-2.5 rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-2 py-1.5">
        <div className="flex items-center gap-2"><span className="h-1.5 w-1.5 rounded-full bg-[var(--ds-status-success)]"/><span className="text-xs font-semibold text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">当前版本</span><span className="ml-auto text-xs text-[var(--ds-text-subtle)]">{currentEntry ? formatBytes(currentEntry.sizeBytes) : '尚无快照'}</span></div>
        <div className="mt-1 flex items-start gap-2"><span className="min-w-0 flex-1 truncate font-medium text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">{currentEntry?.title ?? '还没有保存版本'}</span>{currentEntry && <span className="shrink-0 text-xs text-[var(--ds-text-subtle)]">{new Date(currentEntry.createdAt).toLocaleString()}</span>}</div>
        {Boolean(currentEntry?.branchNames?.length) && <div className="mt-1 flex flex-wrap gap-1">{currentEntry?.branchNames?.map((name) => <span key={name} className={`rounded-full border px-1.5 py-0.5 text-xs ${name === 'main' ? 'border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'border-[var(--ds-status-info)]/30 bg-[var(--ds-status-info-soft)] text-[var(--ds-status-info)]'}`}>{name}</span>)}</div>}
      </div>
    </section>

    {(state?.status === 'unknown' || state?.operation || state?.synchronizationError) && <div className="rounded-md border border-[var(--ds-status-warning)]/35 bg-[var(--ds-status-warning-soft)] p-2 text-[var(--ds-status-warning)]">
      <span>{state.synchronizationError ? `版本信息同步失败：${state.synchronizationError}` : state.operation ? '版本操作状态待确认' : '现有版本信息需要同步'}</span>
      <DesktopButton disabled={busy} onClick={() => void reconcileMetadata()}>同步版本信息</DesktopButton>
    </div>}
    {error && <div role="alert" className="rounded-md border border-[var(--ds-status-danger)]/35 bg-[var(--ds-status-danger-soft)] px-2.5 py-2 text-[var(--ds-status-danger)] dark:border-[var(--ds-status-danger)]/35 dark:bg-[var(--ds-status-danger-soft)] dark:text-[var(--ds-status-danger)]">{error}</div>}
    {notice && <div role="status" className="rounded-md border border-[var(--ds-status-info)]/30 bg-[var(--ds-status-info-soft)] px-2.5 py-2 text-[var(--ds-status-info)]">{notice}</div>}

    {pendingRestore && <section role="alert" className="rounded-[var(--ds-radius-control)] border border-[var(--ds-status-warning)]/35 bg-[var(--ds-status-warning-soft)] p-2.5">
      <div className="flex items-center gap-1.5 font-semibold text-[var(--ds-status-warning)]"><span className="flex h-5 w-5 items-center justify-center rounded-full bg-[var(--ds-status-warning)] text-xs text-white">!</span>检测到恢复中断</div>
      <div className="mt-1 text-xs leading-relaxed text-[var(--ds-status-warning)]/80">目标版本：{pendingRestoreEntry?.title ?? pendingRestore.versionId}{!pendingRestore.sourceAvailable && pendingRestore.diagnostic ? ` · ${pendingRestore.diagnostic}` : ''}</div>
      <div className="mt-2 grid grid-cols-2 gap-1.5">
        <div className="rounded-md border border-[var(--ds-accent)]/30 bg-[var(--ds-surface-raised)] p-1.5 dark:border-[var(--ds-accent-strong)]/40 dark:bg-[var(--ds-surface-raised)]/80"><DesktopButton size="xs" variant="primary" disabled={busy || !canContinueRestore || !pendingRestoreEntry} onClick={() => pendingRestoreEntry && void restore(pendingRestoreEntry, true)}>{pendingRestore?.sourceIsTarget ? '完成恢复' : '继续恢复'}</DesktopButton><div className="mt-1 text-xs leading-relaxed text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">{pendingRestore.sameSourceBytes ? '原始字节未变，可安全继续。' : pendingRestore.sourceIsTarget ? '文件已匹配目标版本，只清理恢复记录。' : '仅在原文件未变或已等于目标版本时启用。'}</div></div>
        <div className="rounded-md border border-[var(--ds-border)] bg-[var(--ds-surface-raised)] p-1.5 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]/80"><DesktopButton size="xs" variant="subtle" disabled={busy || !canAbandonRestore} onClick={() => void abandonInterruptedRestore()}>保留当前文件</DesktopButton><div className="mt-1 text-xs leading-relaxed text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">{canAbandonRestore ? '解除阻塞只清除恢复记录，不覆盖文件。' : '仅在检测到外部改写且未匹配目标时启用。'}</div></div>
      </div>
    </section>}

    <form onSubmit={(event) => { event.preventDefault(); void createVersion() }} className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2.5 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
      <div className="mb-1.5 flex items-center gap-1.5"><Save className="h-3.5 w-3.5 text-[var(--ds-accent)]"/><div className="flex-1 font-semibold text-[var(--ds-text-primary)]">保存当前文件</div><span className="rounded-full bg-[var(--ds-accent-soft)] px-1.5 py-0.5 text-xs text-[var(--ds-accent)]">不可变快照</span></div>
      <div className="flex gap-1.5"><DesktopInput value={title} onChange={(event) => setTitle(event.target.value)} maxLength={240} placeholder="输入版本说明（可选）"/><DesktopButton type="submit" size="xs" variant="primary" icon={<Save className="h-3.5 w-3.5"/>} disabled={busy || Boolean(pendingRestore)}>保存版本</DesktopButton></div>
      <div className="mt-1.5 text-xs leading-relaxed text-[var(--ds-text-muted)]">只保存当前文件内容；原文件位置与名称保持不变。</div>
    </form>

    <section className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2.5 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
      <div className="mb-2 flex items-center gap-2"><History className="h-3.5 w-3.5 text-[var(--ds-accent)]"/><strong className="flex-1 text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">版本时间线</strong><span className="rounded-full bg-[var(--ds-surface-muted)] px-1.5 py-0.5 text-xs text-[var(--ds-text-muted)] dark:bg-[var(--ds-surface-muted)] dark:text-[var(--ds-text-subtle)]">{entries.length} 个版本</span></div>
      {!entries.length ? <div className="rounded-md border border-dashed border-[var(--ds-border)] px-3 py-5 text-center text-xs text-[var(--ds-text-subtle)]">{busy ? '正在读取 Lore…' : '还没有保存版本'}</div> : <div className="relative space-y-1.5 pl-3.5 before:absolute before:bottom-3 before:left-[5px] before:top-3 before:w-px before:bg-[var(--ds-border)]">
        {entries.map((entry) => <article key={entry.versionId} className="relative">
          <span className={`absolute -left-[12px] top-3.5 z-10 h-2.5 w-2.5 rounded-full border-2 border-white ${entry.isCurrent ? 'bg-[var(--ds-status-success)] ring-2 ring-[var(--ds-status-success-soft)] dark:border-[var(--ds-surface-raised)]' : 'bg-[var(--ds-border-strong)] dark:border-[var(--ds-surface-raised)]'}`} aria-label={entry.isCurrent ? '当前版本' : '历史版本'}/>
          <div className={`rounded-md border p-2 ${entry.isCurrent ? 'border-[var(--ds-status-success)]/35 bg-[var(--ds-status-success-soft)] dark:border-[var(--ds-status-success)]/35 dark:bg-[var(--ds-status-success-soft)]' : 'border-[var(--ds-border)] bg-[var(--ds-surface)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]'}`}>
            <div className="flex items-start gap-2"><div className="flex h-9 w-11 shrink-0 items-center justify-center overflow-hidden rounded border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">{previews[entry.versionId] ? <img src={previews[entry.versionId]} alt={`${entry.title} 预览`} className="h-full w-full object-cover"/> : <History className="h-4 w-4 text-[var(--ds-text-subtle)]"/>}</div>
              <div className="min-w-0 flex-1"><div className="flex items-center gap-1"><span className="truncate font-semibold text-[var(--ds-text-primary)]">v{entry.revisionNumber} · {entry.title}</span>{entry.isCurrent && <span className="shrink-0 rounded-full bg-[var(--ds-status-success-soft)] px-1.5 py-0.5 text-xs font-semibold text-[var(--ds-status-success)]">当前版本</span>}</div><div className="mt-0.5 text-xs text-[var(--ds-text-muted)]">{new Date(entry.createdAt).toLocaleString()} · {formatBytes(entry.sizeBytes)}</div>
                {Boolean(entry.branchNames?.length) && <div className="mt-1 flex flex-wrap gap-1">{entry.branchNames?.map((name) => <span key={name} className={`rounded-full border px-1.5 py-0.5 text-xs ${name === 'main' ? 'border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : 'border-[var(--ds-status-info)]/30 bg-[var(--ds-status-info-soft)] text-[var(--ds-status-info)]'}`}>{name}</span>)}</div>}
              </div>{!entry.isCurrent && !pendingRestore && <DesktopButton size="xs" variant="ghost" icon={<RotateCcw className="h-3 w-3"/>} disabled={busy} onClick={() => void restore(entry)}>恢复</DesktopButton>}</div>
          </div>
        </article>)}
      </div>}
    </section>

    <section className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2.5 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
      <div className="mb-2 flex items-center gap-2"><GitBranch className="h-3.5 w-3.5 text-[var(--ds-accent)]"/><strong className="flex-1 text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">分支与版本图谱</strong><span className="text-xs text-[var(--ds-text-subtle)]">{graph?.branches.length ?? 0} 条分支</span><DesktopButton size="xs" variant="ghost" disabled={busy || Boolean(pendingRestore) || !entries.length} onClick={createBranch}>新建</DesktopButton></div>
      {graph?.pendingMerge && <div className="mb-2 rounded-md border border-[var(--ds-status-warning)]/35 bg-[var(--ds-status-warning-soft)] p-2 text-[var(--ds-status-warning)]"><div className="font-semibold">待解决合并 · {graph.pendingMerge.conflictFiles.length} 个冲突</div><div className="mt-1.5 flex flex-wrap gap-1"><DesktopButton size="xs" variant="subtle" disabled={busy || Boolean(pendingRestore)} onClick={() => resolveMerge('ours')}>保留当前分支</DesktopButton><DesktopButton size="xs" variant="subtle" disabled={busy || Boolean(pendingRestore)} onClick={() => resolveMerge('theirs')}>采用来源分支</DesktopButton><DesktopButton size="xs" variant="ghost" disabled={busy || Boolean(pendingRestore)} onClick={() => void branchAction('abort', {})}>中止</DesktopButton></div></div>}
      <div className="space-y-1.5">{visibleBranches.map((branch) => <article key={branch.branchId} className={`rounded-md border p-2 ${branch.isCurrent ? 'border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] dark:border-[var(--ds-accent-strong)]/40 dark:bg-[var(--ds-accent-soft)]' : branch.isArchived ? 'border-[var(--ds-border)] bg-[var(--ds-surface-subtle)]' : 'border-[var(--ds-status-info)]/20 bg-[var(--ds-status-info-soft)] dark:border-[var(--ds-status-info)]/30 dark:bg-[var(--ds-status-info-soft)]'}`}>
        <div className="flex min-w-0 items-center gap-1.5"><span title={branch.name} className={`max-w-[52%] truncate rounded-full border px-1.5 py-0.5 text-xs font-semibold ${branch.isCurrent ? 'border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] text-[var(--ds-accent)]' : branch.isArchived ? 'border-[var(--ds-border)] bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)]' : 'border-[var(--ds-status-info)]/30 bg-[var(--ds-status-info-soft)] text-[var(--ds-status-info)]'}`}><GitBranch className="mr-0.5 inline h-2.5 w-2.5"/>{branch.name}</span>{branch.isCurrent && <span className="shrink-0 rounded-full bg-[var(--ds-status-success-soft)] px-1.5 py-0.5 text-xs text-[var(--ds-status-success)]">当前</span>}{branch.isArchived && <span className="shrink-0 rounded-full bg-[var(--ds-surface-muted)] px-1.5 py-0.5 text-xs text-[var(--ds-text-muted)]">已归档</span>}
          <div className="ml-auto flex shrink-0 items-center gap-1">{!branch.isCurrent && !branch.isArchived && <><DesktopButton size="xs" variant="ghost" disabled={busy || Boolean(pendingRestore)} title="切换分支" onClick={() => void branchAction('switch', { name: branch.name, overwrite: false })}>切换</DesktopButton><DesktopButton size="xs" variant="ghost" disabled={busy || Boolean(pendingRestore)} title="合并到当前分支" onClick={() => mergeBranch(branch)}>合并</DesktopButton><DesktopIconButton size="xs" variant="danger" disabled={busy || Boolean(pendingRestore)} tooltip="归档分支" icon={<Archive className="h-3 w-3"/>} onClick={() => void branchAction('archive', { name: branch.name })}/></>}</div>
        </div>
        <BranchRevisionTrack branch={branch}/>
      </article>)}
      {!graph?.branches.length && <div className="rounded-md border border-dashed border-[var(--ds-border)] px-3 py-4 text-center text-xs text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)]">保存第一个版本后可创建分支</div>}
      {Boolean(graph?.branches.some((branch) => branch.isArchived)) && <DesktopButton size="xs" variant="ghost" disabled={busy} onClick={() => setShowArchivedBranches((value) => !value)} className="mt-1 w-full justify-start">{showArchivedBranches ? '隐藏已归档分支' : `查看全部分支 · 已归档 ${graph?.branches.filter((branch) => branch.isArchived).length ?? 0} 条`} →</DesktopButton>}
      {Boolean(graph?.branches.length && !visibleBranches.length) && <div className="text-xs text-[var(--ds-text-subtle)]">当前没有可见分支。</div>}
      </div>
      <div className="mt-2 flex items-center gap-1 border-t border-[var(--ds-border)] pt-2 text-xs text-[var(--ds-text-muted)] dark:border-[var(--ds-border)]"><ShieldCheck className="h-3 w-3 text-[var(--ds-accent)]"/>恢复前会校验文件字节；分支操作由主进程记录。</div>
    </section>
  </div>
}

function BranchRevisionTrack({ branch }: { branch: Branch }): ReactElement {
  const chronological = [...branch.revisions].reverse()
  const visible = chronological.slice(-5)
  const omitted = Math.max(0, chronological.length - visible.length)
  const nodeTone = branch.isCurrent ? 'bg-[var(--ds-accent)] ring-[var(--ds-accent-soft)]' : branch.isArchived ? 'bg-[var(--ds-text-subtle)] ring-[var(--ds-surface-muted)]' : 'bg-[var(--ds-status-info)] ring-[var(--ds-status-info-soft)]'
  return <div className="mt-2 overflow-hidden">
    {!visible.length ? <div className="text-xs text-[var(--ds-text-subtle)]">暂无版本节点</div> : <div className="relative flex items-start gap-1 pt-0.5" aria-label={`${branch.name} 分支版本图`}>
      <div className="absolute left-2 right-2 top-[5px] h-px bg-[var(--ds-border)]"/>
      {omitted > 0 && <span className="relative z-10 shrink-0 rounded-full bg-[var(--ds-surface)] px-1 text-[length:var(--ds-type-data)] text-[var(--ds-text-muted)] dark:bg-[var(--ds-surface-raised)]">+{omitted}</span>}
      {visible.map((revision) => <div key={revision.versionId} className="relative z-10 flex min-w-0 flex-1 flex-col items-center text-center" title={`${revision.title} · ${new Date(revision.createdAt).toLocaleString()}`}><span className={`h-2 w-2 rounded-full ring-2 ${revision.versionId === branch.headRevisionId ? nodeTone : 'bg-[var(--ds-surface)] ring-[var(--ds-border-strong)]'}`}/><span className="mt-1 max-w-full truncate text-[length:var(--ds-type-data)] font-medium text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">v{revision.revisionNumber}</span><span className="max-w-full truncate text-[length:var(--ds-type-data)] text-[var(--ds-text-subtle)]">{new Date(revision.createdAt).toLocaleDateString()}</span></div>)}
    </div>}
  </div>
}

function formatBytes(value: number): string {
  if (!Number.isFinite(value) || value < 0) return '—'
  if (value < 1024) return `${value} B`
  const units = ['KB', 'MB', 'GB', 'TB']
  let size = value / 1024
  let unit = 0
  while (size >= 1024 && unit < units.length - 1) { size /= 1024; unit += 1 }
  return `${size.toFixed(1)} ${units[unit]}`
}
