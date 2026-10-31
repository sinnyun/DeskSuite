#!/usr/bin/env node
// Exercise the production basket decoder through a live MCP change event and inspect the panel read-only.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { basketItemsSchema } from '../../src/renderer/src/plugins/data-ops-explorer-insights/basket-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const marker = `basket-decoder-${Date.now()}`
const markerPath = join(projectRoot, 'artifacts', 'verify', 'samples', `${marker}.txt`)
const report = { checkedAt: new Date().toISOString(), checks: [], screenshot: null }

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

async function basket(args) {
  return parseJson(await mcpCall('basket_manage', args), 'basket_manage')
}

try {
  const initial = basketItemsSchema.safeParse(await basket({ action: 'list' }))
  assert.ok(initial.success, `initial basket response rejected: ${initial.success ? '' : initial.error.message}`)

  const input = { path: markerPath, name: marker, isDirectory: false, kind: 'document', size: 7, modifiedAt: 1 }
  const stored = await basket({ action: 'add', items: [input] })
  const decodedStored = basketItemsSchema.safeParse(stored)
  assert.ok(decodedStored.success, `basket mutation response rejected: ${decodedStored.success ? '' : decodedStored.error.message}`)
  assert.ok(decodedStored.data.some((item) => item.path === markerPath && item.name === marker))
  report.checks.push('live MCP basket mutation response parses through the production renderer decoder')

  const malformed = basketItemsSchema.safeParse([{ ...decodedStored.data.find((item) => item.path === markerPath), size: -1 }])
  assert.equal(malformed.success, false, 'production decoder accepted a negative size')
  assert.equal(basketItemsSchema.safeParse(Array.from({ length: 201 }, (_, index) => ({
    ...decodedStored.data.find((item) => item.path === markerPath), path: `${markerPath}-${index}`
  }))).success, false, 'production decoder accepted more than 200 items')
  report.checks.push('production decoder rejects malformed rows and over-budget snapshots')

  const opened = parseJson(await mcpCall('command_run', { id: 'ui.open-panel', params: { panel: 'basket' } }), 'command_run')
  assert.equal(opened.action, 'panel.open:basket')
  let body = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes(marker)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.match(body, new RegExp(marker))
  report.checks.push('MCP basket:changed broadcast triggered renderer hydrate; CDP read-only inspection confirms the row entered the panel')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'basket-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'basket-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await basket({ action: 'remove', path: markerPath }).catch(() => undefined)
  cdp.close()
}
