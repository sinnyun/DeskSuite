#!/usr/bin/env node
// Settings validation smoke: malformed drafts must not write or broadcast saved state.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [] }
async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}
async function runCommand(id, args = []) {
  const commandId = id.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase()
  return mcpCall('command_run', { id: commandId, params: { args } })
}

try {
  const beforeRaw = await runCommand('ipc.settings.get', ['appearance'])
  assert.notEqual(beforeRaw.isError, true)
  const before = JSON.parse(mcpText(beforeRaw))
  const invalid = JSON.parse(await callTool('settings_validate', { namespace: 'appearance', value: { theme: 'ultraviolet' } }))
  assert.equal(invalid.success, false)
  assert.deepEqual(invalid.errors[0]?.path, ['theme'])
  const valid = JSON.parse(await callTool('settings_validate', { namespace: 'appearance', value: { theme: 'dark' } }))
  assert.equal(valid.success, true)
  assert.deepEqual(valid.value, { theme: 'dark' })
  report.checks.push('MCP pre-validation returns normalized values and field paths for invalid drafts')

  const rejectedWrite = await runCommand('ipc.settings.set', ['appearance', { theme: 'ultraviolet' }])
  assert.equal(rejectedWrite.isError, true)
  const afterRaw = await runCommand('ipc.settings.get', ['appearance'])
  assert.deepEqual(JSON.parse(mcpText(afterRaw)), before)
  report.checks.push('invalid settings writes are rejected and leave persisted appearance unchanged')

  const samplePath = join(projectRoot, 'artifacts', 'verify', 'samples', 'versions', 'jinx.jpg')
  const thumbnailRaw = await runCommand('ipc.thumbnails.get', [samplePath])
  assert.notEqual(thumbnailRaw.isError, true, mcpText(thumbnailRaw))
  const thumbnail = JSON.parse(mcpText(thumbnailRaw))
  assert.match(thumbnail.dataUrl, /^data:image\/jpeg;base64,[A-Za-z0-9+/=]+$/)
  report.checks.push('thumbnail cache header validates and a bounded sample image returns a JPEG data URL')

  const tooManyLegacyItems = await runCommand('ipc.clipboard.importLegacy', [Array.from({ length: 501 }, () => 'legacy')])
  assert.equal(tooManyLegacyItems.isError, true)
  const oversizedLegacyPayload = await runCommand('ipc.clipboard.importLegacy', [['a'.repeat(700_000), 'b'.repeat(700_000), 'c'.repeat(700_000)]])
  assert.equal(oversizedLegacyPayload.isError, true)
  report.checks.push('legacy clipboard import rejects excessive item counts and aggregate text size before writing')

  const launcherRaw = await callTool('launcher_list', { offset: 0 })
  const launcherPage = JSON.parse(launcherRaw)
  assert.ok(Array.isArray(launcherPage) && launcherPage.length <= 250)
  assert.ok(launcherPage.every((entry) => typeof entry.id === 'string' && typeof entry.name === 'string' && typeof entry.path === 'string'))
  report.checks.push('PowerShell launcher response is schema-filtered and MCP returns bounded typed entries')

  const auditRaw = await callTool('get_audit_logs', { limit: 20 })
  const auditEntries = JSON.parse(auditRaw)
  assert.ok(Array.isArray(auditEntries) && auditEntries.length <= 20)
  assert.ok(auditEntries.every((entry) => Number.isFinite(entry.ts) && ['ui', 'mcp', 'command'].includes(entry.origin) && typeof entry.tool === 'string'))
  assert.ok(Buffer.byteLength(auditRaw, 'utf8') <= 4 * 1024 * 1024)
  report.checks.push('persistent audit JSONL records are structurally decoded, capped at 20 entries and returned under the 4 MiB tail budget')

  const oversizedMcpResponse = await fetch(process.env.DESKSUITE_MCP_URL ?? 'http://127.0.0.1:9600/mcp', {
    method: 'POST', headers: { 'content-type': 'application/json' },
    body: ' '.repeat(16 * 1024 * 1024 + 1)
  })
  assert.equal(oversizedMcpResponse.status, 413)
  report.checks.push('MCP HTTP rejects request bodies over 16 MiB before JSON parsing')

  const invalidFilesystemArgs = await runCommand('ipc.filesystem.listDir', ['C:\\', 100_000])
  assert.equal(invalidFilesystemArgs.isError, true)
  assert.match(mcpText(invalidFilesystemArgs) ?? '', /^参数校验失败：/)
  const invalidBasketArgs = await runCommand('ipc.basket.add', [[{ path: 'C:\\invalid', name: 'bad', isDirectory: false, kind: 'other', size: -1, modifiedAt: 0 }]])
  assert.equal(invalidBasketArgs.isError, true)
  const invalidAnnotationArgs = await runCommand('ipc.annotations.setRating', [{ path: 'C:\\invalid-zod-schema-test.txt', rating: 9 }])
  assert.equal(invalidAnnotationArgs.isError, true)
  const invalidWorkspaceArgs = await runCommand('ipc.workspaces.setLayout', ['workspace_schema_test', 3])
  assert.equal(invalidWorkspaceArgs.isError, true)
  const invalidSearchArgs = await runCommand('ipc.search.query', [{ query: 42 }])
  assert.equal(invalidSearchArgs.isError, true)
  const invalidLauncherArgs = await runCommand('ipc.launcher.list', [42, -1])
  assert.equal(invalidLauncherArgs.isError, true)
  const invalidIndexArgs = await runCommand('ipc.indexScan.start', [[]])
  assert.equal(invalidIndexArgs.isError, true)
  const invalidLabArgs = await runCommand('ipc.devLab.inject', [0])
  assert.equal(invalidLabArgs.isError, true)
  const invalidResourceArgs = await runCommand('ipc.resources.read', ['resource://invalid', -1])
  assert.equal(invalidResourceArgs.isError, true)
  const invalidFilePlan = await runCommand('ipc.fileOps.plan', [{ op: 'copy', sources: ['C:\\source'], conflictPolicy: 'invalid' }])
  assert.equal(invalidFilePlan.isError, true)
  const invalidNoteDraft = await runCommand('ipc.notePanel.saveDraft', [{ path: 'C:\\draft.md', markdown: 42 }])
  assert.equal(invalidNoteDraft.isError, true)
  const invalidVersionConfirmation = await runCommand('ipc.versions.restore', ['C:\\invalid-version-test.txt', 'rev1', false])
  assert.equal(invalidVersionConfirmation.isError, true)
  const invalidEagleArgs = await runCommand('ipc.eagleLinks.open', ['not-an-eagle-item-id'])
  assert.equal(invalidEagleArgs.isError, true)
  const invalidWhiteboardId = await runCommand('ipc.whiteboard.get', ['../../invalid'])
  assert.equal(invalidWhiteboardId.isError, true)
  const invalidGreeting = await runCommand('ipc.greet.ping', [42])
  assert.equal(invalidGreeting.isError, true)
  const invalidCanvasInputArgs = await runCommand('ipc.canvasInput.clipboardImage', ['unexpected'])
  assert.equal(invalidCanvasInputArgs.isError, true)
  const invalidWorkCrateProjectArgs = await runCommand('ipc.workcrateProjects.get', ['not-a-uuid'])
  assert.equal(invalidWorkCrateProjectArgs.isError, true)
  const invalidWorkCrateBoardsArgs = await runCommand('ipc.workcrateBoards.updateInfo', [{ boardId: 'not-a-uuid:board', info: {} }])
  assert.equal(invalidWorkCrateBoardsArgs.isError, true)
  report.checks.push('filesystem, basket, annotation, workspace, search, launcher, index, dev-lab, resource, file-operation, note-draft, version, Eagle, whiteboard, greeting, canvas-input and WorkCrate IPC arguments are rejected by registered method schemas')

  const unsafeBookmarkPath = join(projectRoot, 'artifacts', 'verify', 'samples', 'missing-bookmark-validation-folder')
  const bookmarkFailure = await mcpCall('quick_bookmarks', { action: 'add', groupId: 'common', paths: [unsafeBookmarkPath] })
  assert.equal(bookmarkFailure.isError, true)
  const bookmarkFailureText = mcpText(bookmarkFailure) ?? ''
  assert.ok(bookmarkFailureText.length > 0)
  assert.doesNotMatch(bookmarkFailureText, /^(Error:|\[object Object\])/)
  report.checks.push('MCP plugin failures return normalized text without Error prefixes or object coercion')

  await callTool('open_settings_page', { page: 'runtime' })
  await new Promise((resolve) => setTimeout(resolve, 1200))
  const screenshotResult = await mcpCall('capture_window')
  const screenshotImage = mcpImage(screenshotResult)
  assert.ok(screenshotImage, mcpText(screenshotResult) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), 'state-validation-s4.png')
  writeFileSync(report.screenshot, Buffer.from(screenshotImage.data, 'base64'))
} finally {
  cdp.close()
}

writeFileSync(join(ensureOutDir(), 'state-validation-s4.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
