#!/usr/bin/env node
// Open updater through MCP; CDP is limited to read-only DOM inspection and MCP capture.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], networkCheckPerformed: false, downloadPerformed: false, installPerformed: false }

async function command(id, params = {}) {
  const result = await mcpCall('command_run', { id, params })
  assert.notEqual(result?.isError, true, `${id}: ${mcpText(result)}`)
}

try {
  await command('ui.open-panel', { panel: 'updater' })
  let body = ''
  for (let attempt = 0; attempt < 60; attempt++) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes('当前版本') && !body.includes('读取中…')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.match(body, /当前版本\s*\n?\s*\d+\.\d+\.\d+/)
  assert.doesNotMatch(body, /更新状态数据格式无效|Invalid input/i)
  report.checks.push('MCP opens updater; updater.get response passes Zod decoder and renders current version')
  const shot = mcpImage(await mcpCall('capture_window'))
  assert.ok(shot?.data, mcpText(shot) ?? 'capture_window did not return an image')
  ensureOutDir()
  writeFileSync(resolve(outDir, 'updater-decoder.png'), Buffer.from(shot.data, 'base64'))
} finally {
  await command('ui.close-panel').catch(() => {})
  cdp.close()
}

report.screenshot = resolve(outDir, 'updater-decoder.png')
console.log(JSON.stringify(report, null, 2))
