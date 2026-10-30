import type { ResourceKind } from './types'

const formats: Record<string, [string, ResourceKind]> = {
  png: ['image/png', 'image'], jpg: ['image/jpeg', 'image'], jpeg: ['image/jpeg', 'image'],
  webp: ['image/webp', 'image'], gif: ['image/gif', 'image'], avif: ['image/avif', 'image'],
  bmp: ['image/bmp', 'image'], ico: ['image/x-icon', 'image'], svg: ['image/svg+xml', 'image'],
  mp4: ['video/mp4', 'video'], webm: ['video/webm', 'video'], mov: ['video/quicktime', 'video'],
  mkv: ['video/x-matroska', 'video'], m4v: ['video/mp4', 'video'], ogv: ['video/ogg', 'video'],
  mp3: ['audio/mpeg', 'audio'], wav: ['audio/wav', 'audio'], ogg: ['audio/ogg', 'audio'],
  flac: ['audio/flac', 'audio'], m4a: ['audio/mp4', 'audio'], aac: ['audio/aac', 'audio'],
  pdf: ['application/pdf', 'pdf'], md: ['text/markdown', 'markdown'], markdown: ['text/markdown', 'markdown'],
  txt: ['text/plain', 'text'], log: ['text/plain', 'text'], csv: ['text/csv', 'text'],
  tsv: ['text/tab-separated-values', 'text'], json: ['application/json', 'text'],
  xml: ['application/xml', 'text'], html: ['text/html', 'text'], htm: ['text/html', 'text'],
  css: ['text/css', 'text'], js: ['text/javascript', 'text'], ts: ['text/plain', 'text'],
  tsx: ['text/plain', 'text'], jsx: ['text/plain', 'text'], py: ['text/plain', 'text'],
  yaml: ['text/yaml', 'text'], yml: ['text/yaml', 'text'], toml: ['text/plain', 'text'],
  doc: ['application/msword', 'document'], docx: ['application/vnd.openxmlformats-officedocument.wordprocessingml.document', 'document'],
  xls: ['application/vnd.ms-excel', 'document'], xlsx: ['application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', 'document'],
  ppt: ['application/vnd.ms-powerpoint', 'document'], pptx: ['application/vnd.openxmlformats-officedocument.presentationml.presentation', 'document'],
  zip: ['application/zip', 'binary'], '7z': ['application/x-7z-compressed', 'binary']
}

export function resourceFormat(extension: string): { mimeType: string; kind: ResourceKind } {
  const [mimeType, kind] = formats[extension] ?? ['application/octet-stream', 'binary']
  return { mimeType, kind }
}
