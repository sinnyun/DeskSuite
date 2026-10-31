#!/usr/bin/env node
// Clipboard renderer decoder smoke: all state changes use DeskSuite MCP; CDP is read-only.
import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const uniqueText = `clipboard-decoder-${Date.now()}`
const historyId = createHash('sha256').update(uniqueText).digest('hex')
const report = { checkedAt: new Date().toISOString(), checks: [] }
let originalText = null
let originalHistoryIds = new Set()

async function command(id, params = {}) {
  const result = await mcpCall('command_run', { id, params })
  assert.notEqual(result?.isError, true, `${id}: ${mcpText(result)}`)
  return result
}

async function clipboardIpc(method, args = []) {
  const normalizedMethod = method.replace(/([a-z0-9])([A-Z])/g, '$1.$2').toLowerCase()
  const result = await mcpCall('command_run', { id: `ipc.clipboard.${normalizedMethod}`, params: { args } })
  assert.notEqual(result?.isError, true, `clipboard.${method}: ${mcpText(result)}`)
  return result
}

async function waitForText(text) {
  const expression = `document.body.innerText.includes(${JSON.stringify(text)})`
  for (let attempt = 0; attempt < 60; attempt++) {
    if (await cdp.evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('剪贴板界面未在 6 秒内显示通过 MCP 写入的历史文本')
}

try {
  const clipboardBefore = await mcpCall('read_clipboard')
  assert.notEqual(clipboardBefore?.isError, true, 'read_clipboard failed before test')
  const readableText = mcpText(clipboardBefore) ?? ''
  const canRestoreText = !clipboardBefore.content?.some((item) => item.type === 'image') && readableText !== '（剪贴板为空或不是文本）'
  if (canRestoreText) {
    originalText = readableText
    originalHistoryIds = new Set(JSON.parse(mcpText(await clipboardIpc('history')) ?? '[]').map((item) => item.id))
    const write = await mcpCall('write_clipboard', { text: uniqueText })
    assert.notEqual(write?.isError, true, `write_clipboard: ${mcpText(write)}`)
    let found = false
    for (let attempt = 0; attempt < 30; attempt++) {
      const itemsResult = await clipboardIpc('history')
      const items = JSON.parse(mcpText(itemsResult) ?? 'null')
      if (Array.isArray(items) && items.some((item) => item.id === historyId && item.content === uniqueText)) {
        found = true
        break
      }
      await new Promise((resolve) => setTimeout(resolve, 250))
    }
    assert.ok(found, 'MCP clipboard write is captured and returned by bounded history list')
    report.checks.push('MCP clipboard write and history query validate the text response')
    await command('ui.open-panel', { panel: 'clipboard' })
    await waitForText(uniqueText)
    report.checks.push('clipboard history response passes renderer runtime decoding and appears in the panel')
  } else {
    report.checks.push('existing system clipboard is an image or has no safely restorable text; skipped mutation to preserve it')
    await command('ui.open-panel', { panel: 'clipboard' })
  }

  const shot = mcpImage(await mcpCall('capture_window'))
  assert.ok(shot?.data, 'capture_window did not return an image')
  writeFileSync(join(outDir, 'clipboard-decoder.png'), Buffer.from(shot.data, 'base64'))
} finally {
  await clipboardIpc('removeHistory', [historyId]).catch(() => {})
  if (originalText !== null) {
    await mcpCall('write_clipboard', { text: originalText }).catch(() => {})
    await new Promise((resolve) => setTimeout(resolve, 1800))
    const restoredId = createHash('sha256').update(originalText).digest('hex')
    if (!originalHistoryIds.has(restoredId)) await clipboardIpc('removeHistory', [restoredId]).catch(() => {})
  }
  await command('ui.close-panel', {}).catch(() => {})
  cdp.close()
}

report.screenshot = join(outDir, 'clipboard-decoder.png')
console.log(JSON.stringify(report, null, 2))
