#!/usr/bin/env node
// S3 host state smoke: exercise the theme command through MCP and inspect rendered logs.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText } from './common.mjs'

await mcpHandshake()
const report = { checkedAt: new Date().toISOString(), checks: [] }
const cdp = await connectCdp()
async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}
async function runCommand(id, params = {}) {
  return callTool('command_run', { id, params })
}
const initialDark = await cdp.evaluate("document.documentElement.classList.contains('dark')")

try {
  await runCommand('system.toggle-theme')
  await new Promise((resolve) => setTimeout(resolve, 150))
  const toggledDark = await cdp.evaluate("document.documentElement.classList.contains('dark')")
  assert.notEqual(toggledDark, initialDark)
  await runCommand('system.toggle-theme')
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(await cdp.evaluate("document.documentElement.classList.contains('dark')"), initialDark)
  report.checks.push('theme mode changes through MCP and returns to its initial appearance')

  const initialSidebarWidth = await cdp.evaluate("document.querySelector('[data-sidebar=left]')?.getBoundingClientRect().width ?? null")
  const initialSidebarPresent = initialSidebarWidth !== null
  await runCommand('ui.toggle-zen-mode')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(await cdp.evaluate("document.querySelector('[data-sidebar=left]') !== null"), !initialSidebarPresent)
  await runCommand('ui.toggle-zen-mode')
  await new Promise((resolve) => setTimeout(resolve, 300))
  assert.equal(await cdp.evaluate("document.querySelector('[data-sidebar=left]') !== null"), initialSidebarPresent)
  assert.equal(await cdp.evaluate("document.querySelector('[data-sidebar=left]')?.getBoundingClientRect().width ?? null"), initialSidebarWidth)
  report.checks.push('layout actions collapse and restore sidebars through the Zustand host store')

  await runCommand('system.set-font-audit', { enabled: true })
  await new Promise((resolve) => setTimeout(resolve, 100))
  assert.equal(await cdp.evaluate("document.documentElement.classList.contains('desksuite-font-audit')"), true)
  await runCommand('system.set-plugin-enabled', { id: 'system-basic-font-audit', enabled: false })
  await new Promise((resolve) => setTimeout(resolve, 120))
  assert.equal(await cdp.evaluate("document.documentElement.classList.contains('desksuite-font-audit')"), false)
  await runCommand('system.set-plugin-enabled', { id: 'system-basic-font-audit', enabled: true })
  await new Promise((resolve) => setTimeout(resolve, 150))
  assert.equal(await cdp.evaluate("document.documentElement.classList.contains('desksuite-font-audit')"), true)
  await runCommand('system.set-font-audit', { enabled: false })
  report.checks.push('MCP plugin disable/re-enable runs dispose/setup and restores the persisted font-audit preference')

  await runCommand('ui.open-panel', { panel: 'debug-console' })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const consoleState = await cdp.evaluate(`({
    text: document.body.innerText
  })`)
  assert.ok(consoleState.text.includes('渲染进程工作台启动'), 'debug console should display renderer log entries')
  report.checks.push('debug console renders bounded startup log entries from the Zustand log store')

  const screenshotResult = await mcpCall('capture_window')
  const screenshotImage = mcpImage(screenshotResult)
  assert.ok(screenshotImage, mcpText(screenshotResult) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), 'state-validation-s3.png')
  writeFileSync(report.screenshot, Buffer.from(screenshotImage.data, 'base64'))
} finally {
  cdp.close()
}

writeFileSync(join(ensureOutDir(), 'state-validation-s3.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
