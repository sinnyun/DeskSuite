#!/usr/bin/env node
// Read-only command descriptor check plus an MCP-originated action event. CDP only reads DOM text.
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [], commandCount: 0, screenshot: null }
function parseJson(result, label) {
  assert.notEqual(result?.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

try {
  const commands = parseJson(await mcpCall('command_list'), 'command_list')
  assert.ok(Array.isArray(commands) && commands.length <= 5000, 'command_list must return a bounded command descriptor list')
  for (const command of commands) {
    assert.equal(typeof command.id, 'string')
    assert.equal(typeof command.title, 'string')
    assert.equal(typeof command.group, 'string')
    assert.equal(typeof command.description, 'string')
    assert.equal(typeof command.hasParameters, 'boolean')
    assert.equal(typeof command.enabled, 'boolean')
    assert.ok(command.keybinding === undefined || typeof command.keybinding === 'string')
    assert.ok(command.inputSchema === undefined || command.inputSchema && typeof command.inputSchema === 'object' && !Array.isArray(command.inputSchema))
  }
  assert.ok(commands.some((command) => command.id === 'ui.open-panel'), 'command descriptor list omitted ui.open-panel')
  report.commandCount = commands.length
  report.checks.push('MCP command_list returned descriptors with the fields consumed by the palette')

  const opened = parseJson(await mcpCall('command_run', { id: 'system.open-debug-console', params: {} }), 'command_run')
  assert.equal(opened.action, 'debug-console.open')
  report.checks.push('MCP non-mutating command emitted a production commands:action payload')

  let body = ''
  for (let attempt = 0; attempt < 50; attempt += 1) {
    body = await cdp.evaluate('document.body.innerText')
    if (/调试信息|运行日志/.test(body)) break
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  assert.match(body, /调试信息|运行日志/, 'MCP action did not open the debug console')
  assert.doesNotMatch(body, /收到无效的界面命令|收到无效的命令审批请求|IPC 返回值校验失败|Invalid input/i)
  report.checks.push('CDP read-only text confirms the renderer accepted the action event without decoder errors')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'command-palette-decoder.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'command-palette-decoder.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
