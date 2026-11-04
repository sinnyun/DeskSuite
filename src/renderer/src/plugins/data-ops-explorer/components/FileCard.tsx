import { useEffect, useRef, useState } from 'react'
import type { DragEvent, MouseEvent, ReactElement, RefObject } from 'react'
import { Archive, File, FileCode2, FileJson, FileText, Film, Folder, Image, Music, Star, Layers } from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import type { FsEntry } from '../store'
import { KIND_LABEL } from '../format'
import { useFileIcon } from '../useFileIcon'
import { requestThumbnail } from '../thumbnail-requests'
function EntryGlyph({ entry }: { entry: FsEntry }): ReactElement {
  const className = `h-8 w-8 ${entry.isDirectory ? 'text-[var(--ds-status-warning)] fill-[var(--ds-status-warning-soft)]' : entry.kind === 'document' ? 'text-[var(--ds-accent)]' : 'text-[var(--ds-text-subtle)]'}`
  if (entry.isDirectory) return <Folder className={className} />
  if (entry.kind === 'image') return <Image className={className} />
  if (entry.kind === 'video') return <Film className={className} />
  if (entry.kind === 'audio') return <Music className={className} />
  if (entry.kind === 'document') return <FileText className={className} />
  if (entry.kind === 'code') return <FileCode2 className={className} />
  if (entry.kind === 'data') return <FileJson className={className} />
  if (entry.kind === 'archive') return <Archive className={className} />
  if (entry.name.endsWith('.vectorcraft') || entry.name.endsWith('.figcraft')) return <Layers className="h-8 w-8 text-[var(--ds-accent)]" />
  return <File className={className} />
}

function useCardThumbnail(entry: FsEntry): { src: string | null; previewRef: RefObject<HTMLDivElement | null> } {
  const [src, setSrc] = useState<string | null>(null)
  const previewRef = useRef<HTMLDivElement>(null)
  useEffect(() => {
    setSrc(null)
    if (entry.isDirectory || (entry.kind !== 'image' && entry.kind !== 'video')) return
    let alive = true
    const load = (): void => {
      void requestThumbnail(entry.path, `${entry.path}\0${entry.modifiedAt}`)
        .then((result) => { if (alive) setSrc(result) })
    }
    const target = previewRef.current
    if (!target || typeof IntersectionObserver === 'undefined') load()
    else {
      const observer = new IntersectionObserver((entries) => {
        if (entries.some((item) => item.isIntersecting)) {
          observer.disconnect()
          load()
        }
      }, { rootMargin: '320px' })
      observer.observe(target)
      return () => { alive = false; observer.disconnect() }
    }
    return () => { alive = false }
  }, [entry.path, entry.modifiedAt, entry.kind, entry.isDirectory])
  return { src, previewRef }
}

export function FileCard({ entry, selected, rating, favorite, onSelect, onOpen, onDragStart, onToggleFavorite }: {
  entry: FsEntry
  selected: boolean
  rating: number
  favorite: boolean
  onToggleFavorite?: () => void
  onSelect: (entry: FsEntry, event: MouseEvent) => void
  onOpen: (entry: FsEntry) => void
  onDragStart: (event: DragEvent<HTMLButtonElement>) => void
}): ReactElement {
  const { src: thumbnail, previewRef } = useCardThumbnail(entry)
  const systemIcon = useFileIcon(entry, !thumbnail, previewRef)
  const { DesktopCardButton, DesktopIconButton } = useUiKit()
  return <div className="group relative min-w-0" data-entry-path={entry.path} data-entry-name={entry.name} data-entry-dir={entry.isDirectory ? '1' : '0'}>
  <DesktopCardButton
    type="button"
    selected={selected}
    onClick={(event) => onSelect(entry, event)}
    onDoubleClick={() => onOpen(entry)}
    draggable={!entry.isDirectory}
    onDragStart={onDragStart}
    title={entry.path}
    data-file-card
    aria-pressed={selected}
    className="h-full w-full overflow-hidden text-left"
  >
    <div ref={previewRef} data-card-preview className={`relative h-28 flex items-center justify-center overflow-hidden ${entry.isDirectory ? 'bg-[var(--ds-status-warning-soft)]' : 'bg-[var(--ds-surface-subtle)]'}`}>
      {thumbnail ? <img src={thumbnail} alt="" loading="lazy" draggable={false} className="h-full w-full object-cover" /> : systemIcon ? <img data-file-icon src={systemIcon} alt="" aria-hidden="true" loading="lazy" draggable={false} className="h-10 w-10 object-contain" /> : <EntryGlyph entry={entry} />}

      {entry.kind === 'document' && !thumbnail && !systemIcon && <div aria-hidden="true" className="absolute bottom-4 left-3 right-3 space-y-1"><div className="h-1.5 w-3/4 rounded bg-[var(--ds-border-strong)]" /><div className="h-1.5 rounded bg-[var(--ds-surface-muted)]" /><div className="h-1.5 w-1/2 rounded bg-[var(--ds-surface-muted)]" /></div>}
      {entry.kind === 'document' && <span className="absolute right-2 top-2 text-xs font-mono uppercase text-[var(--ds-text-subtle)]">{entry.name.split('.').pop()}</span>}
    </div>
    <div className="px-2 py-2">
      <div className="flex items-center gap-1">
        <span data-ds-type="body" className="ds-type-body min-w-0 flex-1 truncate font-medium">{entry.name}</span>
        {rating > 0 && <span className="flex shrink-0 items-center gap-0.5 text-xs text-[var(--ds-status-warning)]"><Star className="h-2.5 w-2.5 fill-current" />{rating}</span>}
      </div>
      <div className="mt-1 flex justify-between gap-1">
        <span data-ds-type="meta" className="ds-type-meta">{KIND_LABEL[entry.kind]}</span>
        {!entry.isDirectory && <span data-ds-type="data" className="ds-type-data font-mono">{entry.size < 1024 ? `${entry.size} B` : entry.size < 1048576 ? `${Math.round(entry.size / 1024)} KB` : `${(entry.size / 1048576).toFixed(1)} MB`}</span>}
      </div>
    </div>
  </DesktopCardButton>
  <DesktopIconButton type="button" size="xs" tooltip={favorite ? '取消收藏' : '添加收藏'} active={favorite} onClick={onToggleFavorite}
    className={`absolute right-1.5 top-1.5 text-[var(--ds-status-warning)] ${favorite ? '' : 'opacity-0 group-hover:opacity-100 focus-visible:opacity-100'}`}
    icon={<Star className={`h-3 w-3 ${favorite ? 'fill-current' : ''}`} />} />
  </div>
}

