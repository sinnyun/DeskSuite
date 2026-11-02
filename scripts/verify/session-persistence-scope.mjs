#!/usr/bin/env node
// Session persistence scope: file selection, metadata writes and watcher-driven
// re-renders must not persist session/workspaces at all; structural changes persist
// once through session.set only (the active pane is mirrored by the main process);
// the gallery stage and inspector share one readImage per path; a change sent to the
// main process shortly before quit is flushed by the will-quit hook, not lost.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { writeFile } from 'node:fs/promises'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, parseFlags, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const { flags } = parseFlags(process.argv.slice(2))
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), mode: flags['prepare-quit'] ? 'prepare-quit' : (flags['check-restart'] ? 'check-restart' : 'full'), checks: [] }
const samplesDir = join(projectRoot, 'artifacts', 'verify', 'samples')
const fixtureDir = join(samplesDir, 'session-persist')
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==', 'base64')
const img1 = join(fixtureDir, 'persist-a.png')
const img2 = join(fixtureDir, 'persist-b.png')
// img3 只用于画廊 readImage 测量：文件名带时间戳，确保每次运行都是新路径，
// 30 秒预览缓存（含上一次运行）必然未命中。
const img3 = join(fixtureDir, `persist-c-${Date.now()}.png`)

async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}

async function runCommand(id, params = {}) {
  const raw = await callTool('command_run', { id, params })
  try { return JSON.parse(raw) } catch { return raw }
}

const settle = (ms = 400) => new Promise((resolve) => setTimeout(resolve, ms))

function startsFor(logs, service, method) {
  return logs
    .filter((entry) => entry.source === 'IPC' && entry.phase === '请求' && entry.payload?.service === service && entry.payload?.method === method)
    .map((entry) => Number(String(entry.id).split('-')[1]) || 0)
    .sort((a, b) => a - b)
}

async function logs() {
  return JSON.parse(await callTool('get_runtime_logs', { limit: 2000 }))
}

// Count persisted calls that arrived after `cursorMs`, polling until the renderer
// debounce (250ms) plus IPC round trip had a chance to land, then requiring the
// count to stay stable for three rounds.
async function countSince(cursorMs, service, method, { expect } = {}) {
  const deadline = Date.now() + 8000
  let count = startsFor(await logs(), service, method).filter((ms) => ms > cursorMs).length
  if (expect === undefined) {
    for (let attempt = 0; attempt < 3; attempt += 1) {
      const previous = count
      await settle(400)
      count = startsFor(await logs(), service, method).filter((ms) => ms > cursorMs).length
      if (count === previous && count === 0) break
    }
    return count
  }
  while (count < expect && Date.now() < deadline) {
    await settle(250)
    count = startsFor(await logs(), service, method).filter((ms) => ms > cursorMs).length
  }
  return count
}

async function measure(operation) {
  const cursorMs = Date.now()
  await operation()
  return cursorMs
}

async function selectImage(path) {
  await callTool('quick_bookmarks_explorer', { action: 'select', paths: [path] })
}

