import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import {
  Archive,
  Copy,
  Download,
  ExternalLink,
  FolderOpen,
  MapPin,
  Plus,
  RefreshCw,
  Star,
  X
} from 'lucide-react'
import {
  call,
  errorText,
  getService,
  log,
  useUiKit,
  type BasketService
} from '../../../workbench/sdk'
import {
  explorerStore,
  useExplorerShallow,
  visibleEntries,
  type FsEntry
} from '../store'
import { dragFiles } from '../drag'
import { metadataStore, useEntryMeta } from '../metadata'
import { EntryIcon } from '../EntryIcon'
import { KIND_LABEL, formatBytes, formatDate } from '../format'
import { usePreview } from '../usePreview'

const PREVIEW_LINE_LIMIT = 400

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return (
    <div className="flex items-start justify-between gap-3 py-1">
      <span className="text-xs text-[var(--ds-text-subtle)] shrink-0">{label}</span>
      <span className="text-xs text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)] text-right break-all">{value}</span>
    </div>
  )
}

const sectionCard = 'rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-2.5 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]'

function EntryDetail({ entry }: { entry: FsEntry }): ReactElement {
  const {
    DesktopButton,
    DesktopIconButton,
    DesktopInput,
    DesktopTagPill,
    ThemeCollapsibleSection
  } = useUiKit()
  const state = useExplorerShallow((s) => ({
    path: s.path, entries: s.entries, search: s.search, kindFilter: s.kindFilter, favoriteOnly: s.favoriteOnly,
    minRating: s.minRating, tagFilter: s.tagFilter, sortField: s.sortField, sortOrder: s.sortOrder
  }))
  const preview = usePreview(entry)
  const meta = useEntryMeta(entry.path)
  const [tagDraft, setTagDraft] = useState('')
  const basketAvailable = getService<BasketService>('basket') !== undefined

  useEffect(() => {
    setTagDraft('')
  }, [entry.path])

  const copyPath = async (): Promise<void> => {
    try {
      await call('clipboard', 'writeText', entry.path)
      log('event', 'Inspector', '已复制路径到剪贴板')
    } catch (error) {
      log('error', 'Inspector', '复制路径失败', errorText(error, '复制路径失败'))
    }
  }

  const previewLines = useMemo(() => {
    if (preview.status !== 'text') return []
    return preview.content.split('\n').slice(0, PREVIEW_LINE_LIMIT)
  }, [preview])

  const copyPreview = async (): Promise<void> => {
    if (preview.status !== 'text') return
    try {
      await call('clipboard', 'writeText', preview.content)
      log('event', 'Inspector', '已复制文件内容到剪贴板')
    } catch (error) {
      log('error', 'Inspector', '复制文件内容失败', errorText(error, '复制文件内容失败'))
    }
  }

  const exportMetadata = async (): Promise<void> => {
    const payload = {
      generatedAt: new Date().toISOString(),
      directory: state.path,
      entries: visibleEntries(state).map((item) => ({
        path: item.path,
        name: item.name,
        kind: item.kind,
        size: item.size,
        modifiedAt: item.modifiedAt,
        meta: metadataStore.get(item.path)
      }))
    }
    try {
      const plan = await call<{ planId: string; target: string } | null>(
        'fileOps',
        'saveText',
        'desksuite-目录清单.json',
        JSON.stringify(payload, null, 2),
        'json'
      )
      if (!plan) return
      if (!window.confirm(`将通过文件操作计划写入目录清单：\n${plan.target}\n\n批准后开始写入？`)) {
        await call('fileOps', 'cancel', plan.planId)
        return
      }
      await call('fileOps', 'approve', plan.planId)
      const { jobId } = await call<{ jobId: string }>('fileOps', 'execute', plan.planId)
      log('event', 'Inspector', `已批准目录清单写入任务：${jobId}`)
    } catch (error) {
      log('error', 'Inspector', '导出目录清单失败', errorText(error, '导出目录清单失败'))
    }
  }

  const addTag = (): void => {
    if (!tagDraft.trim()) return
    if (explorerStore.addTag(entry.path, tagDraft)) {
      log('event', 'Inspector', `已添加标签：${tagDraft.trim()}`, { path: entry.path })
    }
    setTagDraft('')
  }

  return (
    <>
      <div className="flex items-start gap-2.5 border-b border-[var(--ds-border)] pb-4 dark:border-[var(--ds-border)]">
        <div className="w-10 h-10 rounded-xl bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-raised)] border border-[var(--ds-border)] dark:border-[var(--ds-border)] flex items-center justify-center shrink-0">
          <EntryIcon kind={entry.kind} className="w-5 h-5" />
        </div>
        <div className="min-w-0 flex-1">
          <div className="font-semibold text-[var(--ds-text-primary)] dark:text-white break-all leading-snug">
            {entry.name}
          </div>
          <div className="text-xs text-[var(--ds-text-subtle)] mt-0.5">{KIND_LABEL[entry.kind]} · {entry.isDirectory ? '文件夹' : formatBytes(entry.size)}</div>
        </div>
        <DesktopIconButton
          size="xs"
          active={meta.favorite}
          icon={<Star className={`w-3.5 h-3.5 ${meta.favorite ? 'fill-current text-[var(--ds-status-warning)]' : ''}`} />}
          tooltip={meta.favorite ? '取消收藏' : '添加收藏'}
          onClick={() => explorerStore.toggleFavorite(entry.path)}
        />
      </div>

      <ThemeCollapsibleSection title="内容预览">
        {preview.status === 'loading' && <span className="flex items-center gap-1.5 text-xs text-[var(--ds-text-subtle)]"><RefreshCw className="w-3 h-3 animate-spin" />正在读取内容…</span>}
        {preview.status === 'idle' && <span className="text-xs text-[var(--ds-text-subtle)]">—</span>}
        {preview.status === 'unsupported' && <span className="text-xs text-[var(--ds-text-subtle)] break-all">{preview.message}</span>}
        {preview.status === 'image' && <div draggable onDragStart={(event) => dragFiles(event, entry)} className="overflow-hidden rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-1 dark:border-[var(--ds-border)] dark:bg-[var(--ds-workspace-dark)]"><img src={preview.dataUrl} alt={entry.name} draggable={false} className="max-h-64 w-full object-contain" /></div>}
        {preview.status === 'media' && entry.kind === 'audio' && <audio controls src={preview.dataUrl} className="w-full" />}
        {preview.status === 'media' && entry.kind === 'video' && <video controls src={preview.dataUrl} className="max-h-64 w-full rounded-lg bg-black" />}
        {preview.status === 'text' && <><div className="mb-1 flex items-center justify-between"><span className="text-xs text-[var(--ds-text-subtle)]">{preview.content.split('\n').length} 行 · {preview.content.length} 字符</span><DesktopIconButton size="xs" icon={<Copy className="w-3 h-3" />} tooltip="复制文件内容" onClick={() => void copyPreview()} /></div><pre className="max-h-64 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] p-2 font-mono text-xs dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-code)]">{previewLines.join('\n')}{preview.truncated ? '\n…内容已截断' : ''}</pre></>}
      </ThemeCollapsibleSection>

      <ThemeCollapsibleSection title="属性明细" badge={KIND_LABEL[entry.kind]}>
        <div className={`${sectionCard} px-2.5 py-1.5`}>
          <Field label="完整路径" value={entry.path} />
          <Field label="文件大小" value={entry.isDirectory ? '—' : formatBytes(entry.size)} />
          <Field label="最后修改" value={formatDate(entry.modifiedAt)} /><Field label="类型" value={entry.kind} /><Field label="资产名称" value={entry.name} />
        </div>
      </ThemeCollapsibleSection>

      <section className="border-y border-[var(--ds-border)] py-2 dark:border-[var(--ds-border)]">
        <div className="flex items-center gap-1.5">
          <span className="text-xs text-[var(--ds-text-subtle)] shrink-0">质量评分</span>
          {[1, 2, 3, 4, 5].map((rating) => (
            <DesktopIconButton key={rating} role="radio" aria-checked={meta.rating === rating}
              aria-label={`${rating} 星`} tooltip={`${rating} 星`}
              icon={<Star className={`h-5 w-5 ${rating <= meta.rating ? 'fill-[var(--ds-status-warning)]' : 'text-[var(--ds-text-secondary)]'}`} />}
              onClick={() => explorerStore.setRating(entry.path, rating)}
              className="!text-[var(--ds-status-warning)] hover:!bg-[var(--ds-status-warning-soft)]" />
          ))}
          <span className="ml-1 text-xs text-[var(--ds-text-subtle)]">{meta.rating ? `${meta.rating} 星` : '未评分'}</span>
        </div>
        </section>

        <ThemeCollapsibleSection title="关联标签" badge={meta.tags.length}>
        <div className="flex flex-wrap items-center gap-1.5 mt-1">
          {meta.tags.map((tag) => (
            <DesktopTagPill
              key={tag}
              label={tag}
              variant="blue"
              onClick={() => explorerStore.removeTag(entry.path, tag)}
            />
          ))}
          {meta.tags.length === 0 && (
            <span className="text-xs text-[var(--ds-text-muted)]">暂无标签，添加后可用于筛选</span>
          )}
        </div>

        <div className="flex items-center gap-1.5 mt-1">
          <DesktopInput
            placeholder="输入标签后回车"
            value={tagDraft}
            onChange={(event) => setTagDraft(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === 'Enter') addTag()
            }}
          />
          <DesktopButton
            size="xs"
            variant="subtle"
            icon={<Plus className="w-3 h-3" />}
            disabled={!tagDraft.trim()}
            onClick={addTag}
          >
            添加
          </DesktopButton>
        </div>
        {meta.tags.length > 0 && (
          <span className="text-xs text-[var(--ds-text-subtle)]">点击标签可移除</span>
        )}
      </ThemeCollapsibleSection>

      <section className="border-t border-[var(--ds-border)] pt-3 dark:border-[var(--ds-border)]" aria-label="操作">
        <div className="grid grid-cols-2 gap-1.5">
          <DesktopButton className="col-span-2" size="sm" variant="primary" icon={<ExternalLink className="w-3 h-3" />} onClick={() => void explorerStore.openEntry(entry)}>
            {entry.isDirectory ? '进入文件夹' : '使用默认程序打开'}
          </DesktopButton>
          <DesktopButton size="xs" variant="subtle" icon={<MapPin className="w-3 h-3" />} onClick={() => void explorerStore.revealEntry(entry)}>
            在资源管理器中定位
          </DesktopButton>
          <DesktopButton size="xs" variant="subtle" icon={<Copy className="w-3 h-3" />} onClick={() => void copyPath()}>
            复制路径
          </DesktopButton>
          {basketAvailable && <DesktopButton size="xs" variant="subtle" icon={<Archive className="w-3 h-3" />} onClick={explorerStore.addSelectionToBasket}>暂存</DesktopButton>}
          <DesktopButton size="xs" variant="subtle" icon={<Download className="w-3 h-3" />} onClick={() => void exportMetadata()}>
            导出信息
          </DesktopButton>
        </div>
      </section>
    </>
  )
}

