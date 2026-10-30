import { useEffect, useState } from 'react'
import { call } from '../../workbench/sdk'
import type { FsEntry } from './store'

export type PreviewState =
  | { status: 'idle' }
  | { status: 'loading' }
  | { status: 'text'; content: string; truncated: boolean }
  | { status: 'image'; dataUrl: string }
  | { status: 'media'; dataUrl: string; mimeType: string }
  | { status: 'unsupported'; message: string }

const TEXT_KINDS = new Set(['code', 'data', 'document'])
const MEDIA_KINDS = new Set(['video', 'audio'])

export function usePreview(entry: FsEntry | undefined): PreviewState {
  const [preview, setPreview] = useState<PreviewState>({ status: 'idle' })

  useEffect(() => {
    if (!entry) {
      setPreview({ status: 'idle' })
      return
    }
    if (entry.isDirectory) {
      setPreview({ status: 'unsupported', message: '文件夹没有内容预览' })
      return
    }

    let alive = true
    setPreview({ status: 'loading' })

    if (entry.kind === 'image') {
      call<{ dataUrl: string }>('filesystem', 'readImage', entry.path)
        .then((result) => {
          if (alive) setPreview({ status: 'image', dataUrl: result.dataUrl })
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: String(error) })
        })
    } else if (MEDIA_KINDS.has(entry.kind)) {
      call<{ dataUrl: string; mimeType: string }>('filesystem', 'readMedia', entry.path)
        .then((result) => {
          if (alive) setPreview({ status: 'media', ...result })
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: String(error) })
        })
    } else if (TEXT_KINDS.has(entry.kind)) {
      call<{ content: string; truncated: boolean }>('filesystem', 'readText', entry.path)
        .then((result) => {
          if (alive) {
            setPreview({ status: 'text', content: result.content, truncated: result.truncated })
          }
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: String(error) })
        })
    } else {
      setPreview({ status: 'unsupported', message: '该类型文件不支持内联预览' })
    }

    return () => {
      alive = false
    }
  }, [entry?.path, entry?.kind, entry?.isDirectory])

  return preview
}
