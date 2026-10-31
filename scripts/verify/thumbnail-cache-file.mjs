#!/usr/bin/env node
// Pure production-helper assertions; does not start the application.
import assert from 'node:assert/strict'
import { MAX_THUMBNAIL_CACHE_FILE_BYTES, readBoundedThumbnailCacheHandle } from '../../src/main/plugins/data-provider-thumbnails/cache-file.ts'

function fakeHandle({ reportedSize, bytes, isFile = true }) {
  let bytesReadTotal = 0
  return {
    get bytesReadTotal() { return bytesReadTotal },
    async stat() { return { isFile: () => isFile, size: reportedSize, mtimeMs: 123 } },
    async read(buffer, offset, length, position) {
      const count = Math.min(length, Math.max(0, bytes.length - position))
      bytes.copy(buffer, offset, position, position + count)
      bytesReadTotal += count
      return { bytesRead: count }
    }
  }
}

const exactBytes = Buffer.alloc(MAX_THUMBNAIL_CACHE_FILE_BYTES, 0x5a)
const exact = fakeHandle({ reportedSize: exactBytes.length, bytes: exactBytes })
const exactResult = await readBoundedThumbnailCacheHandle(exact)
assert.equal(exactResult.bytes.length, MAX_THUMBNAIL_CACHE_FILE_BYTES)
assert.equal(exactResult.size, MAX_THUMBNAIL_CACHE_FILE_BYTES)
assert.equal(exactResult.mtimeMs, 123)
assert.equal(exact.bytesReadTotal, MAX_THUMBNAIL_CACHE_FILE_BYTES)

const grown = fakeHandle({ reportedSize: 16, bytes: Buffer.alloc(MAX_THUMBNAIL_CACHE_FILE_BYTES + 128, 0x61) })
await assert.rejects(readBoundedThumbnailCacheHandle(grown), /exceeds 2 MiB/)
assert.equal(grown.bytesReadTotal, MAX_THUMBNAIL_CACHE_FILE_BYTES + 1)

const oversized = fakeHandle({ reportedSize: MAX_THUMBNAIL_CACHE_FILE_BYTES + 1, bytes: Buffer.alloc(MAX_THUMBNAIL_CACHE_FILE_BYTES + 1) })
await assert.rejects(readBoundedThumbnailCacheHandle(oversized), /exceeds 2 MiB/)
assert.equal(oversized.bytesReadTotal, 0)

const truncated = fakeHandle({ reportedSize: 128, bytes: Buffer.alloc(7) })
await assert.rejects(readBoundedThumbnailCacheHandle(truncated), /changed while being read/)

const directory = fakeHandle({ reportedSize: 0, bytes: Buffer.alloc(0), isFile: false })
await assert.rejects(readBoundedThumbnailCacheHandle(directory), /regular file/)

console.log('Thumbnail cache bounded-read assertions passed (exact limit, post-fstat growth, pre-existing oversize, truncation, non-file).')
