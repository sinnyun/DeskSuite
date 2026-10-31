#!/usr/bin/env node
// Exercise the bounded version preview through the MCP command wrapper only.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { randomUUID } from 'node:crypto'
import { join, resolve } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()

async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result) ?? 'MCP call failed'}`)
  const text = mcpText(result)
  assert.ok(text, `${name}: missing text result`)
  return JSON.parse(text)
}

const commands = await call('command_list', { filter: 'ipc.versions.preview' })
const previewCommand = commands.find((command) => command.id === 'ipc.versions.preview')
assert.ok(previewCommand, 'read-only IPC command wrapper ipc.versions.preview is not registered')
assert.equal(previewCommand.source, 'ipc')
assert.equal(previewCommand.mutating, false, 'preview IPC command must remain read-only and avoid approval flow')

const sampleDir = resolve(outDir, 'samples', 'version-preview-mcp')
mkdirSync(sampleDir, { recursive: true })
const samplePath = join(sampleDir, `preview-${randomUUID()}.png`)
writeFileSync(samplePath, Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+/pV8AAAAASUVORK5CYII=',
  'base64'
))
const title = `Preview boundary ${randomUUID().slice(0, 8)}`
const { jobId } = await call('versions_create', { path: samplePath, title, confirm: true })
assert.equal(typeof jobId, 'string')
let finished = false
for (let attempt = 0; attempt < 240; attempt += 1) {
  const status = await call('get_job_status', { jobId })
  if (status.state !== 'running') {
    assert.equal(status.state, 'done', status.error)
    finished = true
    break
  }
  await new Promise((resolve) => setTimeout(resolve, 150))
}
assert.ok(finished, 'version create job timed out')

const versions = await call('versions_list', { path: samplePath })
assert.ok(Array.isArray(versions))
const version = versions.find((entry) => entry.title === title && typeof entry.thumbnailPath === 'string' && entry.thumbnailPath.length > 0)
assert.ok(version, 'MCP snapshot did not produce a persisted JPEG preview fixture')

// `command_run` accepts args in positional IPC order; the command registry classifies `preview` as read-only.
const dataUrl = await call('command_run', {
  id: 'ipc.versions.preview',
  params: { args: [samplePath, version.versionId] }
})
assert.equal(typeof dataUrl, 'string')
const match = /^data:image\/jpeg;base64,([A-Za-z0-9+/=]+)$/.exec(dataUrl)
assert.ok(match, 'preview IPC returned no bounded JPEG data URL')
const bytes = Buffer.from(match[1], 'base64')
assert.ok(bytes.length > 3 && bytes.length <= 512 * 1024)
assert.deepEqual([...bytes.subarray(0, 3)], [0xff, 0xd8, 0xff])

const captureResult = await mcpCall('capture_window', {})
const screenshot = mcpImage(captureResult)
assert.ok(screenshot?.mimeType === 'image/png', mcpText(captureResult) ?? 'capture_window did not return a PNG')
const screenshotPath = join(outDir, 'version-preview-mcp-window.png')
writeFileSync(screenshotPath, Buffer.from(screenshot.data, 'base64'))
const reportPath = join(outDir, 'version-preview-mcp.json')
writeFileSync(reportPath, `${JSON.stringify({
  status: 'passed', samplePath, versionId: version.versionId, previewBytes: bytes.length,
  commandId: previewCommand.id, readOnly: !previewCommand.mutating, screenshotPath
}, null, 2)}\n`)
console.log(`versions.preview MCP command smoke passed; report: ${reportPath}; screenshot: ${screenshotPath}`)
