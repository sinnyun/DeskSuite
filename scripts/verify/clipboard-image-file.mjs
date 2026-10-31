#!/usr/bin/env node
// Pure production-helper assertions for clipboard history image reads; does not start the app.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { MAX_CLIPBOARD_IMAGE_BYTES, readBoundedClipboardImageHandle } from '../../src/main/plugins/system-basic-clipboard/image-file.ts'
import { ensureOutDir, outDir } from './common.mjs'

function fakeHandle({ reportedSize, bytes }) {
  let bytesReadTotal = 0
  return {
    get bytesReadTotal() { return bytesReadTotal },
    async stat() { return { isFile: () => true, size: reportedSize } },
    async read(buffer, offset, length, position) {
      const count = Math.min(length, Math.max(0, bytes.length - position))
      bytes.copy(buffer, offset, position, position + count)
      bytesReadTotal += count
      return { bytesRead: count }
    }
  }
}

const full = fakeHandle({ reportedSize: MAX_CLIPBOARD_IMAGE_BYTES, bytes: Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES, 0x5a) })
const fullResult = await readBoundedClipboardImageHandle(full)
assert.equal(fullResult.byteLength, MAX_CLIPBOARD_IMAGE_BYTES, 'the exact limit is accepted')
assert.equal(full.bytesReadTotal, MAX_CLIPBOARD_IMAGE_BYTES, 'the one-byte EOF probe at the limit does not return extra data')

const grown = fakeHandle({ reportedSize: 64, bytes: Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 64, 0x61) })
await assert.rejects(readBoundedClipboardImageHandle(grown), /超过 8MB/)
assert.equal(grown.bytesReadTotal, MAX_CLIPBOARD_IMAGE_BYTES + 1, 'a file that grows after fstat is rejected after only max + 1 bytes')

const alreadyLarge = fakeHandle({ reportedSize: MAX_CLIPBOARD_IMAGE_BYTES + 1, bytes: Buffer.alloc(MAX_CLIPBOARD_IMAGE_BYTES + 1) })
await assert.rejects(readBoundedClipboardImageHandle(alreadyLarge), /超过 8MB/)
assert.equal(alreadyLarge.bytesReadTotal, 0, 'an already oversized file is rejected before reading')

const truncated = fakeHandle({ reportedSize: 100, bytes: Buffer.alloc(10) })
await assert.rejects(readBoundedClipboardImageHandle(truncated), /读取不完整/)

ensureOutDir()
const reportPath = join(outDir, 'clipboard-image-file.json')
await writeFile(reportPath, `${JSON.stringify({
  status: 'passed', maxBytes: MAX_CLIPBOARD_IMAGE_BYTES,
  cases: ['exact limit', 'growth after fstat rejects at max + 1', 'already oversized rejects before read', 'truncated after fstat remains incomplete'],
  reportPath
}, null, 2)}\n`, 'utf8')
console.log(`Clipboard bounded-image reader assertions passed; report: ${reportPath}`)
