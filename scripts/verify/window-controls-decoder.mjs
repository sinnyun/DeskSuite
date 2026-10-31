#!/usr/bin/env node
// Read the live window-state IPC through MCP and confirm the renderer's initial state is decoded.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { windowStateSchema } from '../../src/renderer/src/plugins/system-basic-window-controls/window-state-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], windowState: null, screenshot: null }

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

try {
  const state = parseJson(await mcpCall('command_run', { id: 'ipc.window.control.state', params: { args: [] } }), 'windowControl.state')
  const decoded = windowStateSchema.safeParse(state)
  assert.ok(decoded.success, `live state rejected by production renderer decoder: ${decoded.success ? '' : decoded.error.message}`)
  report.windowState = decoded.data
  report.checks.push('MCP windowControl.state response parses through the production renderer schema')

  const invalid = windowStateSchema.safeParse({ ...decoded.data, maximized: 'yes' })
  assert.equal(invalid.success, false, 'production decoder accepted a non-boolean window state')
  const extra = windowStateSchema.safeParse({ ...decoded.data, unexpected: true })
  assert.equal(extra.success, false, 'production decoder accepted an unexpected field')
  report.checks.push('production renderer decoder rejects malformed and extended window states')

  let title = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    title = await cdp.evaluate(`Array.from(document.querySelectorAll('button[title]'), (button) => button.getAttribute('title')).find((value) => value === '最大化' || value === '还原窗口') ?? ''`)
    if (title) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(title, decoded.data.maximized ? '还原窗口' : '最大化')
  report.checks.push('CDP read-only inspection confirms the renderer initial state matches the MCP snapshot')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'window-controls-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'window-controls-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
