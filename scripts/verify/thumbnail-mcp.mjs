import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText } from './common.mjs'

const verifyDir = ensureOutDir()
const sampleDir = join(verifyDir, 'samples', 'thumbnail-mcp')
mkdirSync(sampleDir, { recursive: true })
const fixturePath = join(sampleDir, 'fixture.png')
writeFileSync(fixturePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pV8AAAAASUVORK5CYII=',
  'base64'
))

await mcpHandshake()
const thumbnailResult = await mcpCall('thumbnail_get', { path: fixturePath, edge: 64 })
const thumbnail = mcpImage(thumbnailResult)
assert.ok(thumbnail, mcpText(thumbnailResult) ?? 'thumbnail_get did not return an image block')
assert.equal(thumbnail.mimeType, 'image/jpeg')
const thumbnailBytes = Buffer.from(thumbnail.data, 'base64')
assert.deepEqual([...thumbnailBytes.subarray(0, 3)], [0xff, 0xd8, 0xff])
const thumbnailPath = join(verifyDir, 'thumbnail-mcp-result.jpg')
writeFileSync(thumbnailPath, thumbnailBytes)

const invalidResult = await mcpCall('thumbnail_get', { path: fixturePath, edge: 32 })
assert.equal(invalidResult?.isError, true, 'out-of-range edge must be rejected')

const captureResult = await mcpCall('capture_window', {})
const capture = mcpImage(captureResult)
assert.ok(capture, mcpText(captureResult) ?? 'capture_window did not return an image block')
assert.equal(capture.mimeType, 'image/png')
const screenshotPath = join(verifyDir, 'thumbnail-mcp-window.png')
writeFileSync(screenshotPath, Buffer.from(capture.data, 'base64'))

const reportPath = join(verifyDir, 'thumbnail-mcp.json')
writeFileSync(reportPath, `${JSON.stringify({
  status: 'passed', fixturePath, thumbnailMimeType: thumbnail.mimeType,
  thumbnailBytes: thumbnailBytes.length, invalidEdgeRejected: true,
  thumbnailPath, screenshotPath, capturedAt: new Date().toISOString()
}, null, 2)}\n`)
console.log(`thumbnail_get MCP OK; report: ${reportPath}; screenshot: ${screenshotPath}`)
