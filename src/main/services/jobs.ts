import { randomUUID } from 'node:crypto'
import type { Context } from 'cordis'
import { Service } from 'cordis'
import { errorMessage, sanitizeErrorText } from './error-text.ts'
import { boundedSafeData } from './safe-data.ts'

export type JobState = 'running' | 'done' | 'failed' | 'canceled'

export interface JobOptions {
  label: string
  total?: number
  cancelable?: boolean
}

export interface JobSnapshot {
  id: string
  label: string
  state: JobState
  done: number
  total?: number
  detail?: string
  startedAt: number
  endedAt?: number
  error?: string
  summary?: unknown
  cancelable: boolean
}

export interface Job {
  readonly id: string
  readonly signal: AbortSignal
  progress(done: number, detail?: string): void
  finish(summary?: unknown): void
  fail(error: unknown): void
  snapshot(): JobSnapshot
}

declare module 'cordis' {
  interface Context {
    jobs: JobsService
  }
}

const PROGRESS_INTERVAL_MS = 100
const KEEP_FINISHED = 50
const MAX_JOB_LABEL_CHARS = 500
const MAX_JOB_DETAIL_CHARS = 2_000
const MAX_JOB_SUMMARY_BYTES = 48 * 1024

interface JobSink {
  emit(channel: 'job:progress' | 'job:done', snapshot: JobSnapshot): void
  settle(id: string): void
}

class JobHandle implements Job {
  readonly id = `job_${randomUUID().slice(0, 8)}`
  readonly cancelable: boolean
  readonly signal: AbortSignal

  private readonly controller = new AbortController()
  private readonly label: string
  private readonly total?: number
  private readonly startedAt = Date.now()
  private readonly sink: JobSink
  private state: JobState = 'running'
  private done = 0
  private detail?: string
  private endedAt?: number
  private error?: string
  private summary?: unknown
  private lastProgressAt = 0
  private progressTimer: ReturnType<typeof setTimeout> | null = null

  constructor(options: JobOptions, sink: JobSink) {
    this.label = sanitizeErrorText(options.label, MAX_JOB_LABEL_CHARS)
    this.total = options.total
    this.cancelable = options.cancelable ?? false
    this.sink = sink
    this.signal = this.controller.signal
  }

  progress(done: number, detail?: string): void {
    if (this.state !== 'running') return
    this.done = done
    if (detail !== undefined) this.detail = sanitizeErrorText(detail, MAX_JOB_DETAIL_CHARS)
    const wait = this.lastProgressAt + PROGRESS_INTERVAL_MS - Date.now()
    if (wait <= 0) {
      this.emitProgress()
      return
    }
    if (this.progressTimer) return
    this.progressTimer = setTimeout(() => {
      this.progressTimer = null
      this.emitProgress()
    }, wait)
    ;(this.progressTimer as { unref?: () => void }).unref?.()
  }

  finish(summary?: unknown): void {
    if (this.state !== 'running') return
    this.state = 'done'
    this.endedAt = Date.now()
    this.summary = summary === undefined ? undefined : boundedSafeData(summary, MAX_JOB_SUMMARY_BYTES, '任务摘要超过 48 KiB 限制')
    this.settle()
  }

  fail(error: unknown): void {
    if (this.state !== 'running') return
    this.state = 'failed'
    this.endedAt = Date.now()
    this.error = errorMessage(error, '任务执行失败')
    this.settle()
  }

  cancel(): boolean {
    if (!this.cancelable || this.state !== 'running') return false
    this.state = 'canceled'
    this.endedAt = Date.now()
    this.controller.abort()
    this.settle()
    return true
  }

  snapshot(): JobSnapshot {
    const snapshot: JobSnapshot = {
      id: this.id,
      label: this.label,
      state: this.state,
      done: this.done,
      startedAt: this.startedAt,
      cancelable: this.cancelable
    }
    if (this.total !== undefined) snapshot.total = this.total
    if (this.detail !== undefined) snapshot.detail = this.detail
    if (this.endedAt !== undefined) snapshot.endedAt = this.endedAt
    if (this.error !== undefined) snapshot.error = this.error
    if (this.summary !== undefined) snapshot.summary = this.summary
    return snapshot
  }

  private emitProgress(): void {
    if (this.state !== 'running') return
    this.lastProgressAt = Date.now()
    this.sink.emit('job:progress', this.snapshot())
  }

  private settle(): void {
    if (this.progressTimer) {
      clearTimeout(this.progressTimer)
      this.progressTimer = null
    }
    this.sink.emit('job:done', this.snapshot())
    this.sink.settle(this.id)
  }
}

export class JobsService extends Service {
  private records = new Map<string, JobHandle>()
  private finished: string[] = []

  constructor(ctx: Context) {
    super(ctx, 'jobs')
  }

  create(options: JobOptions): Job {
    const job = new JobHandle(options, {
      emit: (channel, snapshot) => this.ctx.ipc.broadcast(channel, snapshot),
      settle: (id) => this.retire(id)
    })
    this.records.set(job.id, job)
    return job
  }

  get(id: string): Job | undefined {
    return this.records.get(id)
  }

  list(): JobSnapshot[] {
    const snapshots = [...this.records.values()].map((job) => job.snapshot())
    const running = snapshots
      .filter((item) => item.state === 'running')
      .sort((a, b) => b.startedAt - a.startedAt)
    const settled = snapshots
      .filter((item) => item.state !== 'running')
      .sort((a, b) => b.startedAt - a.startedAt)
    return [...running, ...settled]
  }

  cancel(id: string): boolean {
    return this.records.get(id)?.cancel() ?? false
  }

  private retire(id: string): void {
    this.finished.push(id)
    while (this.finished.length > KEEP_FINISHED) {
      const evicted = this.finished.shift()
      if (evicted) this.records.delete(evicted)
    }
  }
}
