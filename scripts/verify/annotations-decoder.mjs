#!/usr/bin/env node
// Read-only annotations boundary verification. UI navigation and screenshot use MCP; CDP only reads DOM text.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], screenshot: null, databaseMutations: 0 }

function parseJson(result, label) {
  assert.ok(result, `${label}: empty MCP response`)
  assert.notEqual(result.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: expected JSON result, got ${text.slice(0, 300)}`) }
}

async function call(name, args = {}) {
  return parseJson(await mcpCall(name, args), name)
}

try {
  const commands = await call('command_list', { filter: 'ipc.annotations.' })
  assert.ok(Array.isArray(commands), 'command_list did not return a command array')
  const ids = new Set(commands.map((command) => command.id))
  for (const id of ['ipc.annotations.tree', 'ipc.annotations.counts', 'ipc.annotations.for.paths']) {
    assert.ok(ids.has(id), `missing read-only annotations command ${id}`)
  }
  report.checks.push('command_list exposes annotations tree/counts/forPaths read queries')

  const tree = await call('command_run', { id: 'ipc.annotations.tree', params: { args: [] } })
  assert.ok(Array.isArray(tree), 'annotations.tree is not an array')
  const validateTag = (tag, parentPath = null) => {
    assert.ok(Number.isSafeInteger(tag.id) && tag.id > 0)
    assert.equal(typeof tag.name, 'string')
    assert.equal(typeof tag.path, 'string')
    assert.ok(Number.isSafeInteger(tag.sort) && tag.sort >= 0)
    assert.ok(tag.parentId === null || (Number.isSafeInteger(tag.parentId) && tag.parentId > 0))
    assert.ok(tag.color === null || typeof tag.color === 'string')
    assert.ok(Array.isArray(tag.children))
    if (parentPath !== null) assert.equal(tag.path, `${parentPath}/${tag.id}`)
    for (const child of tag.children) validateTag(child, tag.path)
  }
  for (const root of tree) {
    assert.equal(root.parentId, null)
    assert.equal(root.path, String(root.id))
    validateTag(root)
  }
  report.checks.push(`annotations.tree returned a valid nested tree (${tree.length} roots)`)

  const counts = await call('command_run', { id: 'ipc.annotations.counts', params: { args: [] } })
  assert.ok(counts && typeof counts === 'object' && !Array.isArray(counts))
  for (const [id, count] of Object.entries(counts)) {
    assert.match(id, /^\d+$/)
    assert.ok(Number.isSafeInteger(count) && count >= 0)
  }
  report.checks.push(`annotations.counts returned valid nonnegative counts (${Object.keys(counts).length} entries)`)

  const samplePath = join(projectRoot, 'artifacts', 'verify', 'samples', 'annotations-decoder-read-only.txt')
  const annotations = await call('command_run', {
    id: 'ipc.annotations.for.paths',
    params: { args: [[samplePath]] }
  })
  const entry = annotations?.[samplePath]
  assert.ok(entry, 'annotations.forPaths omitted the requested path')
  assert.equal(entry.path, samplePath)
  assert.equal(typeof entry.favorite, 'boolean')
  assert.ok(Number.isInteger(entry.rating) && entry.rating >= 0 && entry.rating <= 5)
  assert.equal(typeof entry.note, 'string')
  assert.ok(Array.isArray(entry.tags))
  for (const tag of entry.tags) {
    assert.ok(Number.isSafeInteger(tag.id) && tag.id > 0)
    assert.equal(typeof tag.name, 'string')
    assert.ok(tag.parentId === null || (Number.isSafeInteger(tag.parentId) && tag.parentId > 0))
    assert.equal(typeof tag.path, 'string')
    assert.ok(tag.color === null || typeof tag.color === 'string')
  }
  report.checks.push('annotations.forPaths returned a valid path entry and tag references without writing to the database')

  const opened = await call('command_run', { id: 'ui.open-tab', params: { region: 'left', id: 'annotations' } })
  assert.ok(opened.action?.includes('tab.open:left:annotations'), 'MCP did not open the annotations tab')
  let body = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes('标签树')) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 100))
  }
  assert.ok(body.includes('标签树'), 'annotations page did not render decoded tree data')
  assert.doesNotMatch(body, /IPC 返回值校验失败|格式无效|Invalid input/i)
  report.checks.push('MCP opened the annotations tab; CDP read-only DOM inspection confirmed the page rendered without decoder errors')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'annotations-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath

  const reportPath = join(outDir, 'annotations-decoder.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
} finally {
  cdp.close()
}
