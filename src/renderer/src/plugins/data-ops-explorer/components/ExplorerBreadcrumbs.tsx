import { useMemo } from 'react'
import type { ReactElement } from 'react'
import { ChevronRight, FolderTree, HardDrive, Tags, X } from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import { explorerStore, useExplorerShallow } from '../store'
import { splitPath } from '../format'

export function ExplorerBreadcrumbs(): ReactElement {
  const { DesktopButton } = useUiKit()
  const state = useExplorerShallow((s) => ({ path: s.path, tagFocus: s.tagFocus }))
  const segments = useMemo(() => splitPath(state.path), [state.path])

  if (state.tagFocus) {
    return (
      <div className="flex items-center gap-1 min-w-0 flex-1 overflow-hidden text-xs">
        <Tags className="w-3.5 h-3.5 text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)] shrink-0" />
        <span className="shrink-0 text-[var(--ds-text-subtle)]">标签聚合</span>
        <ChevronRight className="w-3 h-3 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)] shrink-0" />
        <span
          className="flex items-center gap-1 px-1.5 py-0.5 rounded-md whitespace-nowrap shrink-0 min-w-0 max-w-56 font-semibold text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)] bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)]"
          title={`显示标签「${state.tagFocus.name}」下的全部文件`}
        >
          <span className="truncate min-w-0">{state.tagFocus.name}</span>
        </span>
        <DesktopButton
          size="xs"
          variant="ghost"
          onClick={() => explorerStore.clearTagFocus()}
          title="退出标签聚合，返回目录浏览"
          className="!h-auto shrink-0 ml-1 !px-1.5 !py-0.5 rounded-md gap-1 text-[var(--ds-text-subtle)] hover:text-[var(--ds-text-secondary)]"
        >
          <X className="w-3 h-3" />
          <span className="whitespace-nowrap">退出聚合</span>
        </DesktopButton>
      </div>
    )
  }

  if (!state.path) {
    return <span className="text-xs text-[var(--ds-text-subtle)] whitespace-nowrap">未打开目录</span>
  }

  return (
    <div className="flex items-center gap-0.5 min-w-0 flex-1 overflow-hidden text-xs">
      <HardDrive className="w-3.5 h-3.5 text-[var(--ds-text-subtle)] shrink-0 mr-1" />
      {segments.map((segment, index) => {
        const isLast = index === segments.length - 1
        return (
          <span key={segment.path} className="flex items-center gap-0.5 min-w-0">
            {index > 0 && (
              <ChevronRight className="w-3 h-3 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)] shrink-0" />
            )}
            <DesktopButton
              size="xs"
              variant="ghost"
              active={isLast}
              onClick={() => explorerStore.navigate(segment.path)}
              className={`!h-auto !px-1.5 !py-0.5 rounded-md whitespace-nowrap gap-1 ${
                isLast
                  ? 'shrink-0 max-w-56 font-semibold'
                  : 'min-w-0 max-w-40 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]'
              }`}
              title={segment.path}
            >
              {isLast && <FolderTree className="w-3 h-3 shrink-0" />}
              <span className="truncate min-w-0">{segment.name}</span>
            </DesktopButton>
          </span>
        )
      })}
    </div>
  )
}
