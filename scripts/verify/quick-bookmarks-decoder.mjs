#!/usr/bin/env node
// Create one temporary group through MCP, then confirm the production renderer decoder refreshed the UI.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { bookmarkGroupsSchema } from '../../src/renderer/src/plugins/data-ops-explorer/bookmark-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const groupName = `decoder-${Date.now()}`
const report = { checkedAt: new Date().toISOString(), checks: [], screenshot: null }
let groupId

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

async function manage(args) {
  return parseJson(await mcpCall('quick_bookmarks', args), 'quick_bookmarks')
}

try {
  const initial = bookmarkGroupsSchema.safeParse(await manage({ action: 'list' }))
  assert.ok(initial.success, `initial group response rejected: ${initial.success ? '' : initial.error.message}`)

  const created = await manage({ action: 'createGroup', name: groupName })
  const rawGroup = Array.isArray(created) ? created.find((item) => item?.name === groupName) : null
  if (typeof rawGroup?.id === 'string') groupId = rawGroup.id
  const decoded = bookmarkGroupsSchema.safeParse(created)
  assert.ok(decoded.success, `MCP create response rejected: ${decoded.success ? '' : decoded.error.message}`)
  const group = decoded.data.find((item) => item.name === groupName)
  assert.ok(group, 'MCP create response omitted the new group')
  groupId = group.id
  report.checks.push('live MCP quick_bookmarks result parses with the production renderer Zod schema')

  const malformed = bookmarkGroupsSchema.safeParse([{ id: group.id, name: group.name, items: [{ id: '', name: 'bad', path: 'x' }] }])
  assert.equal(malformed.success, false, 'production decoder accepted a bookmark without an ID')
  report.checks.push('production renderer decoder rejects malformed group items')

  let rendered = false
  for (let attempt = 0; attempt < 60; attempt += 1) {
    rendered = await cdp.evaluate(`Boolean(document.querySelector('[data-bookmark-group="${group.id}"]'))`)
    if (rendered) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.equal(rendered, true, 'quickBookmarks:changed did not trigger a renderer refresh')
  const body = await cdp.evaluate(`document.querySelector('[data-bookmark-group="${group.id}"]')?.innerText ?? ''`)
  assert.match(body, new RegExp(groupName))
  report.checks.push('MCP change event triggered bookmarkAction refresh; CDP read-only inspection confirms group entered renderer state')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'quick-bookmarks-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
} finally {
  if (groupId) await manage({ action: 'deleteGroup', groupId }).catch(() => undefined)
  cdp.close()
}

await writeFile(join(outDir, 'quick-bookmarks-decoder.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
