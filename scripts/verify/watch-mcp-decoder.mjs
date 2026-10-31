#!/usr/bin/env node
// MCP-only Explorer navigation and screenshot; CDP is used only to read rendered body text.
// The external file write is a fixture stimulus for the filesystem watcher, confined to samples/.
import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { basename, join, normalize, resolve } from 'node:path'
import { randomUUID } from 'node:crypto'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const sampleDir = resolve(projectRoot, 'artifacts', 'verify', 'samples', `watch-mcp-decoder-${Date.now()}-${randomUUID().slice(0, 8)}`)
const initialPath = join(sampleDir, 'initial.txt')
const changedPath = join(sampleDir, `watch-event-${randomUUID().slice(0, 8)}.txt`)
const report = { checkedAt: new Date().toISOString(), sampleDir, checks: [], screenshot: null }

function normalizedPath(path) { return normalize(path).replace(/[\\/]+$/, '').replaceAll('\\', '/').toLowerCase() }

function parseJson(result, label) {
  assert.ok(result, `${label}: empty MCP response`)
  assert.notEqual(result.isError, true, `${label}: ${mcpText(result) ?? 'MCP error'}`)
  const text = mcpText(result)
  assert.ok(text, `${label}: missing MCP text result`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: expected JSON result, got ${text.slice(0, 300)}`) }
}

async function call(name, args = {}) { return parseJson(await mcpCall(name, args), name) }
async function getWatchedDirectories() {
  return call('command_run', { id: 'ipc.watch.get.directories', params: { args: [] } })
}

await mkdir(sampleDir, { recursive: true })
await writeFile(initialPath, 'Watcher fixture is ready.\n', 'utf8')

try {
  const commands = await call('command_list', { filter: 'ipc.watch.' })
  assert.ok(Array.isArray(commands) && commands.some((command) => command.id === 'ipc.watch.get.directories'))
  report.checks.push('MCP command registry exposes watcher directory readback')

  await call('quick_bookmarks_explorer', { action: 'navigate', path: sampleDir })
  const watchedDeadline = Date.now() + 12_000
  let watched = []
  while (Date.now() < watchedDeadline) {
    watched = await getWatchedDirectories()
    if (watched.some((dir) => normalizedPath(dir) === normalizedPath(sampleDir))) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 200))
  }
  assert.ok(watched.some((dir) => normalizedPath(dir) === normalizedPath(sampleDir)), 'Explorer did not register the MCP-navigated directory with watch')
  report.watchedDirectories = watched
  report.checks.push('MCP quick_bookmarks_explorer navigation registered the directory with the watcher')

  const stimulusStartedAt = Date.now()
  await writeFile(changedPath, 'This file was created after the Explorer subscribed.\n', 'utf8')
  const cdpDeadline = Date.now() + 15_000
  let body = ''
  while (Date.now() < cdpDeadline) {
    body = await cdp.evaluate('document.body.innerText')
    if (body.includes(basename(changedPath))) break
    await new Promise((resolveWait) => setTimeout(resolveWait, 150))
  }
  assert.ok(body.includes(basename(changedPath)), 'Explorer did not show the file after fs:changed')
  report.checks.push('CDP read-only DOM inspection observed the new file after watcher notification')

  let eventLog
  const logDeadline = Date.now() + 8_000
  while (Date.now() < logDeadline && !eventLog) {
    const logs = await call('get_runtime_logs', { limit: 100 })
    // Runtime logs intentionally redact absolute local paths, so verify the
    // broadcast's channel and payload shape instead of comparing its path text.
    eventLog = logs.find((entry) => {
      const eventTime = Number(entry.id?.match(/^main-(\d+)-/)?.[1])
      return entry.source === 'Event' && entry.payload?.channel === 'fs:changed'
        && eventTime >= stimulusStartedAt
        && Array.isArray(entry.payload?.data?.paths) && entry.payload.data.paths.length > 0
    })
    if (!eventLog) await new Promise((resolveWait) => setTimeout(resolveWait, 250))
  }
  assert.ok(eventLog, 'MCP runtime log did not capture the fs:changed broadcast for the sample path')
  const event = eventLog.payload.data
  assert.ok(Array.isArray(event.paths) && event.paths.length > 0 && event.paths.every((path) => typeof path === 'string'))
  assert.ok(Array.isArray(event.dirs) && event.dirs.length > 0 && event.dirs.every((dir) => typeof dir === 'string'))
  assert.equal(typeof event.invalidate, 'boolean')
  assert.ok(event.paths.length <= 200)
  report.fsChanged = event
  report.checks.push('MCP get_runtime_logs exposed the fs:changed payload shape (absolute paths are correctly redacted in logs)')

  const screenshot = mcpImage(await mcpCall('capture_window'))
  assert.ok(screenshot?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'watch-mcp-decoder.png')
  await writeFile(screenshotPath, Buffer.from(screenshot.data, 'base64'))
  report.screenshot = screenshotPath

  const reportPath = join(outDir, 'watch-mcp-decoder.json')
  await writeFile(reportPath, JSON.stringify(report, null, 2))
  console.log(JSON.stringify({ ...report, reportPath }, null, 2))
} finally {
  cdp.close()
}
