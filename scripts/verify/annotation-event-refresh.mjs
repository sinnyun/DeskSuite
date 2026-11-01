#!/usr/bin/env node
// Annotation refresh scoping: MCP metadata writes must re-fetch only the changed paths (F1),
// never the whole renderer cache, rows left out of the refresh keep their values (F2), and a
// burst of broadcasts inside the coalescing window must collapse into a single reload (F3).
// Counting uses main-process IPC runtime logs (payloads are path-redacted, so batch sizes
// are measured by counting [本机路径] markers).
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const report = { checkedAt: new Date().toISOString(), checks: [] }
const cdp = await connectCdp()
const samplesDir = join(projectRoot, 'artifacts', 'verify', 'samples')
// 专用空目录：批次计数只包含这三个样本，资源管理器重新列目录时也不会把无关条目的补拉串进测量窗口。
const fixtureDir = join(samplesDir, 'annotation-refresh')
const p1 = join(fixtureDir, 'annotation-refresh-1.txt')
const p2 = join(fixtureDir, 'annotation-refresh-2.txt')
const p3 = join(fixtureDir, 'annotation-refresh-3.txt')
const tagName = `annotation-refresh-${Date.now()}`
const initialPath = await cdp.evaluate("document.querySelector('[data-current-path]')?.getAttribute('data-current-path') ?? null")
let tagId
let tagAssigned = false

async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}

async function runCommand(id, params = {}) {
  const raw = await callTool('command_run', { id, params })
  try { return JSON.parse(raw) } catch { return raw }
}

const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms))

async function forPathsCalls() {
  const logs = JSON.parse(await callTool('get_runtime_logs', { limit: 2000 }))
  return logs
    .filter((entry) => entry.source === 'IPC' && entry.payload?.method === 'forPaths' && entry.payload.service === 'annotations' && entry.payload.phase !== 'end')
    .map((entry) => ({
      ms: Number(String(entry.id).split('-')[1]) || 0,
      count: JSON.stringify(entry.payload.args ?? []).split('[本机路径]').length - 1
    }))
    .filter((call) => call.count > 0)
    .sort((a, b) => a.ms - b.ms)
}

// 等待标注 IPC 静默：验证实例的窗口被遮挡时 Chromium 会把 50ms 合并定时器钳到 ~1s，
// 因此要求连续 4 轮（约 2 秒）没有新批次，才认为上一次广播的对账已经落地。
async function quietCalls() {
  let previous = -1
  let stable = 0
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await settle(500)
    const current = await forPathsCalls()
    if (current.length === previous) {
      stable += 1
      if (stable >= 4) return current
    } else {
      stable = 0
      previous = current.length
    }
  }
  return forPathsCalls()
}

// get_runtime_logs 是最新在前；以毫秒 id 为游标，取操作开始之后到达的批次。
async function windowSince(startedMs) {
  const batches = (await forPathsCalls()).filter((call) => call.ms > startedMs)
  return { calls: batches.length, totalPaths: batches.reduce((sum, call) => sum + call.count, 0), batches }
}

async function measureWindow(operation, expectedPaths) {
  const startedMs = Date.now()
  await operation()
  // 广播对账要排在目录批量补拉之后才落地（验证实例里可拖到 1~2 秒），固定等待会把
  // 「迟到的刷新」误测成「丢失的刷新」。等到期望路径数出现，再确认连续三轮不再增长。
  const deadline = Date.now() + 8000
  let seen = await windowSince(startedMs)
  while (seen.totalPaths < expectedPaths && Date.now() < deadline) {
    await settle(250)
    seen = await windowSince(startedMs)
  }
  for (let attempt = 0; attempt < 3; attempt += 1) {
    const previous = seen.totalPaths
    await settle(400)
    seen = await windowSince(startedMs)
    if (seen.totalPaths === previous) break
  }
  return seen
}

