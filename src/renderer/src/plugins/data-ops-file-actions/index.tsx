import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { DragEvent, ReactElement } from 'react'
import { call, definePlugin, getService, useUiKit, type SelectionService, type SelectionSnapshot } from '../../workbench/sdk'

export default definePlugin({
  id: 'data-ops-file-actions',
  name: '文件操作',
  version: '1.0.0',
  description: '提供文件操作菜单、人工批准和任务进度',
  author: 'DeskSuite 内置',
  contributions: [
    {
      id: 'file-actions.overlay',
      slotId: 'overlay.root',
      order: 20,
      component: FileActionsOverlay
    }
  ]
})

export type FileOperation = 'copy' | 'move' | 'rename' | 'mkdir' | 'trash'
export type ConflictPolicy = 'skip' | 'overwrite' | 'rename' | 'cancel'

export interface FileOperationPlan {
  planId: string
  op: FileOperation
  sources: string[]
  target?: string
  conflictPolicy: ConflictPolicy
  createdAt: number
  expiresAt: number
  items: Array<{
    source?: string
    target: string
    sourceFingerprint?: {
      size: number
      mtimeMs: number
      mode: number
      isDirectory: boolean
      isSymbolicLink: boolean
    }
    targetFingerprint: null | {
      size: number
      mtimeMs: number
      mode: number
      isDirectory: boolean
      isSymbolicLink: boolean
    }
  }>
}

export interface FileOperationResult {
  source?: string
  target: string
  status: 'completed' | 'skipped' | 'conflict' | 'failed' | 'stale'
  message?: string
}

export interface JobSnapshot {
  id: string
  label: string
  state: 'running' | 'done' | 'failed' | 'canceled'
  done: number
  total?: number
  detail?: string
  startedAt: number
  endedAt?: number
  error?: string
  summary?: unknown
  cancelable: boolean
}

export interface UndoEntry {
  undoId: string
  op: 'move' | 'rename' | 'mkdir'
  source?: string
  target: string
  createdAt: number
}

export type UndoResult =
  | { jobId: string; undoId: string }
  | { undoId: string; status: 'stale' | 'conflict'; message: string }