export function Inspector(): ReactElement {
  const { DesktopButton, DesktopIconButton } = useUiKit()
  const state = useExplorerShallow((s) => ({
    focusedPath: s.focusedPath, entries: s.entries, descendantEntries: s.descendantEntries,
    selectedPaths: s.selectedPaths, path: s.path
  }))
  const entry = state.focusedPath
    ? (state.entries.find((item) => item.path === state.focusedPath)
      ?? state.descendantEntries.find((item) => item.path === state.focusedPath))
    : undefined
  const selection = state.selectedPaths
  const folders = state.entries.filter((item) => item.isDirectory).length

  return (
    <div data-file-inspector className="flex flex-col gap-4 p-4 text-xs">
      {selection.length > 1 && (
        <div className="rounded-xl border border-[var(--ds-accent)]/30 bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)] px-2.5 py-2">
          <div className="flex items-center justify-between">
            <span className="font-semibold text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)]">
              已选 {selection.length} 项
            </span>
            <div className="flex items-center gap-1">
              <DesktopButton
                size="xs"
                variant="subtle"
                icon={<Archive className="w-3 h-3" />}
                onClick={explorerStore.addSelectionToBasket}
              >
                暂存
              </DesktopButton>
              <DesktopIconButton
                size="xs"
                icon={<X className="w-3.5 h-3.5" />}
                tooltip="清除选择"
                onClick={() => explorerStore.clearSelection()}
              />
            </div>
          </div>
          <div className="mt-1 text-xs text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)] break-all">
            {selection.slice(0, 4).join('、')}
            {selection.length > 4 ? ` 等 ${selection.length} 项` : ''}
          </div>
        </div>
      )}

      {entry ? (
        <EntryDetail key={entry.path} entry={entry} />
      ) : (
        <>
          <div className="flex items-center gap-2">
            <FolderOpen className="w-4 h-4 text-[var(--ds-status-warning)]" />
            <span className="font-semibold text-[var(--ds-text-primary)] dark:text-white">未选择条目</span>
          </div>
          <div className={`${sectionCard} px-2.5 py-1.5`}>
            <Field label="当前目录" value={state.path ?? '—'} />
            <Field label="条目总数" value={String(state.entries.length)} />
            <Field label="文件夹" value={String(folders)} />
            <Field label="文件" value={String(state.entries.length - folders)} />
          </div>
          <span className="text-xs text-[var(--ds-text-muted)]">
            在文件列表中选择条目以查看属性、元数据与内容预览；按住 Ctrl 或 Shift 可多选。
          </span>
        </>
      )}
    </div>
  )
}
