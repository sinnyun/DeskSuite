#!/usr/bin/env node
// Read-only launcher boundary check. All navigation is via MCP; CDP only reads rendered text.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], entryCount: 0, groupCount: 0, screenshot: null }
function jsonResult(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON result`) }
}

try {
  const entries = jsonResult(await mcpCall('launcher_list', { offset: 0 }), 'launcher_list')
  assert.ok(Array.isArray(entries) && entries.length <= 250, 'launcher_list must return at most 250 entries')
  for (const entry of entries) {
    assert.equal(typeof entry.id, 'string')
    assert.equal(typeof entry.name, 'string')
    assert.equal(typeof entry.path, 'string')
    assert.ok(entry.kind === 'shortcut' || entry.kind === 'application')
    assert.ok(entry.title === undefined || typeof entry.title === 'string')
  }
  report.entryCount = entries.length
  report.checks.push('MCP launcher_list returned structurally valid launcher entries')

  const library = jsonResult(await mcpCall('launcher_groups'), 'launcher_groups')
  assert.ok(library && typeof library === 'object' && Array.isArray(library.groups))
  assert.ok(library.groups.length <= 100)
  for (const group of library.groups) {
    assert.equal(typeof group.id, 'string')
    assert.equal(typeof group.name, 'string')
    assert.ok(Number.isFinite(group.createdAt))
  }
  report.groupCount = library.groups.length
  report.checks.push('MCP launcher_groups returned structurally valid persisted groups')

  const opened = jsonResult(await mcpCall('command_run', { id: 'ui.open-panel', params: { panel: 'launcher' } }), 'ui.open-panel')
  assert.equal(opened.panel, 'launcher')
  let body = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes('应用启动台')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(body.includes('应用启动台'), 'launcher panel did not render')
  assert.doesNotMatch(body, /IPC 返回值校验失败|格式无效|Invalid input/i)
  report.checks.push('MCP opened launcher; read-only CDP text confirms panel rendered without decoder errors')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'launcher-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'launcher-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
