export interface DropSources {
  paths?: string[]
  files?: File[]
  references?: string[]
  links?: string[]
}

export function dropSources(args: Record<string, unknown>): DropSources {
  if (args.payload !== undefined && args.payload !== '') {
    if (typeof args.payload !== 'string') throw new Error('拖入的文件列表无效')
    return dropSources({ paths: JSON.parse(args.payload) })
  }
  if (args.paths !== undefined) {
    if (!Array.isArray(args.paths) || !args.paths.length || args.paths.length > 100 ||
      args.paths.some(p => typeof p !== 'string' || !p.trim())) throw new Error('请拖入 1 至 100 个本地文件')
    return { paths: [...new Set(args.paths as string[])] }
  }
  if (Array.isArray(args.files) && args.files.length) {
    if (args.files.length > 100) throw new Error('每次最多拖入 100 个文件')
    return { files: args.files as File[] }
  }
  const paths: string[] = [], references: string[] = [], links: string[] = []
  if (typeof args.uriList !== 'string') throw new Error('请拖入本地图片或统一资源链接')
  const lines = args.uriList.split(/\r?\n/).map(s => s.trim()).filter(s => s && !s.startsWith('#'))
  if (!lines.length || lines.length > 100) throw new Error('每次请拖入 1 至 100 个文件链接')
  for (const line of lines) {
    const url = new URL(line)
    if (url.protocol === 'desksuite-resource:') references.push(line)
    else if (url.protocol === 'file:' && !url.username && !url.password && !url.port && !url.search && !url.hash) {
      const path = decodeURIComponent(url.pathname)
      if (!path || path.includes('\0') || /%2f|%5c/i.test(url.pathname)) throw new Error('本地文件链接无效')
      paths.push(url.host && url.host !== 'localhost' ? `\\\\${url.host}${path.replaceAll('/', '\\')}` : /^\/[a-z]:\//i.test(path) ? path.slice(1).replaceAll('/', '\\') : path)
    } else links.push(line) // Optional plugins own external link schemes; never download here.
  }
  return { paths: [...new Set(paths)], references: [...new Set(references)], links: [...new Set(links)] }
}

export function dropPoint(args: Record<string, unknown>, box: { left: number; top: number }, view: { x: number; y: number; zoom: number }): { x: number; y: number } {
  const clientX = Number(args.clientX), clientY = Number(args.clientY)
  if (![clientX, clientY].every(Number.isFinite)) throw new Error('拖入位置无效')
  const x = (clientX - box.left - view.x) / view.zoom
  const y = (clientY - box.top - view.y) / view.zoom
  if (![x, y].every(n => Number.isFinite(n) && Math.abs(n) <= 1e7 - 3200)) throw new Error('拖入位置超出画板范围')
  return { x, y }
}
