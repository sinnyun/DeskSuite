import type { ReactElement } from 'react'
import {
  File,
  FileArchive,
  FileCode,
  FileJson,
  FileText,
  Film,
  Folder,
  FolderOpen,
  Image as ImageIcon,
  Music
} from 'lucide-react'
import type { EntryKind } from './store'

interface EntryIconProps {
  kind: EntryKind
  open?: boolean
  className?: string
}

export function EntryIcon({ kind, open = false, className = 'w-4 h-4' }: EntryIconProps): ReactElement {
  if (kind === 'folder') {
    return open ? (
      <FolderOpen className={`${className} text-[var(--ds-status-warning)] shrink-0`} />
    ) : (
      <Folder className={`${className} text-[var(--ds-status-warning)] shrink-0`} />
    )
  }
  if (kind === 'code') return <FileCode className={`${className} text-[var(--ds-accent)] shrink-0`} />
  if (kind === 'image') return <ImageIcon className={`${className} text-[var(--ds-status-success)] shrink-0`} />
  if (kind === 'data') return <FileJson className={`${className} text-[var(--ds-status-warning)] shrink-0`} />
  if (kind === 'document') return <FileText className={`${className} text-[var(--ds-accent)] shrink-0`} />
  if (kind === 'archive') return <FileArchive className={`${className} text-[var(--ds-accent)] shrink-0`} />
  if (kind === 'video') return <Film className={`${className} text-[var(--ds-status-danger)] shrink-0`} />
  if (kind === 'audio') return <Music className={`${className} text-[var(--ds-status-info)] shrink-0`} />
  return <File className={`${className} text-[var(--ds-text-muted)] shrink-0`} />
}
