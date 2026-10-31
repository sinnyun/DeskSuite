#!/usr/bin/env node
// Pure production-helper assertions; does not start the application.
import assert from 'node:assert/strict'
import { MAX_VERSION_PREVIEW_BYTES, readBoundedVersionPreviewHandle } from '../../src/main/plugins/data-ops-versions/preview-file.ts'

function fakeHandle({ reportedSize, bytes, isFile = true, dev = 1, ino = 2 }) {
  let bytesReadTotal = 0
  return {
    get bytesReadTotal() { return bytesReadTotal },
    async stat() { return { isFile: () => isFile, size: reportedSize, dev, ino } },
    async read(buffer, offset, length, position) {
      const count = Math.min(length, Math.max(0, bytes.length - position))
      bytes.copy(buffer, offset, position, position + count)
      bytesReadTotal += count
      return { bytesRead: count }
    }
  }
}

const exactBytes = Buffer.alloc(MAX_VERSION_PREVIEW_BYTES, 0x5a)
const exact = fakeHandle({ reportedSize: exactBytes.length, bytes: exactBytes })
assert.equal((await readBoundedVersionPreviewHandle(exact, { dev: 1, ino: 2 }))?.length, MAX_VERSION_PREVIEW_BYTES)
assert.equal(exact.bytesReadTotal, MAX_VERSION_PREVIEW_BYTES)

const grown = fakeHandle({ reportedSize: 8, bytes: Buffer.alloc(MAX_VERSION_PREVIEW_BYTES + 32, 0x61) })
assert.equal(await readBoundedVersionPreviewHandle(grown, { dev: 1, ino: 2 }), null)
assert.equal(grown.bytesReadTotal, MAX_VERSION_PREVIEW_BYTES + 1, 'growth after fstat is rejected after at most max + 1 bytes')

const oversized = fakeHandle({ reportedSize: MAX_VERSION_PREVIEW_BYTES + 1, bytes: Buffer.alloc(MAX_VERSION_PREVIEW_BYTES + 1) })
assert.equal(await readBoundedVersionPreviewHandle(oversized, { dev: 1, ino: 2 }), null)
assert.equal(oversized.bytesReadTotal, 0, 'pre-existing oversize is rejected before reading')

const replaced = fakeHandle({ reportedSize: 8, bytes: Buffer.alloc(8), ino: 3 })
assert.equal(await readBoundedVersionPreviewHandle(replaced, { dev: 1, ino: 2 }), null)
assert.equal(replaced.bytesReadTotal, 0, 'a path replaced between lstat and open is rejected by handle identity')

const nonFile = fakeHandle({ reportedSize: 0, bytes: Buffer.alloc(0), isFile: false })
assert.equal(await readBoundedVersionPreviewHandle(nonFile, { dev: 1, ino: 2 }), null)

const shrunk = fakeHandle({ reportedSize: 100, bytes: Buffer.alloc(12) })
assert.equal((await readBoundedVersionPreviewHandle(shrunk, { dev: 1, ino: 2 }))?.length, 12, 'readFile-compatible shrink behavior remains accepted')

console.log('Version preview bounded-read assertions passed (exact limit, growth, pre-existing oversize, replaced file, non-file, shrink).')
