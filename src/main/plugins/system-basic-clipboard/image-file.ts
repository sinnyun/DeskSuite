import { promises as fs } from 'node:fs'
import type { FileHandle } from 'node:fs/promises'

export const MAX_CLIPBOARD_IMAGE_BYTES = 8 * 1024 * 1024
const READ_CHUNK_BYTES = 64 * 1024

export async function readBoundedClipboardImageHandle(handle: FileHandle): Promise<Buffer> {
  const tooLarge = '剪贴板图片文件损坏或超过 8MB 上限'
  const incomplete = '剪贴板图片文件读取不完整'
  const info = await handle.stat()
  if (!info.isFile() || info.size < 1 || info.size > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error(tooLarge)

  const chunks: Buffer[] = []
  let total = 0
  while (total <= MAX_CLIPBOARD_IMAGE_BYTES) {
    const remaining = MAX_CLIPBOARD_IMAGE_BYTES + 1 - total
    if (remaining <= 0) break
    const chunk = Buffer.allocUnsafe(Math.min(READ_CHUNK_BYTES, remaining))
    const { bytesRead } = await handle.read(chunk, 0, chunk.length, total)
    if (bytesRead === 0) break
    chunks.push(chunk.subarray(0, bytesRead))
    total += bytesRead
    if (total > MAX_CLIPBOARD_IMAGE_BYTES) throw new Error(tooLarge)
  }
  if (total !== info.size) throw new Error(incomplete)
  return Buffer.concat(chunks, total)
}

export async function readBoundedClipboardImageFile(path: string): Promise<Buffer> {
  const handle = await fs.open(path, 'r')
  try {
    return await readBoundedClipboardImageHandle(handle)
  } finally {
    await handle.close()
  }
}