try {
  await callTool('clear_runtime_logs')

  // 用 MCP 写入路径导航，缓存 key 与广播里的路径同源（主进程 normalize 后的形式），
  // 这样按路径过滤的刷新才能命中；专用空目录保证批次计数只包含这三个样本。
  mkdirSync(fixtureDir, { recursive: true })
  for (const path of [p1, p2, p3]) writeFileSync(path, 'annotation refresh fixture\n')
  // 归零基线：本脚本自身的 F3 步骤会把 p1/p2 置为已收藏，重跑时不能把残留值当成断言起点。
  for (const path of [p1, p2, p3]) {
    await callTool('meta_favorite', { path, favorite: false })
    await callTool('meta_rate', { path, rating: 0 })
  }
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  const primed = await quietCalls()
  const cacheSize = Math.max(...primed.map((call) => call.count))
  assert.ok(primed.length >= 1 && cacheSize >= 3, `expected the Explorer load to prime at least the three sample rows, got ${JSON.stringify(primed)}`)
  report.primedBatches = primed
  report.cacheSize = cacheSize
  report.checks.push(`explorer navigation primed the annotation cache (${primed.length} batches, largest ${cacheSize} paths)`)

  // F1: a single favorite write must re-fetch only the changed path, not every cached row.
  // Reset first: a no-op write with the same value may skip the broadcast entirely.
  await callTool('meta_favorite', { path: p1, favorite: false })
  await quietCalls()
  const favoriteDelta = await measureWindow(() => callTool('meta_favorite', { path: p1, favorite: true }), 1)
  report.favoriteDelta = favoriteDelta
  assert.equal(favoriteDelta.totalPaths, 1, `favorite broadcast must refresh exactly the changed row, got ${JSON.stringify(favoriteDelta)}`)
  report.checks.push('F1: single meta_favorite broadcast re-fetches only the changed path (not the whole cache)')

  // F1 again for a second, distinct row.
  await quietCalls()
  const ratingDelta = await measureWindow(() => callTool('meta_rate', { path: p2, rating: 3 }), 1)
  report.ratingDelta = ratingDelta
  assert.equal(ratingDelta.totalPaths, 1, `rating broadcast must refresh exactly the rated row, got ${JSON.stringify(ratingDelta)}`)
  report.checks.push('F1: meta_rate broadcast stays scoped to the rated path')

  // Bulk tag assignment must fetch exactly the assigned rows.
  const tag = JSON.parse(await callTool('tag_create', { name: tagName }))
  tagId = tag.id
  await quietCalls()
  const assignDelta = await measureWindow(() => callTool('tag_assign', { paths: [p1, p2, p3], tagId }), 3)
  tagAssigned = true
  report.assignDelta = assignDelta
  assert.equal(assignDelta.totalPaths, 3, `tag assign should refresh exactly the three assigned paths, got ${JSON.stringify(assignDelta)}`)

  // F2 correctness: the scoped refreshes must not lose data for any touched row.
  const afterWrites = await runCommand('ipc.annotations.for.paths', { args: [[p1, p2, p3]] })
  const byLower = Object.fromEntries(Object.entries(afterWrites).map(([key, value]) => [key.toLowerCase(), value]))
  assert.equal(byLower[p1.toLowerCase()]?.favorite, true)
  assert.equal(byLower[p2.toLowerCase()]?.rating, 3)
  assert.deepEqual(byLower[p1.toLowerCase()]?.tags.map((item) => item.name), [tagName])
  assert.deepEqual(byLower[p3.toLowerCase()]?.tags.map((item) => item.name), [tagName])
  assert.equal(byLower[p2.toLowerCase()]?.favorite, false, 'rows outside a given write must keep their stored favorite value')
  report.checks.push('F1/F2: tag_assign refreshes exactly the assigned paths; all written values read back with untouched rows intact')

  await callTool('tag_assign', { paths: [p1, p2, p3], tagId, assigned: false })
  await settle()

  // Tree mutation fallback: a path-less broadcast must keep the previous whole-cache refresh.
  await quietCalls()
  const treeDelta = await measureWindow(() => callTool('tag_create', { name: `${tagName}-ignored` }), cacheSize)
  assert.ok(treeDelta.totalPaths >= cacheSize, `tree broadcast should still refresh the full cache (${JSON.stringify(treeDelta)} vs ${cacheSize})`)
  report.treeDelta = treeDelta
  report.checks.push('tree broadcasts keep the full-cache refresh fallback')

  // F3: two metadata broadcasts inside one coalescing window must collapse into a single reload.
  await callTool('meta_favorite', { path: p1, favorite: false })
  await callTool('meta_favorite', { path: p2, favorite: false })
  await quietCalls()
  const metadataBurst = await measureWindow(() => Promise.all([
    callTool('meta_favorite', { path: p1, favorite: true }),
    callTool('meta_favorite', { path: p2, favorite: true })
  ]), 2)
  report.metadataBurst = metadataBurst
  assert.equal(metadataBurst.calls, 1, `two metadata broadcasts in one window must collapse into a single reload, got ${JSON.stringify(metadataBurst)}`)
  assert.equal(metadataBurst.totalPaths, 2, `the coalesced reload must cover both changed paths, got ${JSON.stringify(metadataBurst)}`)
  report.checks.push('F3: two meta_favorite broadcasts inside the window reload once and cover both paths')

  // F3: a burst of tree broadcasts must collapse into one whole-cache refresh.
  await quietCalls()
  const treeBurst = await measureWindow(() => Promise.all([
    callTool('tag_create', { name: `${tagName}-burst-a` }),
    callTool('tag_create', { name: `${tagName}-burst-b` })
  ]), cacheSize)
  report.treeBurst = treeBurst
  assert.equal(treeBurst.calls, 1, `two tree broadcasts in one window must refresh once, got ${JSON.stringify(treeBurst)}`)
  assert.ok(treeBurst.totalPaths >= cacheSize, `the collapsed tree refresh must still cover the whole cache (${JSON.stringify(treeBurst)} vs ${cacheSize})`)
  report.checks.push(`F3: two tree broadcasts refresh the whole cache once (${treeBurst.totalPaths} paths in 1 batch)`)

  // The workbench must stay healthy after the scoped-refresh flow.
  await runCommand('ui.open-panel', { panel: 'debug-console' })
  await settle(400)
  const bodyText = await cdp.evaluate('document.body.innerText')
  assert.ok(bodyText.includes('程序调试信息'), 'debug console panel should still render after the refresh flow')
  const shot = await mcpCall('capture_window')
  const image = mcpImage(shot)
  assert.ok(image, mcpText(shot) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), 'annotation-event-refresh.png')
  writeFileSync(report.screenshot, Buffer.from(image.data, 'base64'))
  report.checks.push('window screenshot captured with debug console rendering after scoped refreshes')
} finally {
  for (const path of [p1, p2, p3]) {
    await callTool('meta_favorite', { path, favorite: false }).catch(() => undefined)
    await callTool('meta_rate', { path, rating: 0 }).catch(() => undefined)
  }
  if (tagAssigned) await callTool('tag_assign', { paths: [p1, p2, p3], tagId, assigned: false }).catch(() => undefined)
  if (tagId) {
    await runCommand('ipc.annotations.remove', { args: [tagId] }).catch(() => undefined)
    const tree = JSON.parse(await callTool('tag_list').catch(() => '[]'))
    const extras = []
    const visit = (nodes) => { for (const node of nodes) { if (node.name.startsWith(tagName) && node.id !== tagId) extras.push(node.id); visit(node.children ?? []) } }
    visit(tree)
    for (const id of extras) await runCommand('ipc.annotations.remove', { args: [id] }).catch(() => undefined)
  }
  if (initialPath) await callTool('quick_bookmarks_explorer', { action: 'navigate', path: initialPath }).catch(() => undefined)
  writeFileSync(join(ensureOutDir(), 'annotation-event-refresh.json'), `${JSON.stringify(report, null, 2)}\n`)
  cdp.close()
}

console.log(JSON.stringify(report, null, 2))
