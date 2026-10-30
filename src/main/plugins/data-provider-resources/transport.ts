import { Readable } from 'node:stream'
import { ResourceError, ResourceRegistry } from './registry'

// RFC 9110 single byte ranges, including suffix and open-ended ranges.
export function byteRange(header: string | null, size: number): { start: number; end: number } | null {
  if (!header) return null
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim())
  if (!match || (!match[1] && !match[2]) || size === 0) throw new ResourceError('invalid-range', '请求范围无效', 416)
  const first = match[1] ? Number(match[1]) : null
  const last = match[2] ? Number(match[2]) : null
  if ((first !== null && !Number.isSafeInteger(first)) || (last !== null && !Number.isSafeInteger(last))) throw new ResourceError('invalid-range', '请求范围无效', 416)
  const start = first === null ? Math.max(0, size - last!) : first
  const end = first === null || last === null ? size - 1 : Math.min(size - 1, last)
  if (start < 0 || start >= size || end < start) throw new ResourceError('invalid-range', '请求范围超出文件', 416)
  return { start, end }
}

export async function resourceResponse(registry: ResourceRegistry, request: Request): Promise<Response> {
  const headers = new Headers({
    'Cache-Control': 'no-store', 'Accept-Ranges': 'bytes', 'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Access-Control-Expose-Headers': 'Content-Length, Content-Range, Accept-Ranges, ETag, Content-Type',
    Vary: 'Origin'
  })
  const origin = request.headers.get('origin')
  const allowedOrigins = new Set(['null', 'file://'])
  if (process.env.ELECTRON_RENDERER_URL) allowedOrigins.add(new URL(process.env.ELECTRON_RENDERER_URL).origin)
  if (origin && !allowedOrigins.has(origin)) return new Response('资源只供本应用访问', { status: 403, headers })
  headers.set('Access-Control-Allow-Origin', origin ?? 'null')
  if (request.method === 'OPTIONS') {
    headers.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS')
    headers.set('Access-Control-Allow-Headers', 'Range, If-None-Match, If-Range')
    return new Response(null, { status: 204, headers })
  }
  if (!['GET', 'HEAD'].includes(request.method)) {
    headers.set('Allow', 'GET, HEAD, OPTIONS')
    return new Response('只支持读取资源', { status: 405, headers })
  }
  let opened: Awaited<ReturnType<ResourceRegistry['open']>> | undefined
  try {
    opened = await registry.open(request.url)
    const { handle, stats, resource } = opened
    headers.set('Content-Type', resource.mimeType)
    headers.set('ETag', `"${resource.revision}"`)
    if (request.headers.get('if-none-match') === headers.get('ETag')) {
      await handle.close()
      return new Response(null, { status: 304, headers })
    }
    const ifRange = request.headers.get('if-range')
    const range = byteRange(!ifRange || ifRange === headers.get('ETag') ? request.headers.get('range') : null, stats.size)
    const start = range?.start ?? 0
    const end = range?.end ?? stats.size - 1
    headers.set('Content-Length', String(Math.max(0, end - start + 1)))
    if (range) headers.set('Content-Range', `bytes ${start}-${end}/${stats.size}`)
    if (request.method === 'HEAD' || stats.size === 0) {
      await handle.close()
      return new Response(null, { status: range ? 206 : 200, headers })
    }
    const stream = handle.createReadStream({ start, end, autoClose: true })
    const abort = (): void => { stream.destroy() }
    request.signal.addEventListener('abort', abort, { once: true })
    stream.once('close', () => request.signal.removeEventListener('abort', abort))
    if (request.signal.aborted) abort()
    // FileHandle-backed streams bound memory use for multi-gigabyte media.
    return new Response(Readable.toWeb(stream) as ReadableStream<Uint8Array>, { status: range ? 206 : 200, headers })
  } catch (cause) {
    await opened?.handle.close().catch(() => {})
    const error = cause instanceof ResourceError ? cause : new ResourceError('read-failed', '资源读取失败', 500)
    if (error.status === 416 && opened) headers.set('Content-Range', `bytes */${opened.stats.size}`)
    headers.set('Content-Type', 'application/json; charset=utf-8')
    return new Response(JSON.stringify({ code: error.code, message: error.message }), { status: error.status, headers })
  }
}
