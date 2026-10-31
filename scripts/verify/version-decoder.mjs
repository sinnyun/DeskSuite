#!/usr/bin/env node
// Version renderer decoder smoke: all state changes use DeskSuite MCP; CDP is read-only.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { resolve, dirname } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

const samplePath = resolve('artifacts/verify/samples/versions/jinx.jpg')
const report = { checkedAt: new Date().toISOString(), checks: [] }
const cdp = await connectCdp()

async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.notEqual(result?.isError, true, `${name}: ${mcpText(result)}`)
  return JSON.parse(mcpText(result) ?? 'null')
}

async function waitForVersionPanel() {
  for (let attempt = 0; attempt < 60; attempt++) {
    const text = await cdp.evaluate('document.body.innerText')
    if (text.includes('版本历史') && (text.includes('与当前版本一致') || text.includes('尚未保存'))) return text
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('版本面板未显示已解码的版本状态')
}

try {
  await mcpHandshake()
  await call('command_run', { id: 'ui.close-panel', params: {} })
  const state = await call('versions_state', { path: samplePath })
  const versions = await call('versions_list', { path: samplePath })
  const graph = await call('versions_branch_graph', { path: samplePath, includeArchived: true })
  assert.ok(['unversioned', 'saved', 'matches_saved_version', 'modified', 'unknown', 'unavailable', 'interrupted_restore'].includes(state.status))
  assert.ok(Array.isArray(versions) && versions.length <= 500)
  assert.ok(graph && Array.isArray(graph.branches))
  report.checks.push('versions_state, versions_list and versions_branch_graph return bounded MCP payloads')

  if (versions.length === 0) {
    const { jobId } = await call('versions_create', { path: samplePath, title: 'Decoder smoke', confirm: true })
    let finished = false
    for (let attempt = 0; attempt < 120; attempt++) {
      const job = await call('get_job_status', { jobId })
      if (job.state !== 'running') {
        assert.equal(job.state, 'done', job.error)
        finished = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 150))
    }
    assert.ok(finished, 'version create job timed out')
    report.checks.push('isolated sample acquired a version checkpoint via MCP')
  }

  await call('quick_bookmarks_explorer', { action: 'navigate', path: dirname(samplePath) })
  await call('quick_bookmarks_explorer', { action: 'select', paths: [samplePath] })
  const opened = await call('command_run', { id: 'ui.open-tab', params: { region: 'right', id: 'versions' } })
  assert.equal(opened.action, 'tab.open:right:versions')
  const panelText = await waitForVersionPanel()
  assert.ok(panelText.includes('版本历史'))
  report.checks.push('renderer validates version list/state/graph and opens the selected file panel')

  const shot = mcpImage(await mcpCall('capture_window'))
  assert.ok(shot?.data, 'capture_window did not return an image')
  ensureOutDir()
  writeFileSync(resolve(outDir, 'version-decoder.png'), Buffer.from(shot.data, 'base64'))
} finally {
  cdp.close()
}

report.screenshot = resolve(outDir, 'version-decoder.png')
console.log(JSON.stringify(report, null, 2))
