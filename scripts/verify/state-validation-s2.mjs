#!/usr/bin/env node
// Explorer pane isolation, request-race and persistence checks through DeskSuite MCP.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), mode: process.argv.includes('--check-restart') ? 'check-restart' : 'prepare', checks: [] }
async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}
async function explorer(args) { return JSON.parse(await callTool('quick_bookmarks_explorer', args)) }
async function readPanes() {
  return cdp.evaluate("Array.from(document.querySelectorAll('[data-file-workspace][data-pane-id]'), node => ({id:node.getAttribute('data-pane-id'), path:node.getAttribute('data-current-path')}))")
}
const docs = join(projectRoot, 'docs')
const src = join(projectRoot, 'src')

try {
  if (report.mode === 'prepare') {
    const workspace = JSON.parse(await callTool('command_run', { id: 'ipc.workspaces.active' }))
    const setup = await explorer({ action: 'layout', layout: 4 })
    const [first, second] = setup.paneIds
    await explorer({ action: 'pane', paneId: first })
    await explorer({ action: 'navigate', path: docs })
    await explorer({ action: 'navigate', path: src })
    await explorer({ action: 'pane', paneId: second })
    await explorer({ action: 'navigate', path: src })
    await new Promise((resolve) => setTimeout(resolve, 500))
    let panes = await readPanes()
    assert.equal(panes.find((pane) => pane.id === first)?.path?.toLowerCase(), src.toLowerCase())
    assert.equal(panes.find((pane) => pane.id === second)?.path?.toLowerCase(), src.toLowerCase())
    report.checks.push('rapid MCP navigation leaves the latest request as the pane result')

    await explorer({ action: 'pane', paneId: first })
    await explorer({ action: 'navigate', path: docs })
    await explorer({ action: 'pane', paneId: second })
    await explorer({ action: 'navigate', path: src })
    await new Promise((resolve) => setTimeout(resolve, 500))
    await explorer({ action: 'layout', layout: 1 })
    await new Promise((resolve) => setTimeout(resolve, 350))
    await explorer({ action: 'layout', layout: 4 })
    await new Promise((resolve) => setTimeout(resolve, 500))
    panes = await readPanes()
    assert.equal(panes.find((pane) => pane.id === first)?.path?.toLowerCase(), docs.toLowerCase())
    assert.equal(panes.find((pane) => pane.id === second)?.path?.toLowerCase(), src.toLowerCase())
    report.checks.push('closed panes release and rebuild with their last persisted independent sessions')
    report.workspace = workspace
  } else {
    const panes = await readPanes()
    assert.ok(panes.length >= 2, 'workspace should restore multiple panes')
    assert.equal(panes[0]?.path?.toLowerCase(), docs.toLowerCase())
    assert.equal(panes[1]?.path?.toLowerCase(), src.toLowerCase())
    report.checks.push('same-profile restart restores the independent pane paths')
  }

  const screenshotResult = await mcpCall('capture_window')
  const screenshotImage = mcpImage(screenshotResult)
  assert.ok(screenshotImage, mcpText(screenshotResult) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), `state-validation-s2-${report.mode}.png`)
  writeFileSync(report.screenshot, Buffer.from(screenshotImage.data, 'base64'))
} finally {
  cdp.close()
}

writeFileSync(join(ensureOutDir(), `state-validation-s2-${report.mode}.json`), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
