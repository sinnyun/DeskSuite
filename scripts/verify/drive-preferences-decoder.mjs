#!/usr/bin/env node
// Toggle network-drive visibility through MCP and inspect the renderer state read-only.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { drivePreferencesSchema } from '../../src/renderer/src/plugins/data-ops-explorer/drive-preferences-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], driveCount: 0, networkDriveCount: 0, screenshots: [] }
const decode = (value, label) => {
  const parsed = drivePreferencesSchema.safeParse(value)
  assert.ok(parsed.success, `${label}: ${parsed.success ? '' : parsed.error.message}`)
  return parsed.data
}
async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${name}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${name}: invalid JSON response`) }
}
const readUi = () => cdp.evaluate(`(() => {
  const toggle = document.querySelector('[data-network-drive-toggle]')
  return { pressed: toggle?.getAttribute('aria-pressed'), disabled: toggle?.disabled,
    paths: [...document.querySelectorAll('[data-drive-path]')].map(el => el.dataset.drivePath),
    networkCount: document.querySelectorAll('[data-network-drive="true"]').length }
})()`)
async function waitUi(show, expectedPaths) {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const state = await readUi()
    if (state.pressed === String(show) && !state.disabled && JSON.stringify(state.paths) === JSON.stringify(expectedPaths)) return state
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`FileTree did not match showNetworkDrives=${show}: ${JSON.stringify(await readUi())}`)
}
async function capture(name) {
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const path = join(outDir, name)
  await writeFile(path, Buffer.from(image.data, 'base64'))
  report.screenshots.push(path)
}

try {
  const initial = decode(await call('explorer_drive_preferences'), 'initial explorer_drive_preferences')
  assert.equal(initial.showNetworkDrives, true, 'fresh isolated profile should use the default preference')
  const drives = await call('list_drives')
  assert.ok(Array.isArray(drives) && drives.length > 0)
  assert.ok(drives.every((drive) => typeof drive.path === 'string' && typeof drive.isNetwork === 'boolean'))
  const allPaths = drives.map((drive) => drive.path)
  const localPaths = drives.filter((drive) => !drive.isNetwork).map((drive) => drive.path)
  report.driveCount = drives.length
  report.networkDriveCount = drives.length - localPaths.length
  report.checks.push('MCP preference snapshot parses with the production renderer schema')

  const malformed = drivePreferencesSchema.safeParse({ showNetworkDrives: 'false' })
  assert.equal(malformed.success, false, 'production decoder accepted a non-boolean preference')

  const hidden = decode(await call('explorer_drive_preferences', { showNetworkDrives: false }), 'hide network drives')
  assert.equal(hidden.showNetworkDrives, false)
  const hiddenUi = await waitUi(false, localPaths)
  assert.equal(hiddenUi.networkCount, 0)
  report.checks.push('MCP preference update emitted filesystem:drivePreferences and the renderer event decoder updated FileTree')
  assert.equal((await call('list_drives')).length, drives.length, 'visibility preference changed the complete drives API')
  await capture('drive-preferences-hidden.png')

  const visible = decode(await call('explorer_drive_preferences', { showNetworkDrives: true }), 'restore network drives')
  assert.equal(visible.showNetworkDrives, true)
  await waitUi(true, allPaths)
  report.checks.push('MCP restored the default visibility; CDP read-only path list matches all drives')
  await capture('drive-preferences-visible.png')
  await writeFile(join(outDir, 'drive-preferences-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await call('explorer_drive_preferences', { showNetworkDrives: true }).catch(() => undefined)
  cdp.close()
}