if (flags['check-restart']) {
  const session = await runCommand('ipc.session.get')
  assert.equal(session.path, fixtureDir, `session.path should be the fixture directory, got ${session.path}`)
  assert.equal(session.viewMode, 'gallery', `session.viewMode should be gallery, got ${session.viewMode}`)
  assert.ok(!('selectedPaths' in session) && !('scrollAnchor' in session), 'session must not carry runtime-only fields')
  report.checks.push('will-quit flush persisted the navigation and view change made <500ms before close')
  report.session = { path: session.path, viewMode: session.viewMode }
  await writeFile(join(outDir, 'session-persistence-scope.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
  cdp.close()
  process.exit(0)
}

try {
  mkdirSync(fixtureDir, { recursive: true })
  writeFileSync(img1, PNG_1X1)
  writeFileSync(img2, PNG_1X1)
  writeFileSync(img3, PNG_1X1)
  // 重跑基线：导航到已在目录、重复的收藏写入都可能成为 no-op，先离开目标目录并把收藏归零，
  // 让测量窗口内的每次操作都是真实状态变化。
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: samplesDir })
  await settle(900)
  await callTool('meta_favorite', { path: img1, favorite: false })
  await settle(600)
  await callTool('clear_runtime_logs')

  // Navigation: exactly one persistence call for the active pane (session.set), never workspaces.setPane.
  let cursor = await measure(async () => {
    await callTool('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  })
  const navSession = await countSince(cursor, 'session', 'set', { expect: 1 })
  await settle(600)
  const navSetPane = startsFor(await logs(), 'workspaces', 'setPane').filter((ms) => ms > cursor).length
  assert.equal(navSession, 1, `navigation should persist once via session.set, got ${navSession}`)
  assert.equal(navSetPane, 0, `navigation must not call workspaces.setPane for the active pane, got ${navSetPane}`)
  report.checks.push(`navigation persisted exactly once (session.set=1, workspaces.setPane=0)`)
  const sessionSnapshot = await runCommand('ipc.session.get')
  assert.ok(
    !('selectedPaths' in sessionSnapshot) && !('focusedPath' in sessionSnapshot) && !('scrollAnchor' in sessionSnapshot),
    `session document must not carry runtime-only fields, got keys ${Object.keys(sessionSnapshot).join(',')}`
  )
  report.checks.push('session document contains no runtime-only fields (selectedPaths/focusedPath/scrollAnchor)')

  // Selection: no persistence at all.
  cursor = await measure(() => selectImage(img1))
  assert.equal(await countSince(cursor, 'session', 'set'), 0, 'selecting a file must not persist the session')
  assert.equal(await countSince(cursor, 'workspaces', 'setPane'), 0, 'selecting a file must not persist pane state')
  await settle(300)
  cursor = await measure(() => selectImage(img2))
  assert.equal(await countSince(cursor, 'session', 'set'), 0, 'switching selection must not persist the session')
  assert.equal(await countSince(cursor, 'workspaces', 'setPane'), 0, 'switching selection must not persist pane state')
  report.checks.push('file selection and selection switches produced zero persistence IPC')

  // Metadata write (favorite): annotations IPC happens, but no session persistence.
  cursor = await measure(async () => {
    await callTool('meta_favorite', { path: img1, favorite: true })
  })
  await settle(800)
  assert.equal(await countSince(cursor, 'session', 'set'), 0, 'favorite toggle must not persist the session')
  assert.equal(await countSince(cursor, 'workspaces', 'setPane'), 0, 'favorite toggle must not persist pane state')
  report.checks.push('metadata (favorite) change produced zero persistence IPC')

  // Structural change (view mode): persists once via session.set. Reset to list first so
  // the measured switch is a real change even when a previous run ended in gallery view.
  await callTool('quick_bookmarks_explorer', { action: 'view', viewMode: 'list' })
  await settle(600)
  cursor = await measure(async () => {
    await callTool('quick_bookmarks_explorer', { action: 'view', viewMode: 'gallery' })
  })
  const viewSession = await countSince(cursor, 'session', 'set', { expect: 1 })
  await settle(400)
  const viewSetPane = startsFor(await logs(), 'workspaces', 'setPane').filter((ms) => ms > cursor).length
  assert.equal(viewSession, 1, `view change should persist once via session.set, got ${viewSession}`)
  assert.equal(viewSetPane, 0, 'view change must not call workspaces.setPane, got 0')
  report.checks.push('view-mode change persisted exactly once')

  // Gallery stage + inspector read the same image: exactly one readImage. img3 has never
  // been selected before, so its preview cache is guaranteed cold.
  await selectImage(img2)
  await settle(300)
  cursor = await measure(() => selectImage(img3))
  const reads = await countSince(cursor, 'filesystem', 'readImage', { expect: 1 })
  assert.equal(reads, 1, `gallery selection should read the image once (stage+inspector share the cache), got ${reads}`)
  report.checks.push('gallery selection triggered exactly one filesystem.readImage for stage+inspector')

  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, 'capture_window did not return an image')
  const screenshotPath = join(outDir, 'session-persistence-scope.png')
  await writeFile(screenshotPath, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshotPath
  await writeFile(join(outDir, 'session-persistence-scope.json'), JSON.stringify(report, null, 2))
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}

if (flags['prepare-quit']) {
  // Send a real navigation to the main process, then close the window before the
  // main-process 500ms write debounce fires: only the will-quit flush can save it.
  // 先离开目标目录，保证最后一次导航是真实变化而不是 no-op。
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: samplesDir })
  await settle(500)
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  await settle(350)
  await callTool('control_window', { action: 'close' })
}
