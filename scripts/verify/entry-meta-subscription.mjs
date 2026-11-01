#!/usr/bin/env node
// Row metadata subscription stability: repeated list/grid re-renders and full remounts must keep
// every row's useSyncExternalStore subscription attached (a later broadcast still updates exactly
// that row) and must not refetch metadata that is already cached.
import assert from 'node:assert/strict'
import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const report = { checkedAt: new Date().toISOString(), checks: [] }
const cdp = await connectCdp()
const samplesDir = join(projectRoot, 'artifacts', 'verify', 'samples')
const fixtureDir = join(samplesDir, 'entry-meta')
const names = ['row-a.txt', 'row-b.txt', 'row-c.txt']
let paths = names.map((name) => join(fixtureDir, name))
const initialView = JSON.parse(await callTool('quick_bookmarks_explorer', { action: 'view' }))
const initialPath = await cdp.evaluate("document.querySelector('[data-current-path]')?.getAttribute('data-current-path') ?? null")

mkdirSync(fixtureDir, { recursive: true })
for (const name of names) writeFileSync(join(fixtureDir, name), 'entry-meta subscription fixture\n')

async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}

const settle = (ms = 900) => new Promise((resolve) => setTimeout(resolve, ms))

// 广播刷新走单条串行 drain 队列，选择项抖动后一次写入的对账可能延后 1~2 秒才落地。
// 断言前轮询等待收敛，避免把延迟误判成丢失更新。
async function pollUntil(label, read, predicate, timeoutMs = 8000) {
  const started = Date.now()
  for (;;) {
    const items = await read()
    if (predicate(items)) return items
    if (Date.now() - started > timeoutMs) {
      assert.fail(`${label} did not converge within ${timeoutMs}ms; last read ${JSON.stringify(items)}`)
    }
    await settle(250)
  }
}

// Selection churn must not open another metadata round trip: read annotations.forPaths calls out of
// the main-process IPC log (paths are redacted, so batches are counted by [本机路径] markers).
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

// 等待标注 IPC 静默：窗口被遮挡时 Chromium 把 50ms 合并定时器钳到 ~1s，上一次写入的对账
// 可能晚 1~2 秒才落地；要求连续 4 轮（约 2 秒）无新批次，才不会串进后面的抖动测量窗口。
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

async function windowSince(startedMs) {
  const batches = (await forPathsCalls()).filter((call) => call.ms > startedMs)
  return { calls: batches.length, totalPaths: batches.reduce((sum, call) => sum + call.count, 0), batches }
}

const gridCards = () => cdp.evaluate(`Array.from(document.querySelectorAll('[data-file-card]'), (card) => {
  const line = card.querySelector('span[data-ds-type="body"]')?.parentElement
  const buttons = Array.from(card.parentElement.querySelectorAll(':scope > button'))
  const ratingChild = line && line.children.length > 1 ? line.children[line.children.length - 1].textContent.trim() : ''
  return {
    path: card.getAttribute('title') ?? '',
    name: line?.children[0]?.textContent ?? '',
    rating: Number(ratingChild) || 0,
    favorite: buttons.at(-1)?.getAttribute('title') ?? ''
  }
})`)

const listRows = () => cdp.evaluate(`Array.from(document.querySelectorAll('[role="row"]'), (row) => ({
  name: row.querySelector('span[data-ds-type="body"]')?.textContent ?? '',
  favorite: row.querySelector('button')?.getAttribute('title') ?? ''
}))`)

function pick(items, name, what) {
  const found = items.find((item) => item.name === name)
  assert.ok(found, `${what} for ${name} was not rendered, got ${JSON.stringify(items.map((item) => item.name))}`)
  return found
}

async function churn(times, targets) {
  const startedMs = Date.now()
  for (let index = 0; index < times; index += 1) {
    await callTool('quick_bookmarks_explorer', { action: 'select', paths: [targets[index % targets.length]] })
  }
  return windowSince(startedMs)
}

