import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { ChartNoAxesColumn, FolderSearch } from 'lucide-react'
import { useLayoutShallow, useUiKit, type SelectionItem } from '../../../workbench/sdk'
import { useSelectionSnapshot } from '../useSelectionSnapshot'
import { KIND_COLOR, KIND_LABEL, formatBytes } from '../format'

interface KindStat {
  kind: string
  count: number
  size: number
}

function StatCard({ label, value, hint }: { label: string; value: string; hint?: string }): ReactElement {
  return (
    <div className="rounded-xl border border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-raised)] px-3 py-2">
      <div className="text-xs text-[var(--ds-text-subtle)]">{label}</div>
      <div className="text-sm font-semibold text-[var(--ds-text-primary)] dark:text-white tabular-nums">{value}</div>
      {hint && <div className="text-xs text-[var(--ds-text-subtle)]">{hint}</div>}
    </div>
  )
}

export function AnalyticsPanel(): ReactElement | null {
  const { ThemeFloatingPanel } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const snapshot = useSelectionSnapshot()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'analytics'

  const stats = useMemo(() => {
    const byKind = new Map<string, KindStat>()
    let totalSize = 0
    let files = 0
    let folders = 0
    for (const entry of snapshot.entries) {
      if (entry.isDirectory) folders++
      else {
        files++
        totalSize += entry.size
      }
      const current = byKind.get(entry.kind) ?? { kind: entry.kind, count: 0, size: 0 }
      current.count++
      if (!entry.isDirectory) current.size += entry.size
      byKind.set(entry.kind, current)
    }
    const kinds = [...byKind.values()].sort((a, b) => b.count - a.count)
    const largest = [...snapshot.entries]
      .filter((entry) => !entry.isDirectory)
      .sort((a, b) => b.size - a.size)
      .slice(0, 5)
    const selectedSize = snapshot.selected.reduce((sum, entry) => sum + entry.size, 0)
    return { kinds, largest, totalSize, files, folders, selectedSize }
  }, [snapshot])

  const maxCount = stats.kinds.reduce((max, item) => Math.max(max, item.count), 0)

  const describe = (item: SelectionItem): string =>
    item.isDirectory ? '文件夹' : formatBytes(item.size)

  return (
    <ThemeFloatingPanel
      title="资产统计分析"
      icon={<ChartNoAxesColumn className="w-3.5 h-3.5" />}
      badge={snapshot.path ? `${snapshot.entries.length} 项` : undefined}
      isOpen={isOpen}
      onClose={closeFloatingPanel}
      initialX={180}
      initialY={90}
      initialWidth={520}
      initialHeight={430}
      minWidth={380}
      minHeight={300}
    >
      {!snapshot.path ? (
        <div className="flex flex-col items-center justify-center h-full gap-2 text-xs text-[var(--ds-text-subtle)]">
          <FolderSearch className="w-8 h-8 opacity-40" />
          <span>先在左侧打开一个目录，统计会实时更新</span>
        </div>
      ) : (
        <div className="flex flex-col gap-3">
          <div className="text-xs text-[var(--ds-text-subtle)] break-all">{snapshot.path}</div>

          <div className="grid grid-cols-3 gap-2">
            <StatCard label="条目" value={String(snapshot.entries.length)} hint={`${stats.folders} 文件夹`} />
            <StatCard label="文件" value={String(stats.files)} hint={`共 ${formatBytes(stats.totalSize)}`} />
            <StatCard
              label="已选中"
              value={String(snapshot.selected.length)}
              hint={snapshot.selected.length > 0 ? describe(snapshot.selected[0]) : '未选择'}
            />
          </div>

          <div className="flex flex-col gap-1.5">
            <div className="text-xs font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)]">类型分布</div>
            {stats.kinds.length === 0 && <span className="text-xs text-[var(--ds-text-subtle)]">当前目录为空</span>}
            {stats.kinds.map((item) => (
              <div key={item.kind} className="flex items-center gap-2">
                <span className="w-14 shrink-0 text-xs text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">
                  {KIND_LABEL[item.kind] ?? item.kind}
                </span>
                <div className="flex-1 h-2 rounded-full bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] overflow-hidden">
                  <div
                    className="h-full rounded-full"
                    style={{
                      width: `${maxCount > 0 ? Math.max(4, Math.round((item.count / maxCount) * 100)) : 0}%`,
                      backgroundColor: KIND_COLOR[item.kind] ?? 'var(--ds-text-muted)'
                    }}
                  />
                </div>
                <span className="w-8 shrink-0 text-right text-xs font-mono tabular-nums text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">
                  {item.count}
                </span>
                <span className="w-16 shrink-0 text-right text-xs font-mono tabular-nums text-[var(--ds-text-subtle)]">
                  {item.size > 0 ? formatBytes(item.size) : '—'}
                </span>
              </div>
            ))}
          </div>

          <div className="flex flex-col gap-1">
            <div className="text-xs font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)]">最大文件</div>
            {stats.largest.length === 0 && <span className="text-xs text-[var(--ds-text-subtle)]">没有文件</span>}
            {stats.largest.map((entry) => (
              <div key={entry.path} className="flex items-center gap-2 text-xs">
                <span className="flex-1 min-w-0 truncate text-[var(--ds-text-primary)] dark:text-[var(--ds-text-secondary)]" title={entry.path}>
                  {entry.name}
                </span>
                <span className="font-mono tabular-nums text-[var(--ds-text-subtle)] shrink-0">
                  {formatBytes(entry.size)}
                </span>
              </div>
            ))}
          </div>
        </div>
      )}
    </ThemeFloatingPanel>
  )
}
