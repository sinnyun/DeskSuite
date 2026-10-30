export const KIND_LABEL: Record<string, string> = {
  folder: '文件夹',
  code: '代码',
  image: '图片',
  document: '文档',
  data: '数据',
  archive: '压缩包',
  video: '视频',
  audio: '音频',
  other: '其他'
}

export const KIND_COLOR: Record<string, string> = {
  folder: 'var(--ds-status-warning)',
  code: 'var(--ds-accent)',
  image: 'var(--ds-status-success)',
  document: 'var(--ds-accent)',
  data: 'var(--ds-status-warning)',
  archive: 'var(--ds-text-secondary)',
  video: 'var(--ds-status-danger)',
  audio: 'var(--ds-status-info)',
  other: 'var(--ds-text-muted)'
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