export function FileActionsOverlay(): ReactElement {
  const { DesktopButton } = useUiKit()
  const selectionService = getService<SelectionService>('selection')
  const selection = useSyncExternalStore(
    selectionService?.subscribe ?? NOOP_SUBSCRIBE,
    selectionService?.getSnapshot ?? EMPTY_SELECTION
  )
  const selectedPaths = useMemo(() => selection.selected.map((item) => item.path), [selection])
  const [menu, setMenu] = useState<{ x: number; y: number } | null>(null)
  const [plan, setPlan] = useState<FileOperationPlan | null>(null)
  const [commandPlanId, setCommandPlanId] = useState<string | null>(null)
  const [conflictPolicy, setConflictPolicy] = useState<ConflictPolicy>('skip')
  const [jobs, setJobs] = useState<JobSnapshot[]>([])
  const [jobResults, setJobResults] = useState<Record<string, FileOperationResult[]>>({})
  const [undoStack, setUndoStack] = useState<UndoEntry[]>([])
  const [error, setError] = useState<string | null>(null)
  const conflictCount = plan?.items.filter((item) => plan.op !== 'trash' && item.targetFingerprint !== null).length ?? 0
  const plannedBytes = plan?.items.reduce((total, item) => total + (item.sourceFingerprint?.size ?? 0), 0) ?? 0

  useEffect(() => {
    const unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel === 'fileOps:undo-stack') {
        setUndoStack(Array.isArray(payload) ? payload as UndoEntry[] : [])
      } else if (channel === 'fileOps:approval') {
        const request = payload as { planId?: string }
        if (request?.planId) void loadPlan(request.planId)
      } else if (channel === 'job:progress' || channel === 'job:done') {
        const snapshot = payload as JobSnapshot
        if (!snapshot?.id) return
        setJobs((current) => {
          const next: JobSnapshot = snapshot
          return [next, ...current.filter((job) => job.id !== next.id)].slice(0, 8)
        })
      } else if (channel === 'fileOps:done') {
        const result = payload as { jobId?: string; results?: FileOperationResult[] }
        if (result?.jobId && Array.isArray(result.results)) {
          setJobResults((current) => ({ ...current, [result.jobId!]: result.results! }))
        }
        const failed = result?.results?.filter((item) => item.status === 'failed' || item.status === 'stale') ?? []
        if (failed.length) setError(`${failed.length} 项未完成，请查看任务进度`)
      }
    })
    void loadUndoStack()
    const handleContextMenu = (event: MouseEvent): void => {
      if (!selectionService || !selectionService.getSnapshot().path) return
      if (!(event.target instanceof Element) || !event.target.closest('[data-file-workspace]')) return
      event.preventDefault()
      setMenu({ x: event.clientX, y: event.clientY })
    }
    const dismiss = (): void => setMenu(null)
    document.addEventListener('contextmenu', handleContextMenu, true)
    window.addEventListener('click', dismiss)
    window.addEventListener('keydown', dismissOnEscape)
    return () => {
      unsubscribe()
      document.removeEventListener('contextmenu', handleContextMenu, true)
      window.removeEventListener('click', dismiss)
      window.removeEventListener('keydown', dismissOnEscape)
    }
  }, [selectionService])

  async function loadPlan(planId: string): Promise<void> {
    try {
      const next = await call<FileOperationPlan | null>('fileOps', 'get', planId)
      if (next) {
        setPlan(next)
        setConflictPolicy(next.conflictPolicy)
        setMenu(null)
      }
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function loadUndoStack(): Promise<void> {
    try {
      const stack = await call<UndoEntry[]>('fileOps', 'getUndoStack')
      setUndoStack(Array.isArray(stack) ? stack : [])
    } catch {
      // F1-1 may be temporarily unavailable while plugins are starting or stopping.
    }
  }

  async function createPlan(op: FileOperation): Promise<void> {
    setMenu(null)
    const sources = selectedPaths
    if (op !== 'mkdir' && !sources.length) return
    let target: string | undefined
    if (op === 'copy' || op === 'move' || op === 'rename') {
      target = window.prompt(op === 'rename' ? '请输入新的完整路径' : '请输入目标目录完整路径')?.trim()
      if (!target) return
    } else if (op === 'mkdir') {
      const parent = selection.path
      if (!parent) return
      target = window.prompt('请输入新目录的完整路径', parent)?.trim()
      if (!target) return
    }
    try {
      const response = await call<{ requiresApproval?: boolean; planId?: string; plan?: FileOperationPlan }>(
        'commands', 'run', `file.${op}`, {
          sources: op === 'mkdir' ? [] : sources,
          target,
          conflictPolicy: 'skip'
        }
      )
      if (!response.requiresApproval || !response.planId || !response.plan) throw new Error('文件命令未生成批准计划')
      setPlan(response.plan)
      setCommandPlanId(response.planId)
      setConflictPolicy(response.plan.conflictPolicy)
      setError(null)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function replan(policy: ConflictPolicy): Promise<void> {
    setConflictPolicy(policy)
    if (!plan) return
    try {
      if (commandPlanId) {
        await call('commands', 'approve', commandPlanId, false)
        const response = await call<{ requiresApproval?: boolean; planId?: string; plan?: FileOperationPlan }>(
          'commands', 'run', `file.${plan.op}`, { sources: plan.sources, target: plan.target, conflictPolicy: policy }
        )
        if (!response.requiresApproval || !response.planId || !response.plan) throw new Error('文件命令未生成批准计划')
        setPlan(response.plan)
        setCommandPlanId(response.planId)
      } else {
        await call('fileOps', 'reject', plan.planId)
        const next = await call<FileOperationPlan>('fileOps', 'plan', {
          op: plan.op, sources: plan.sources, target: plan.target, conflictPolicy: policy
        })
        setPlan(next)
      }
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function approve(): Promise<void> {
    if (!plan) return
    try {
      let started: { jobId: string }
      if (commandPlanId) {
        await call('commands', 'approve', commandPlanId, true)
        started = await call<{ jobId: string }>('commands', 'execute', commandPlanId)
      } else {
        await call('fileOps', 'approve', plan.planId)
        started = await call<{ jobId: string }>('fileOps', 'execute', plan.planId)
      }
      setPlan(null)
      setCommandPlanId(null)
      setError(null)
      setJobs((current) => {
        const next: JobSnapshot = { id: started.jobId, label: operationTitle(plan.op), state: 'running', done: 0, total: plan.items.length, startedAt: Date.now(), cancelable: true }
        return [next, ...current.filter((job) => job.id !== next.id)].slice(0, 8)
      })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function reject(): Promise<void> {
    if (!plan) return
    try {
      if (commandPlanId) await call('commands', 'approve', commandPlanId, false)
      else await call('fileOps', 'reject', plan.planId)
    } catch (cause) {
      setError(messageOf(cause))
    }
    setPlan(null)
    setCommandPlanId(null)
  }

  async function startDrag(event: DragEvent<HTMLButtonElement>): Promise<void> {
    event.preventDefault()
    setMenu(null)
    try {
      await call('fileOps', 'startDrag', selectedPaths)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function cancelJob(jobId: string): Promise<void> {
    try {
      await call('fileOps', 'cancel', jobId)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function undo(undoId?: string): Promise<void> {
    const entry = undoStack.find((item) => item.undoId === undoId) ?? undoStack[0]
    if (!entry) return
    try {
      const result = await call<UndoResult>('fileOps', 'undo', entry.undoId)
      if ('jobId' in result) {
        setJobs((current) => {
          const next: JobSnapshot = {
            id: result.jobId,
            label: `撤销${undoTitle(entry.op)}`,
            state: 'running',
            done: 0,
            total: 1,
            startedAt: Date.now(),
            cancelable: true
          }
          return [next, ...current.filter((job) => job.id !== next.id)].slice(0, 8)
        })
        setError(null)
      } else {
        setError(`${result.status === 'stale' ? '撤销内容已发生变化' : '撤销目标存在冲突'}：${result.message}`)
      }
      await loadUndoStack()
    } catch (cause) {
      setError(messageOf(cause))
      await loadUndoStack()
    }
  }

  return (
    <div className="fixed inset-0 z-[100] pointer-events-none">
      {menu && (
        <div
          className="pointer-events-auto fixed z-[102] w-48 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-1 shadow-xl dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"
          style={{ left: menu.x, top: menu.y }}
          onClick={(event) => event.stopPropagation()}
        >
          {(['copy', 'move', 'rename', 'mkdir', 'trash'] as FileOperation[]).map((op) => (
            <DesktopButton key={op} variant="ghost" size="sm" className="block w-full justify-start text-left" onClick={() => void createPlan(op)}>
              {operationTitle(op)}…
            </DesktopButton>
          ))}
          <div className="my-1 border-t border-[var(--ds-border)] dark:border-[var(--ds-border)]" />
          <DesktopButton draggable variant="ghost" size="sm" onDragStart={(event) => void startDrag(event)} className="block w-full cursor-grab justify-start text-left">
            按住拖到其他应用
          </DesktopButton>
        </div>
      )}

      {plan && (
        <div className="pointer-events-auto fixed inset-0 z-[103] flex items-center justify-center bg-black/35 p-4">
          <section className="flex max-h-[80vh] w-[520px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] shadow-2xl dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
            <header className="flex shrink-0 items-center justify-between border-b border-[var(--ds-border)] px-4 py-3 dark:border-[var(--ds-border)]">
              <h2 className="font-semibold">批准{operationTitle(plan.op)}</h2>
              <DesktopButton variant="ghost" size="xs" onClick={() => void reject()}>关闭</DesktopButton>
            </header>
            <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
              <p>将处理 {plan.items.length} 项，其中 {conflictCount} 项目标已存在，约 {formatBytes(plannedBytes)}。</p>
              <p className="mt-1 break-all text-[var(--ds-text-muted)]">目标：{plan.target ?? '按计划逐项处理'}</p>
              <label className="mt-4 flex items-center gap-2">
                <span>目标冲突处理</span>
                <select className="rounded border border-[var(--ds-border)] bg-transparent px-2 py-1 dark:border-[var(--ds-border)]" value={conflictPolicy} onChange={(event) => void replan(event.target.value as ConflictPolicy)}>
                  <option value="skip">跳过</option>
                  <option value="overwrite">覆盖</option>
                  <option value="rename">自动改名</option>
                  <option value="cancel">取消整项</option>
                </select>
              </label>
              <details className="mt-4 rounded border border-[var(--ds-border)] p-2 dark:border-[var(--ds-border)]">
                <summary className="cursor-pointer">查看 {plan.items.length} 项路径</summary>
                <ul className="mt-2 max-h-48 space-y-1 overflow-auto font-mono text-xs">
                  {plan.items.map((item, index) => <li key={`${item.target}:${index}`} className="break-all">{item.source ? `${item.source} → ` : ''}{item.target}</li>)}
                </ul>
              </details>
              <p className="mt-3 text-xs text-[var(--ds-text-muted)]">计划有效期至 {new Date(plan.expiresAt).toLocaleTimeString()}</p>
            </div>
            <footer className="flex shrink-0 justify-end gap-2 border-t border-[var(--ds-border)] p-3 dark:border-[var(--ds-border)]">
              <DesktopButton variant="default" size="sm" onClick={() => void reject()}>拒绝</DesktopButton>
              <DesktopButton variant="primary" size="sm" onClick={() => void approve()}>批准并执行</DesktopButton>
            </footer>
          </section>
        </div>
      )}

      {(jobs.length > 0 || undoStack.length > 0 || error) && (
        <section className="pointer-events-auto fixed bottom-4 right-4 z-[101] flex h-[300px] w-[380px] max-w-[calc(100vw-32px)] flex-col overflow-hidden rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] bg-[var(--ds-surface-raised)] shadow-2xl backdrop-blur">
          <header className="flex h-10 shrink-0 items-center justify-between border-b border-[var(--ds-border)] px-3 dark:border-[var(--ds-border)]">
            <strong className="text-sm">文件操作进度</strong>
            <DesktopButton variant="ghost" size="xs" onClick={() => { setJobs([]); setJobResults({}); setError(null) }}>清除</DesktopButton>
          </header>
          <div className="min-h-0 flex-1 space-y-2 overflow-auto p-3">
            {error && <p role="alert" className="rounded bg-[var(--ds-status-danger-soft)] p-2 text-xs text-[var(--ds-status-danger)]">{error}</p>}
            {undoStack.length > 0 && (
              <article className="flex items-center justify-between gap-2 rounded-lg border border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] p-2 dark:border-[var(--ds-accent-strong)]/40 dark:bg-[var(--ds-accent-soft)]">
                <div className="min-w-0 text-xs">
                  <div className="font-medium">可撤销：{undoTitle(undoStack[0].op)}</div>
                  <div className="truncate text-[var(--ds-text-muted)]" title={undoStack[0].target}>{undoStack[0].target}</div>
                </div>
                <DesktopButton variant="subtle" size="xs" className="shrink-0" onClick={() => void undo(undoStack[0].undoId)}>撤销</DesktopButton>
              </article>
            )}
            {jobs.map((job) => {
              const percent = job.total ? Math.min(100, Math.round(job.done * 100 / job.total)) : 0
              const active = job.state === 'running'
              return <article key={job.id} className="rounded-lg border border-[var(--ds-border)] p-2 dark:border-[var(--ds-border)]">
                <div className="flex items-center justify-between gap-2 text-xs">
                  <span className="truncate font-medium">{job.label}</span>
                  <span>{job.state === 'done' ? '完成' : job.state === 'failed' ? '失败' : job.state === 'canceled' ? '已取消' : `${percent}%`}</span>
                </div>
                <div className="mt-2 h-1.5 overflow-hidden rounded bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)]"><div className="h-full bg-[var(--ds-accent)]" style={{ width: `${percent}%` }} /></div>
                <div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--ds-text-muted)]">
                  <span className="truncate">{job.detail ?? job.error ?? (job.total ? `${job.done}/${job.total}` : '正在处理')}</span>
                  {active && job.cancelable && <DesktopButton variant="danger" size="xs" className="shrink-0" onClick={() => void cancelJob(job.id)}>取消</DesktopButton>}
                </div>
                {jobResults[job.id]?.length ? (
                  <details className="mt-2 border-t border-[var(--ds-border)] pt-2 text-xs dark:border-[var(--ds-border)]">
                    <summary className="cursor-pointer">逐项结果（{jobResults[job.id].length}）</summary>
                    <ul className="mt-1 max-h-28 space-y-1 overflow-auto">
                      {jobResults[job.id].map((item, index) => (
                        <li key={`${item.target}:${index}`} className="break-all">
                          <span className={item.status === 'completed' ? 'text-[var(--ds-status-success)] dark:text-[var(--ds-status-success)]' : item.status === 'failed' || item.status === 'stale' ? 'text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]' : 'text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]'}>
                            {resultTitle(item.status)}
                          </span>{' '}{item.source ? `${item.source} → ` : ''}{item.target}{item.message ? `：${item.message}` : ''}
                        </li>
                      ))}
                    </ul>
                  </details>
                ) : null}
              </article>
            })}
          </div>
        </section>
      )}
    </div>
  )
}

function dismissOnEscape(event: KeyboardEvent): void {
  if (event.key === 'Escape') window.dispatchEvent(new MouseEvent('click'))
}

const NOOP_SUBSCRIBE = (): (() => void) => () => {}
const EMPTY_SELECTION = (): SelectionSnapshot => ({ path: null, entries: [], selected: [] })

function operationTitle(op: FileOperation): string {
  return ({ copy: '复制文件', move: '移动文件', rename: '重命名', mkdir: '新建目录', trash: '移到回收站' })[op]
}

function undoTitle(op: UndoEntry['op']): string {
  return ({ move: '移动', rename: '重命名', mkdir: '新建目录' })[op]
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`
  if (bytes < 1024 ** 2) return `${(bytes / 1024).toFixed(1)} KB`
  if (bytes < 1024 ** 3) return `${(bytes / 1024 ** 2).toFixed(1)} MB`
  return `${(bytes / 1024 ** 3).toFixed(1)} GB`
}

function resultTitle(status: FileOperationResult['status']): string {
  return ({ completed: '完成', skipped: '跳过', conflict: '冲突', failed: '失败', stale: '已变化' })[status]
}