try {
  await callTool('clear_runtime_logs')
  await callTool('quick_bookmarks_explorer', { action: 'view', viewMode: 'grid' })
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  await settle()

  // Card titles carry the Explorer's own entry paths, which is what the select action compares against.
  let cards = await gridCards()
  assert.deepEqual(cards.map((card) => card.name).sort(), names, `expected only the three fixture rows, got ${JSON.stringify(cards.map((card) => card.name))}`)
  const byName = Object.fromEntries(cards.map((card) => [card.name, card]))
  paths = names.map((name) => byName[name].path)
  report.entryPaths = paths

  for (const path of paths) {
    await callTool('meta_favorite', { path, favorite: false })
    await callTool('meta_rate', { path, rating: 0 })
  }
  await quietCalls()
  cards = await gridCards()
  assert.deepEqual(cards.map((card) => card.favorite), names.map(() => '添加收藏'), `clean start expected, got ${JSON.stringify(cards)}`)
  report.checks.push('three grid tiles start uncollected and unrated')

  // Churn: 30 selection changes re-render every mounted tile. Cached metadata must not be refetched.
  const gridChurn = await churn(30, paths)
  report.gridChurn = gridChurn
  assert.equal(gridChurn.calls, 0, `selection re-renders must not refetch cached metadata, got ${JSON.stringify(gridChurn)}`)
  report.checks.push(`30 grid selection re-renders triggered no metadata refetch (${gridChurn.calls} forPaths calls)`)

  // The tiles must still react to a broadcast after that churn.
  await callTool('meta_favorite', { path: paths[1], favorite: true })
  const afterFavorite = await pollUntil('favorite broadcast', gridCards, (items) => pick(items, names[1], 'tile').favorite === '取消收藏')
  assert.equal(pick(afterFavorite, names[0], 'tile').favorite, '添加收藏', 'only the written tile may change')
  assert.equal(pick(afterFavorite, names[2], 'tile').favorite, '添加收藏', 'only the written tile may change')
  report.checks.push('F4: favorite broadcast still updates exactly one tile after 30 re-renders')

  await callTool('meta_rate', { path: paths[2], rating: 4 })
  const afterRating = await pollUntil('rating broadcast', gridCards, (items) => pick(items, names[2], 'tile').rating === 4)
  assert.equal(pick(afterRating, names[1], 'tile').rating, 0, 'tiles outside the write keep their stored rating')
  report.checks.push('F4: rating broadcast reaches the tile after churn without leaking to other rows')

  // Same guarantee for the list rows, which are a different component on the same hook.
  await callTool('quick_bookmarks_explorer', { action: 'view', viewMode: 'list' })
  await settle()
  const listChurn = await churn(20, paths)
  report.listChurn = listChurn
  assert.equal(listChurn.calls, 0, `list selection re-renders must not refetch cached metadata, got ${JSON.stringify(listChurn)}`)
  await callTool('meta_favorite', { path: paths[0], favorite: true })
  const listRowsAfter = await pollUntil('list favorite broadcast', listRows, (items) => pick(items, names[0], 'row').favorite === '取消收藏')
  assert.equal(pick(listRowsAfter, names[1], 'row').favorite, '取消收藏', 'the earlier write must survive the view switch')
  assert.equal(pick(listRowsAfter, names[2], 'row').favorite, '添加收藏')
  report.checks.push('F4: 20 list selection re-renders (0 refetches) then a favorite write reaches exactly one row')

  // Remount: navigate away and back, then confirm the rebuilt subscriptions are live again.
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: samplesDir })
  await settle()
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  await settle()
  await quietCalls()
  const restored = await listRows()
  assert.equal(pick(restored, names[0], 'row').favorite, '取消收藏', 'remounted rows must restore cached values')
  assert.equal(pick(restored, names[2], 'row').favorite, '添加收藏')
  await callTool('meta_favorite', { path: paths[2], favorite: true })
  const afterRemount = await pollUntil('remounted row broadcast', listRows, (items) => pick(items, names[2], 'row').favorite === '取消收藏')
  assert.equal(pick(afterRemount, names[0], 'row').favorite, '取消收藏', 'the other remounted rows keep their restored state')
  report.checks.push('F4: rows remounted after navigation restore values and subscribe again')

  await runHealthCheck()
} finally {
  for (const path of paths) {
    await callTool('meta_favorite', { path, favorite: false }).catch(() => undefined)
    await callTool('meta_rate', { path, rating: 0 }).catch(() => undefined)
  }
  if (initialView) await callTool('quick_bookmarks_explorer', {
    action: 'view',
    viewMode: initialView.viewMode,
    groupingEnabled: initialView.groupingEnabled,
    groupBy: initialView.groupOptions.groupBy,
    includeChildren: initialView.groupOptions.includeChildren
  }).catch(() => undefined)
  if (initialPath) await callTool('quick_bookmarks_explorer', { action: 'navigate', path: initialPath }).catch(() => undefined)
  writeFileSync(join(ensureOutDir(), 'entry-meta-subscription.json'), `${JSON.stringify(report, null, 2)}\n`)
  cdp.close()
}

async function runHealthCheck() {
  await callTool('command_run', { id: 'ui.open-panel', params: { panel: 'debug-console' } })
  await settle(400)
  const bodyText = await cdp.evaluate('document.body.innerText')
  assert.ok(bodyText.includes('程序调试信息'), 'debug console panel should still render after the churn flow')
  const shot = await mcpCall('capture_window')
  const image = mcpImage(shot)
  assert.ok(image, mcpText(shot) ?? 'capture_window did not return an image')
  report.screenshot = join(ensureOutDir(), 'entry-meta-subscription.png')
  writeFileSync(report.screenshot, Buffer.from(image.data, 'base64'))
  report.checks.push('window screenshot captured with the debug console after the churn flow')
}

console.log(JSON.stringify(report, null, 2))
