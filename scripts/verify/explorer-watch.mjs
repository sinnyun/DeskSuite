#!/usr/bin/env node
// 用法：node scripts/verify/explorer-watch.mjs（需先由 launch.mjs 启动应用）
// 验证 Explorer 对目录视图与标签聚合视图的自动增量更新：
// 修改/新增/删除都能在数秒内反映，且不触发整表重载（刷新按钮不进入 loading）。
import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, outDir } from './common.mjs'

ensureOutDir()
const captureShot = async (name) => {
  if (!process.argv.includes('--shot')) return null
  await mcpHandshake()
  const result = await mcpCall('capture_window', {})
  const image = mcpImage(result)
  if (!image) return null
  const file = join(outDir, name)
  await writeFile(file, Buffer.from(image.data, 'base64'))
  return file
}
const fixtureDir = join(outDir, 'samples', 'explorer-watch')
await rm(fixtureDir, { recursive: true, force: true })
await mkdir(fixtureDir, { recursive: true })
const paths = {
  alpha: join(fixtureDir, 'alpha.txt'),
  beta: join(fixtureDir, 'beta.txt'),
  gamma: join(fixtureDir, 'gamma.txt'),
  added: join(fixtureDir, 'added.txt'),
  untagged: join(fixtureDir, 'untagged.txt')
}
for (const name of ['alpha.txt', 'beta.txt', 'gamma.txt']) {
  await writeFile(join(fixtureDir, name), name)
}
await mkdir(join(fixtureDir, 'nested'), { recursive: true })
await writeFile(join(fixtureDir, 'nested', 'inner.txt'), 'inner')

const client = await connectCdp()
const normalize = (value) => value.replace(/[\\/]+$/, '').replace(/\\/g, '/').toLowerCase()
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

async function snapshot() {
  return client.evaluate(`(() => ({
    rows: [...document.querySelectorAll('[role=row]')].map((node) => node.innerText.split(String.fromCharCode(10)).join('|')),
    body: document.body?.innerText ?? ''
  }))()`)
}

async function waitFor(predicate, label, timeout = 5000) {
  const start = Date.now()
  let last = { rows: [], body: '' }
  while (Date.now() - start < timeout) {
    last = await snapshot()
    if (predicate(last)) return { elapsed: Date.now() - start, rows: last.rows }
    await sleep(100)
  }
  throw new Error(`${label} 超时，当前行：${JSON.stringify(last.rows)}`)
}

async function installProbe() {
  return client.evaluate(`(() => {
    window.__watchSpin = 0
    window.__watchObserver?.disconnect()
    const button = [...document.querySelectorAll('button')].find((node) => node.getAttribute('title') === '刷新当前目录')
    const icon = button?.querySelector('svg')
    if (!icon) return false
    const check = () => { if (icon.classList.contains('animate-spin')) window.__watchSpin += 1 }
    check()
    window.__watchObserver = new MutationObserver(check)
    window.__watchObserver.observe(icon, { attributes: true, attributeFilter: ['class'] })
    window.__watchRows = new Map([...document.querySelectorAll('[role=row]')]
      .map((node) => [node.innerText.split(String.fromCharCode(10))[0], node]))
    return true
  })()`)
}

async function probeEvidence() {
  return client.evaluate(`(() => {
    const before = window.__watchRows ?? new Map()
    const stable = before.get('alpha.txt')
    return {
      spin: window.__watchSpin ?? -1,
      alphaConnected: Boolean(stable?.isConnected),
      alphaText: stable?.innerText.split(String.fromCharCode(10)).slice(0, 3).join('|') ?? null
    }
  })()`)
}

async function clearProbe() {
  await client
    .evaluate(`window.__watchObserver?.disconnect(); delete window.__watchObserver; delete window.__watchRows; delete window.__watchSpin`)
    .catch(() => {})
}

let originalPane = null
let tag = null
const cases = {}

