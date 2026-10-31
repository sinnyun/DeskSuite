#!/usr/bin/env node
// Read runtime/access snapshots over MCP and confirm the administration pages render them.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { mcpAccessSchema, runtimeInfoSchema } from '../../src/renderer/src/plugins/system-basic-settings/admin-schemas.ts'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], runtimeServices: 0, mcpTools: 0, access: null, screenshots: [] }

function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

async function callCommand(id) {
  return parseJson(await mcpCall('command_run', { id, params: { args: [] } }), id)
}

async function openPage(page) {
  const result = await mcpCall('open_settings_page', { page })
  assert.notEqual(result?.isError, true, `open_settings_page: ${mcpText(result) ?? 'MCP error'}`)
}

async function waitBody(predicate, description) {
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const body = await cdp.evaluate('document.body.innerText')
    if (predicate(body)) return body
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`settings page did not show ${description}`)
}

async function capture(filename) {
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const path = join(outDir, filename)
  await writeFile(path, Buffer.from(image.data, 'base64'))
  report.screenshots.push(path)
}

try {
  const runtime = runtimeInfoSchema.parse(await callCommand('ipc.runtime.info'))
  const access = mcpAccessSchema.parse(await callCommand('ipc.mcp.get.access'))
  assert.ok(runtime.services.length > 0)
  assert.ok(runtime.mcpTools.length > 0)
  report.runtimeServices = runtime.services.length
  report.mcpTools = runtime.mcpTools.length
  report.access = access
  report.checks.push('read-only MCP command snapshots parse with the production renderer runtime/access schemas')

  assert.equal(runtimeInfoSchema.safeParse({ ...runtime, mcpTools: [{ name: 'invalid', mutating: false, impact: 'critical' }] }).success, false)
  assert.equal(mcpAccessSchema.safeParse('superuser').success, false)
  report.checks.push('production renderer schemas reject invalid MCP tool impact and access level')

  await openPage('runtime')
  const runtimeBody = await waitBody((body) => body.includes('主进程服务') && body.includes(runtime.appName), 'runtime info')
  assert.match(runtimeBody, /Electron/)
  assert.match(runtimeBody, /Chromium/)
  report.checks.push('MCP opened the runtime page; CDP read-only inspection confirms decoded runtime information rendered')
  await capture('admin-runtime-decoder.png')

  await openPage('mcp')
  const mcpBody = await waitBody((body) => body.includes('当前级别') && body.includes('可用工具'), 'MCP access/tools')
  assert.ok(mcpBody.includes(access === 'full' ? '完全控制' : access))
  report.checks.push('MCP opened the MCP page; CDP read-only inspection confirms decoded access level and tool catalog rendered')
  await capture('admin-mcp-access-decoder.png')

  await writeFile(join(outDir, 'admin-runtime-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  await mcpCall('command_run', { id: 'ui.close-panel', params: {} }).catch(() => undefined)
  cdp.close()
}
