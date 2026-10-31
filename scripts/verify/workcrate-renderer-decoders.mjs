#!/usr/bin/env node
// WorkCrate renderer decoder smoke: read-only MCP queries, panel navigation, and MCP screenshot.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [] }

async function readTool(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result)}`)
  return JSON.parse(mcpText(result) ?? 'null')
}

try {
  const [projects, presets, config] = await Promise.all([
    readTool('workcrate_projects_list'),
    readTool('workcrate_program_presets_get'),
    readTool('workcrate_vectorcraft_config_get')
  ])
  assert.ok(Array.isArray(projects) && projects.length <= 1000)
  assert.ok(presets && Array.isArray(presets.fields) && presets.fields.length <= 100)
  assert.ok(config && typeof config.cliExecutable === 'string' && typeof config.guiExecutable === 'string')
  assert.ok(['png', 'jpg'].includes(config.defaultImageFormat) && Number.isInteger(config.port) && config.port >= 1 && config.port <= 65535)
  report.checks.push('MCP project list, presets, and VectorCraft config queries return bounded valid data')

  const opened = await mcpCall('workcrate_panel_open', { section: 'basic' })
  assert.notEqual(opened?.isError, true, `workcrate_panel_open: ${mcpText(opened)}`)
  let visible = false
  for (let attempt = 0; attempt < 60; attempt++) {
    const state = await cdp.evaluate(`({ view: document.querySelector('[data-workcrate-view]')?.getAttribute('data-workcrate-view'), text: document.body.innerText })`)
    if (state?.view === 'settings' && state.text.includes('程序默认信息') && state.text.includes('基础信息')) { visible = true; break }
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.ok(visible, 'WorkCrate settings event and renderer decoders did not settle in 6 seconds')
  report.checks.push('MCP panel-open event loads the settings tab and renderer decodes config and preset responses')

  const screenshot = mcpImage(await mcpCall('capture_window'))
  assert.ok(screenshot?.data, 'capture_window did not return an image')
  report.screenshot = resolve(outDir, 'workcrate-renderer-decoders.png')
  writeFileSync(report.screenshot, Buffer.from(screenshot.data, 'base64'))
} finally {
  cdp.close()
}

console.log(JSON.stringify(report, null, 2))
