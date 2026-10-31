import { useEffect, useState } from 'react'
import { callValidated, errorText } from '../../workbench/sdk'
import { imagePreviewSchema, mediaPreviewSchema, textPreviewSchema } from './schema'
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
      callValidated(imagePreviewSchema, 'filesystem', 'readImage', entry.path)
        .then((result) => {
          if (alive && result.path === entry.path) setPreview({ status: 'image', dataUrl: result.dataUrl })
          else if (alive) setPreview({ status: 'unsupported', message: '预览响应与所选文件不匹配' })
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: errorText(error, '无法读取图片预览') })
        })
    } else if (MEDIA_KINDS.has(entry.kind)) {
      callValidated(mediaPreviewSchema, 'filesystem', 'readMedia', entry.path)
        .then((result) => {
          if (alive && result.path === entry.path) setPreview({ status: 'media', dataUrl: result.dataUrl, mimeType: result.mimeType })
          else if (alive) setPreview({ status: 'unsupported', message: '预览响应与所选文件不匹配' })
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: errorText(error, '无法读取媒体预览') })
        })
    } else if (TEXT_KINDS.has(entry.kind)) {
      callValidated(textPreviewSchema, 'filesystem', 'readText', entry.path)
        .then((result) => {
          if (alive && result.path === entry.path) {
            setPreview({ status: 'text', content: result.content, truncated: result.truncated })
          } else if (alive) setPreview({ status: 'unsupported', message: '预览响应与所选文件不匹配' })
        })
        .catch((error) => {
          if (alive) setPreview({ status: 'unsupported', message: errorText(error, '无法读取文本预览') })
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
