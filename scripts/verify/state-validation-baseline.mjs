#!/usr/bin/env node
// Read-only baseline of MCP round-trip latency and renderer heap for later comparisons.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const cdp = await connectCdp()
const samples = 20
const report = { checkedAt: new Date().toISOString(), samples, metrics: {} }
function summarize(values) {
  const sorted = [...values].sort((a, b) => a - b)
  return { medianMs: sorted[Math.floor(sorted.length * 0.5)], p95Ms: sorted[Math.min(sorted.length - 1, Math.ceil(sorted.length * 0.95) - 1)] }
}
async function measure(name, operation) {
  const values = []
  for (let index = 0; index < samples; index += 1) {
    const started = performance.now()
    const result = await operation()
    assert.notEqual(result?.isError, true)
    values.push(performance.now() - started)
  }
  report.metrics[name] = summarize(values)
}

try {
  const app = await mcpCall('get_app_info')
  report.app = JSON.parse(mcpText(app))
  await measure('get_app_info', () => mcpCall('get_app_info'))
  await measure('list_directory_explorer_plugin', () => mcpCall('list_directory', { path: join(projectRoot, 'src/renderer/src/plugins/data-ops-explorer') }))
  report.rendererHeapBytes = await cdp.evaluate('performance.memory?.usedJSHeapSize ?? null')
  report.visibleFileViewContainers = await cdp.evaluate("document.querySelectorAll('[data-entry-view]').length")
  const screenshotResult = await mcpCall('capture_window')
  const screenshotImage = mcpImage(screenshotResult)
  assert.ok(screenshotImage, mcpText(screenshotResult) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), 'state-validation-baseline.png')
  writeFileSync(report.screenshot, Buffer.from(screenshotImage.data, 'base64'))
} finally {
  cdp.close()
}

writeFileSync(join(ensureOutDir(), 'state-validation-baseline.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
