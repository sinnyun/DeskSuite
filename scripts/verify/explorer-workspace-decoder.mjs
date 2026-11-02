#!/usr/bin/env node
// Read-only IPC payload check for Explorer workspaces. CDP is limited to DOM reads; screenshot uses MCP.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], workspaces: 0, panes: 0, screenshot: null }
function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}
async function runIpc(id) {
  return parseJson(await mcpCall('command_run', { id: `ipc.${id}`, params: { args: [] } }), id)
}

try {
  const catalog = await runIpc('workspaces.list')
  assert.ok(catalog && typeof catalog === 'object' && !Array.isArray(catalog))
  assert.ok(catalog.activeId === null || typeof catalog.activeId === 'string')
  assert.ok(catalog.activePaneId === null || typeof catalog.activePaneId === 'string')
  assert.ok(Array.isArray(catalog.items) && catalog.items.length <= 10000)
  for (const workspace of catalog.items) {
    assert.equal(typeof workspace.id, 'string')
    assert.equal(typeof workspace.name, 'string')
    assert.ok([1, 2, 4].includes(workspace.layout))
    assert.ok(Array.isArray(workspace.panes) && workspace.panes.length >= 1 && workspace.panes.length <= 4)
    for (const pane of workspace.panes) {
      assert.equal(typeof pane.id, 'string')
      assert.ok(pane.state && typeof pane.state === 'object')
      assert.ok(['list', 'grid', 'gallery', 'grouped'].includes(pane.state.viewMode))
      assert.ok(['name', 'size', 'modifiedAt', 'kind', 'rating'].includes(pane.state.sortField))
      assert.ok(['all', 'folder', 'code', 'image', 'document', 'data', 'archive', 'video', 'audio', 'other'].includes(pane.state.kindFilter))
      assert.ok(Array.isArray(pane.state.expandedDirectories))
      assert.ok(!('selectedPaths' in pane.state) && !('focusedPath' in pane.state) && !('scrollAnchor' in pane.state),
        'pane state must not carry runtime-only selection/scroll fields')
      assert.ok(pane.state.tagFocus === null || Number.isInteger(pane.state.tagFocus?.tagId) && typeof pane.state.tagFocus?.name === 'string')
      report.panes += 1
    }
  }
  report.workspaces = catalog.items.length
  report.checks.push('MCP workspaces.list returned workspace and pane snapshots with the fields consumed by Explorer')

  const session = await runIpc('session.get')
  assert.ok(session && typeof session === 'object' && !Array.isArray(session))
  assert.ok(session.path === null || typeof session.path === 'string')
  assert.ok(['list', 'grid', 'gallery', 'grouped'].includes(session.viewMode))
  assert.ok(Array.isArray(session.expandedDirectories))
  assert.ok(!('selectedPaths' in session) && !('focusedPath' in session) && !('scrollAnchor' in session),
    'session snapshot must not carry runtime-only selection/scroll fields')
  report.checks.push('MCP session.get returned a valid active-pane fallback snapshot')

  const ui = await cdp.evaluate(`(() => ({ workspaceToolbar: !!document.querySelector('[data-workspace-tools]'),
    paneLayout: !!document.querySelector('[data-workspace-layout]'),
    decoderError: /IPC 返回值校验失败|格式无效|Invalid input/i.test(document.body.innerText) }))()`)
  assert.ok(ui.workspaceToolbar && ui.paneLayout, 'Explorer workspace controls did not render')
  assert.equal(ui.decoderError, false, 'Explorer rendered a decoder error')
  report.checks.push('CDP read-only DOM inspection confirms workspace controls rendered without decoder errors')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'explorer-workspace-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'explorer-workspace-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
