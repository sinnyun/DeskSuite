import '../gallery.css'
import { dragFiles } from '../drag'
import { useEffect, useRef, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  FolderOpen,
  ImageOff,
  Maximize,
  Music,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import { explorerStore, useExplorerShallow, visibleEntries, type FsEntry } from '../store'
import { EntryIcon } from '../EntryIcon'
import { KIND_LABEL, formatBytes, formatDate } from '../format'
import { useFileIcon } from '../useFileIcon'
import { usePreview } from '../usePreview'
import { FileGridView } from './FileGridView'

function Stage({ entry }: { entry: FsEntry }): ReactElement {
  const preview = usePreview(entry)
  const systemIcon = useFileIcon(entry, preview.status === 'unsupported')
  const [zoom, setZoom] = useState(100)
  const { DesktopIconButton } = useUiKit()

  useEffect(() => {
    setZoom(100)
  }, [entry.path])

  const zoomable = preview.status === 'image' || preview.status === 'text'

  return (
    <div data-gallery-stage={entry.path} className="flex-1 flex flex-col items-center justify-center p-4 relative min-w-0 min-h-0 overflow-hidden">
      <div className="absolute top-3 right-3 flex items-center gap-1 z-10 bg-[var(--ds-surface-raised)] p-1 rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] shadow-xs">
        <DesktopIconButton
          size="xs"
          icon={<ZoomOut className="w-3.5 h-3.5" />}
          tooltip="缩小预览"
          disabled={!zoomable || zoom <= 50}
          className={!zoomable || zoom <= 50 ? 'opacity-30' : ''}
          onClick={() => setZoom((value) => Math.max(50, value - 25))}
        />
        <span className="text-xs font-mono tabular-nums px-1 text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)] w-10 text-center">
          {zoom}%
        </span>
        <DesktopIconButton
          size="xs"
          icon={<ZoomIn className="w-3.5 h-3.5" />}
          tooltip="放大预览"
          disabled={!zoomable || zoom >= 200}
          className={!zoomable || zoom >= 200 ? 'opacity-30' : ''}
          onClick={() => setZoom((value) => Math.min(200, value + 25))}
        />
        <div className="h-3 w-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)]" />
        <DesktopIconButton
          size="xs"
          icon={<Maximize className="w-3.5 h-3.5" />}
          tooltip="重置缩放"
          disabled={!zoomable}
          className={!zoomable ? 'opacity-30' : ''}
          onClick={() => setZoom(100)}
        />
      </div>

      <div className="flex-1 flex items-center justify-center w-full h-full overflow-hidden min-h-0">
        {preview.status === 'loading' && (
          <span className="text-xs text-[var(--ds-text-subtle)]">正在读取内容…</span>
        )}

        {preview.status === 'image' && (
          <div
            draggable
            onDragStart={(event) => dragFiles(event, entry)}
            title="拖到其他应用"
            className="flex h-full w-full min-h-0 items-center justify-center"
          >
            <img
              data-gallery-preview
              src={preview.dataUrl}
              alt={entry.name}
              draggable={false}
              style={{ transform: `scale(${zoom / 100})` }}
              className="max-h-full max-w-full object-contain rounded-xl shadow-lg border border-[var(--ds-border)] dark:border-[var(--ds-border)] transition-transform duration-150"
            />
          </div>
        )}

        {preview.status === 'text' && (
          <div
            style={{ width: `${Math.min(160, zoom)}%` }}
            className="max-h-full max-w-3xl overflow-auto rounded-[var(--ds-radius-panel)] bg-[var(--ds-surface-code)] text-[var(--ds-text-primary)] border border-[var(--ds-border)] shadow-lg"
          >
            <div className="flex items-center justify-between px-3 py-1.5 border-b border-[var(--ds-border)] text-xs text-[var(--ds-text-muted)] font-mono sticky top-0 bg-[var(--ds-surface-code)]">
              <span className="truncate">{entry.name}</span>
              <span>{preview.content.split('\n').length} 行</span>
            </div>
            <pre
              style={{ fontSize: `${10 * (zoom / 100)}px` }}
              className="p-3 whitespace-pre-wrap break-all leading-relaxed"
            >
              {preview.content}
            </pre>
          </div>
        )}

        {preview.status === 'media' && entry.kind === 'video' && (
          <video
            controls
            src={preview.dataUrl}
            className="max-h-full max-w-full rounded-xl bg-black shadow-lg"
          />
        )}

        {preview.status === 'media' && entry.kind === 'audio' && (
          <div className="flex flex-col items-center gap-4 p-8 rounded-2xl border border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-raised)] max-w-md w-full shadow-xs">
            <div className="w-14 h-14 rounded-2xl bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)] flex items-center justify-center text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)]">
              <Music className="w-7 h-7" />
            </div>
            <span className="text-xs font-semibold text-[var(--ds-text-primary)] dark:text-white break-all text-center">
              {entry.name}
            </span>
            <audio controls src={preview.dataUrl} className="w-full" />
          </div>
        )}

        {preview.status === 'unsupported' && (
          <div className="flex flex-col items-center justify-center p-8 rounded-2xl border border-dashed border-[var(--ds-border-strong)] bg-[var(--ds-surface)]/70 max-w-sm text-center">
            <div className="w-14 h-14 flex items-center justify-center text-[var(--ds-text-subtle)]">
              {systemIcon
                ? <img data-file-icon src={systemIcon} alt="" aria-hidden="true" draggable={false} className="h-14 w-14 object-contain" />
                : entry.kind === 'image' ? <ImageOff className="w-10 h-10" /> : <EntryIcon kind={entry.kind} className="w-10 h-10" />}
            </div>
            <span className="mt-2 font-semibold text-xs text-[var(--ds-text-primary)] dark:text-white break-all">
              {entry.name}
            </span>
            <span className="text-xs text-[var(--ds-text-subtle)] mt-1">{preview.message}</span>
          </div>
        )}
      </div>

      <div className="mt-2 flex items-center gap-2 text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)] shrink-0">
        <span className="font-semibold text-[var(--ds-text-primary)] dark:text-white truncate max-w-72">{entry.name}</span>
        <span>·</span>
        <span>{KIND_LABEL[entry.kind]}</span>
        {!entry.isDirectory && (
          <>
            <span>·</span>
            <span className="font-mono tabular-nums">{formatBytes(entry.size)}</span>
          </>
        )}
        <span>·</span>
        <span className="font-mono">{formatDate(entry.modifiedAt)}</span>
      </div>
    </div>
  )
}

export function FileGalleryView({ navigation }: { navigation?: ReactNode } = {}): ReactElement {
  const { DesktopButton } = useUiKit()
  const state = useExplorerShallow((s) => ({
    entries: s.entries, descendantEntries: s.descendantEntries, search: s.search, kindFilter: s.kindFilter,
    favoriteOnly: s.favoriteOnly, minRating: s.minRating, tagFilter: s.tagFilter, sortField: s.sortField,
    sortOrder: s.sortOrder, path: s.path, tagFocus: s.tagFocus, focusedPath: s.focusedPath,
    status: s.status, error: s.error
  }))
  const entries = visibleEntries({ ...state, entries: [...state.entries, ...state.descendantEntries] })
  const activeEntry = entries.find(entry => entry.path === state.focusedPath)
    ?? entries.find(entry => !entry.isDirectory) ?? entries[0]
  const railRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!state.focusedPath) return
    const selected = [...(railRef.current?.querySelectorAll<HTMLButtonElement>('[data-file-card]') ?? [])]
      .find(card => card.title === state.focusedPath)
    selected?.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [state.focusedPath, state.entries, state.descendantEntries])

  if (!state.path && !state.tagFocus) {
    return <div className="flex h-full flex-col items-center justify-center gap-3 text-xs text-[var(--ds-text-subtle)]">
      <FolderOpen className="h-8 w-8" /><span>尚未打开任何目录</span>
      <DesktopButton variant="primary" onClick={() => void explorerStore.pickAndNavigate()}>打开目录</DesktopButton>
    </div>
  }

  return <div data-entry-view="gallery" className="grid h-full min-h-0 min-w-0 overflow-hidden bg-[var(--ds-workspace)]" style={{ gridTemplateColumns: 'minmax(192px, 20%) minmax(0, 1fr)' }}>
    <div data-gallery-rail ref={railRef} className="min-h-0 min-w-0 overflow-auto border-r border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-dark)]">
      {navigation ?? <FileGridView entries={entries} singleColumn />}
    </div>
    <div data-gallery-viewer className="flex min-h-0 min-w-0 overflow-hidden">
      {state.status === 'error'
        ? <div role="alert" className="m-auto p-6 text-xs text-[var(--ds-status-danger)]">读取目录失败：{state.error}</div>
        : activeEntry
          ? <Stage key={activeEntry.path} entry={activeEntry} />
          : <div className="m-auto p-6 text-xs text-[var(--ds-text-subtle)]">{state.status === 'loading' ? '正在读取目录…' : '没有可画廊浏览的条目'}</div>}
    </div>
  </div>
}
