#!/usr/bin/env node
// Validate the production search decoder against a live MCP result and inspect the panel read-only.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { searchResultSchema } from '../../src/renderer/src/plugins/data-ops-search-ui/search-schema.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], resultCount: 0, screenshot: null }

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

try {
  const result = parseJson(await mcpCall('search_files', { query: '', limit: 5, offset: 0 }), 'search_files')
  const decoded = searchResultSchema.safeParse(result)
  assert.ok(decoded.success, `live search result rejected by production decoder: ${decoded.success ? '' : decoded.error.message}`)
  assert.equal(decoded.data.limit, 5)
  assert.equal(decoded.data.offset, 0)
  report.resultCount = decoded.data.items.length
  report.checks.push('MCP search_files response parses with the production renderer Zod schema')

  const invalid = searchResultSchema.safeParse({ ...result, items: [{ path: 'x', name: 'x', kind: 'file', size: -1, mtime_ms: 0, favorite: 0, rating: null }] })
  assert.equal(invalid.success, false, 'production decoder accepted a negative file size')
  report.checks.push('production decoder rejects a malformed search row')

  const opened = parseJson(await mcpCall('command_run', { id: 'ui.toggle-floating-panel', params: { panel: 'global-search' } }), 'command_run')
  assert.equal(opened.action, 'floating.toggle:global-search')
  let body = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes('全局搜索')) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.match(body, /全局搜索/)
  assert.match(body, /输入关键词搜索已扫描的文件/)
  assert.doesNotMatch(body, /搜索服务返回了无效结果|搜索服务返回分页信息与当前请求不一致/)
  report.checks.push('MCP opened the search panel; CDP read-only inspection confirms its empty-query state')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'search-ui-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'search-ui-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
