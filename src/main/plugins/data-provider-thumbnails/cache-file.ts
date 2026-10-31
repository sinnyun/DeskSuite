export const MAX_THUMBNAIL_CACHE_FILE_BYTES = 2 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

export interface CacheFileHandle {
  stat(): Promise<{ isFile(): boolean; size: number; mtimeMs: number }>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
}

export interface BoundedCacheFile {
  bytes: Buffer
  size: number
  mtimeMs: number
}

/** Read a thumbnail cache slot from the same handle whose metadata was checked. */
export async function readBoundedThumbnailCacheHandle(handle: CacheFileHandle): Promise<BoundedCacheFile> {
  const stats = await handle.stat()
  if (!stats.isFile()) throw new Error('Thumbnail cache slot is not a regular file')
  if (stats.size > MAX_THUMBNAIL_CACHE_FILE_BYTES) throw new Error('Thumbnail cache slot exceeds 2 MiB')

  const limit = MAX_THUMBNAIL_CACHE_FILE_BYTES + 1
  const chunks: Buffer[] = []
  let position = 0
  while (position < limit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit - position))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
    if (bytesRead === 0) break
    chunks.push(chunk.subarray(0, bytesRead))
    position += bytesRead
  }
  if (position > MAX_THUMBNAIL_CACHE_FILE_BYTES) throw new Error('Thumbnail cache slot exceeds 2 MiB')
  if (position !== stats.size) throw new Error('Thumbnail cache slot changed while being read')
  return { bytes: Buffer.concat(chunks, position), size: stats.size, mtimeMs: stats.mtimeMs }
}
