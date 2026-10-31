#!/usr/bin/env node
// Read the live storage inventory via MCP, then open the renderer page through its MCP route.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { storageSnapshotSchema } from '../../src/renderer/src/plugins/system-basic-settings/storage-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], groupCount: 0, entryCount: 0, screenshot: null }

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

try {
  const snapshot = parseJson(await mcpCall('plugin_storage'), 'plugin_storage')
  const decoded = storageSnapshotSchema.safeParse(snapshot)
  assert.ok(decoded.success, `live snapshot rejected by production renderer schema: ${decoded.success ? '' : decoded.error.message}`)
  assert.ok(decoded.data.groups.length > 0)
  report.groupCount = decoded.data.groups.length
  report.entryCount = decoded.data.groups.reduce((total, group) => total + group.entries.length, 0)
  report.checks.push('read-only MCP plugin_storage result parses with the production renderer Zod schema')

  const bad = storageSnapshotSchema.safeParse({ ...decoded.data, groups: [{
    ...decoded.data.groups[0], entries: [{ ...decoded.data.groups[0].entries[0], size: -1 }]
  }] })
  assert.equal(bad.success, false, 'production decoder accepted a negative storage size')
  report.checks.push('production renderer decoder rejects an invalid storage entry')

  const opened = await mcpCall('open_settings_page', { page: 'storage' })
  assert.notEqual(opened?.isError, true, `open_settings_page: ${mcpText(opened) ?? 'MCP error'}`)
  let body = ''
  for (let attempt = 0; attempt < 60; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes('合计占用')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.match(body, /合计占用/)
  assert.match(body, /个来源/)
  assert.match(body, /个文件/)
  report.checks.push('MCP opened the storage page; CDP read-only inspection confirms decoded storage summary rendered')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'storage-settings-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'storage-settings-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await mcpCall('command_run', { id: 'ui.close-panel', params: {} }).catch(() => undefined)
  cdp.close()
}