try {
  const catalog = await client.evaluate(`window.bridge.invoke('workspaces', 'list')`)
  const workspace = catalog.items.find((item) => item.id === catalog.activeId)
  assert.ok(workspace, '活动工作区不存在')
  const pane = workspace.panes.find((item) => item.id === catalog.activePaneId) ?? workspace.panes[0]
  originalPane = { workspaceId: workspace.id, paneId: pane.id, state: pane.state }

  const setPane = (state) =>
    client.evaluate(
      `window.bridge.invoke('workspaces', 'setPane', ${JSON.stringify(workspace.id)}, ${JSON.stringify(pane.id)}, ${JSON.stringify(state)})`
    )
  const reload = async () => {
    await client.send('Page.enable')
    await client.send('Page.reload')
  }
  const waitForWatchDirectory = (dir, timeout = 5000) => {
    const target = normalize(dir)
    const start = Date.now()
    return (async () => {
      while (Date.now() - start < timeout) {
        const watched = await client.evaluate(`window.bridge.invoke('watch', 'getDirectories')`)
        if (watched.some((item) => typeof item === 'string' && normalize(item) === target)) return true
        await sleep(150)
      }
      return false
    })()
  }

  // —— 目录视图 ——
  await setPane({ ...pane.state, path: fixtureDir, expandedDirectories: [], tagFocus: null })
  await reload()
  const deadline = Date.now() + 10_000
  let currentPath = ''
  while (Date.now() < deadline) {
    currentPath = await client.evaluate(
      `document.querySelector('[data-current-path]')?.getAttribute('data-current-path') ?? ''`
    )
    if (currentPath && normalize(currentPath) === normalize(fixtureDir)) break
    await sleep(200)
  }
  assert.equal(normalize(currentPath), normalize(fixtureDir), '文件视图未切换到样本目录')

  await waitFor(
    (state) => ['alpha.txt|', 'beta.txt|', 'gamma.txt|'].every((name) => state.rows.some((row) => row.startsWith(name))),
    '目录视图初始加载',
    8000
  )

  // 观测整表重载的可见信号：刷新按钮在 loading 时带 animate-spin。
  assert.equal(await installProbe(), true, '未找到刷新按钮，无法观测整表重载')

  // 回归：重复对账不得拆掉已在监听的目录（曾因 unwatch 自动挂载的父目录导致事件全丢）。
  await client.evaluate(`window.bridge.invoke('watch', 'getDirectories').then(() => window.bridge.invoke('watch', 'getDirectories'))`)
  await sleep(300)
  assert.equal(await waitForWatchDirectory(fixtureDir), true, '样本目录未进入监听集合')

  await writeFile(paths.beta, 'beta-changed-size')
  cases.modify = await waitFor(
    (state) => state.rows.some((row) => row.startsWith('beta.txt|') && row.includes('|17 B')),
    '目录视图修改文件刷新'
  )

  await writeFile(paths.added, 'added')
  cases.add = await waitFor((state) => state.rows.some((row) => row.startsWith('added.txt|')), '目录视图新增文件刷新')

  await rm(paths.gamma, { force: true })
  cases.remove = await waitFor((state) => !state.rows.some((row) => row.startsWith('gamma.txt|')), '目录视图删除文件刷新')

  const directoryEvidence = await probeEvidence()
  assert.equal(directoryEvidence.spin, 0, '增量更新期间不应出现整表重载（刷新按钮进入 loading）')
  assert.ok(directoryEvidence.alphaConnected, '未变更条目的行节点应保持挂载')
  assert.ok(directoryEvidence.alphaText?.startsWith('alpha.txt|'), '未变更条目内容不应变化')
  await clearProbe()

  // —— 标签聚合视图 ——
  tag = await client.evaluate(`window.bridge.invoke('annotations', 'create', { name: ${JSON.stringify(`verify-watch-${Date.now()}`)} })`)
  assert.ok(tag?.id, '创建标签失败')
  await client.evaluate(
    `window.bridge.invoke('annotations', 'assignTag', { paths: ${JSON.stringify([paths.alpha, paths.beta])}, tagId: ${JSON.stringify(tag.id)} })`
  )

  await setPane({ ...pane.state, path: null, expandedDirectories: [], tagFocus: { tagId: tag.id, name: tag.name } })
  await reload()
  await waitFor(
    (state) => state.body.includes(`标签聚合：${tag.name}`) && ['alpha.txt|', 'beta.txt|'].every((name) => state.rows.some((row) => row.startsWith(name))),
    '标签聚合视图加载',
    10_000
  )
  assert.ok(
    !(await snapshot()).rows.some((row) => row.startsWith('added.txt|') || row.startsWith('untagged.txt|')),
    '标签聚合视图不应混入未打标签的文件'
  )
  assert.equal(await waitForWatchDirectory(fixtureDir), true, '标签聚合视图未登记文件所在目录')

  assert.equal(await installProbe(), true, '标签聚合视图未找到刷新按钮')

  await writeFile(paths.beta, 'tag-beta-changed-21by')
  cases.tagModify = await waitFor(
    (state) => state.rows.some((row) => row.startsWith('beta.txt|') && row.includes('|21 B')),
    '标签聚合视图修改文件刷新'
  )

  await writeFile(paths.untagged, 'untagged')
  await sleep(1500)
  cases.tagUntaggedIgnored = !(await snapshot()).rows.some((row) => row.startsWith('untagged.txt|'))
  assert.ok(cases.tagUntaggedIgnored, '标签聚合视图不应因目录内未打标签文件变更而新增条目')

  const tagEvidence = await probeEvidence()
  assert.equal(tagEvidence.spin, 0, '标签聚合视图增量更新不应出现整表重载')
  assert.ok(tagEvidence.alphaConnected, '标签聚合视图未变更条目的行节点应保持挂载')
  assert.ok(tagEvidence.alphaText?.startsWith('alpha.txt|'), '标签聚合视图未变更条目内容不应变化')

  const shot = await captureShot('explorer-watch-tag.png')

  await rm(paths.alpha, { force: true })
  cases.tagRemove = await waitFor(
    (state) => !state.rows.some((row) => row.startsWith('alpha.txt|')),
    '标签聚合视图删除文件刷新'
  )

  console.log(
    JSON.stringify({
      directory: {
        modifyMs: cases.modify.elapsed,
        addMs: cases.add.elapsed,
        removeMs: cases.remove.elapsed,
        reloadSpin: directoryEvidence.spin
      },
      tag: {
        modifyMs: cases.tagModify.elapsed,
        removeMs: cases.tagRemove.elapsed,
        untaggedIgnored: cases.tagUntaggedIgnored,
        reloadSpin: tagEvidence.spin,
        shot
      }
    })
  )
} finally {
  if (originalPane) {
    await client
      .evaluate(
        `window.bridge.invoke('workspaces', 'setPane', ${JSON.stringify(originalPane.workspaceId)}, ${JSON.stringify(originalPane.paneId)}, ${JSON.stringify(originalPane.state)})`
      )
      .catch(() => {})
    await client.send('Page.reload').catch(() => {})
  }
  if (tag?.id) {
    await client.evaluate(`window.bridge.invoke('annotations', 'remove', ${JSON.stringify(tag.id)})`).catch(() => {})
  }
  await clearProbe()
  client.close()
  await rm(fixtureDir, { recursive: true, force: true })
}
