import type { EntryKind } from './store'

export const KIND_LABEL: Record<EntryKind, string> = {
  folder: '文件夹',
  code: '代码',
  image: '图片',
  document: '文档',
  data: '数据',
  archive: '压缩包',
  video: '视频',
  audio: '音频',
  other: '文件'
}

export function formatBytes(bytes: number): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B'
  const units = ['B', 'KB', 'MB', 'GB', 'TB']
  let value = bytes
  let index = 0
  while (value >= 1024 && index < units.length - 1) {
    value /= 1024
    index++
  }
  return `${value >= 100 || index === 0 ? Math.round(value) : value.toFixed(1)} ${units[index]}`
}

export function formatDate(ms: number): string {
  if (!Number.isFinite(ms) || ms <= 0) return '—'
  const date = new Date(ms)
  const pad = (value: number): string => String(value).padStart(2, '0')
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`
}

export interface PathSegment {
  name: string
  path: string
}

export function splitPath(path: string | null): PathSegment[] {
  if (!path) return []
  const isWindows = /^[A-Za-z]:/.test(path)
  const separator = isWindows ? '\\' : '/'
  const parts = path.replace(/[\\/]+/g, '/').split('/').filter(Boolean)
  const result: PathSegment[] = []
  let accumulated = ''
  for (const part of parts) {
    if (!accumulated) {
      accumulated = isWindows && /^[A-Za-z]:$/.test(part) ? `${part}\\` : separator === '/' ? `/${part}` : part
    } else {
      accumulated = `${accumulated.replace(/[\\/]$/, '')}${separator}${part}`
    }
    result.push({ name: part, path: accumulated })
  }
  return result
}
