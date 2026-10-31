export const MAX_VERSION_PREVIEW_BYTES = 512 * 1024
const READ_CHUNK_BYTES = 64 * 1024

export interface VersionPreviewFileHandle {
  stat(): Promise<{
    isFile(): boolean
    size: number
    dev: number | bigint
    ino: number | bigint
  }>
  read(buffer: Buffer, offset: number, length: number, position: number): Promise<{ bytesRead: number }>
}

/** Read preview bytes only from the file that passed lstat and within its byte budget. */
export async function readBoundedVersionPreviewHandle(
  handle: VersionPreviewFileHandle,
  expected: { dev: number | bigint; ino: number | bigint }
): Promise<Buffer | null> {
  const stats = await handle.stat()
  if (!stats.isFile() || stats.dev !== expected.dev || stats.ino !== expected.ino) return null
  if (stats.size > MAX_VERSION_PREVIEW_BYTES) return null

  const limit = MAX_VERSION_PREVIEW_BYTES + 1
  const chunks: Buffer[] = []
  let position = 0
  while (position < limit) {
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, limit - position))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, position)
    if (bytesRead === 0) break
    chunks.push(chunk.subarray(0, bytesRead))
    position += bytesRead
  }
  if (position > MAX_VERSION_PREVIEW_BYTES) return null
  return Buffer.concat(chunks, position)
}
