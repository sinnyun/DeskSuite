import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { FolderOpen, RefreshCw } from 'lucide-react'
import { call, useUiKit } from '../../workbench/sdk'

interface StorageEntryInfo {
  label: string
  description?: string
  path: string
  kind: 'file' | 'directory'
  exists: boolean
  size: number
  files: number
}

interface StorageGroupInfo {
  plugin: string
  title: string
  entries: StorageEntryInfo[]
  size: number
  files: number
}

interface StorageSnapshot {
  userData: string
  groups: StorageGroupInfo[]
  size: number
  files: number
  measuredAt: number
}

function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = -1
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index += 1
  }
  if (index < 0) return `${Math.round(value)} B`
  return `${value >= 100 ? value.toFixed(0) : value.toFixed(1)} ${units[index]}`
}

export function StorageSettings(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopTagPill } = useUiKit()
  const [snapshot, setSnapshot] = useState<StorageSnapshot | null>(null)
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function refresh(): Promise<void> {
    setLoading(true)
    setError('')
    try {
      setSnapshot(await call<StorageSnapshot>('storage', 'list'))
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setLoading(false)
    }
  }

  async function open(path: string): Promise<void> {
    try {
      await call('storage', 'open', path)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => { void refresh() }, [])

  return <div className="space-y-3">
    <div className="flex items-center justify-between gap-3">
      <p className="text-xs text-[var(--ds-text-muted)]">插件数据保存在本机用户数据目录，占用大小按当前磁盘内容实时统计。</p>
      <DesktopIconButton size="xs" icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />} tooltip="重新统计" onClick={() => void refresh()} />
    </div>

    <div className="flex items-center justify-between rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
      <div>
        <p className="text-[11px] text-[var(--ds-text-muted)]">合计占用</p>
        <p className="text-base font-semibold text-[var(--ds-text-primary)] dark:text-white">{snapshot ? formatBytes(snapshot.size) : '统计中…'}</p>
      </div>
      <div className="text-right text-[11px] text-[var(--ds-text-muted)]">
        <p>{snapshot?.groups.length ?? 0} 个来源</p>
        <p>{snapshot?.files ?? 0} 个文件</p>
      </div>
    </div>

    {!snapshot && loading && <p className="text-xs text-[var(--ds-text-subtle)]">正在统计存储占用…</p>}
    {error && <p role="alert" className="rounded bg-[var(--ds-status-danger-soft)] p-2 text-xs text-[var(--ds-status-danger)]">{error}</p>}

    {(snapshot?.groups ?? []).map((group) => <section key={group.plugin} className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
      <div className="mb-2 flex flex-wrap items-center gap-2 border-b border-[var(--ds-border)] pb-2 dark:border-[var(--ds-border)]">
        <h3 className="text-xs font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{group.title}</h3>
        <span className="font-mono text-[10px] text-[var(--ds-text-subtle)]">{group.plugin}</span>
        <span className="ml-auto text-xs font-medium tabular-nums text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{formatBytes(group.size)}</span>
      </div>
      <div className="divide-y divide-[var(--ds-border)]">
        {group.entries.map((entry) => <div key={entry.path} className="flex items-start gap-3 py-2 first:pt-0 last:pb-0">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="text-xs font-medium text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">{entry.label}</span>
              <DesktopTagPill label={entry.kind === 'directory' ? '目录' : '文件'} variant="neutral" />
              {!entry.exists && <DesktopTagPill label="尚未创建" variant="neutral" />}
            </div>
            {entry.description && <p className="mt-0.5 text-[11px] text-[var(--ds-text-muted)]">{entry.description}</p>}
            <p title={entry.path} className="mt-1 break-all font-mono text-[10px] text-[var(--ds-text-subtle)]">{entry.path}</p>
          </div>
          <div className="flex shrink-0 flex-col items-end gap-1">
            <span className="text-xs tabular-nums text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{entry.exists ? formatBytes(entry.size) : '—'}</span>
            {entry.kind === 'directory' && entry.exists && <span className="text-[10px] text-[var(--ds-text-subtle)]">{entry.files} 个文件</span>}
            <DesktopButton size="xs" variant="subtle" icon={<FolderOpen className="h-3 w-3" />} disabled={!entry.exists} onClick={() => void open(entry.path)}>打开位置</DesktopButton>
          </div>
        </div>)}
      </div>
    </section>)}
  </div>
}
