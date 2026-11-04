// Context-menu engine zone verification.
// Opens every data-context-zone menu through the dev:context-menu broadcast
// (MCP dev_open_context_menu with optional target selector / point), reads the
// rendered menu items read-only via CDP, and captures one capture_window
// screenshot per zone into artifacts/verify/.
// Requires an isolated full instance (launch.mjs --access full --write-root artifacts/verify/samples).

import { mkdirSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import assert from 'node:assert/strict'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const fixtureDir = join(outDir, 'samples', 'context-menu')
const fileA = join(fixtureDir, 'alpha.txt')
const fileB = join(fixtureDir, 'beta.txt')
const nested = join(fixtureDir, 'nested')
const report = { startedAt: new Date().toISOString(), fixtureDir, zones: [], screenshots: [], checks: [] }

function parseJson(result, label) {
  const text = mcpText(result)
  assert.notEqual(result?.isError, true, `${label}: ${text ?? 'MCP error'}`)
  try { return JSON.parse(text) } catch { throw new Error(`${label}: invalid JSON response`) }
}

async function call(name, args = {}) {
  return parseJson(await mcpCall(name, args), name)
}

async function command(id, params = {}) {
  return call('command_run', { id, params })
}

const cdp = await connectCdp()
ensureOutDir()
await mcpHandshake()

const shot = async (name) => {
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image?.data, `capture_window returned no image for ${name}`)
  const path = join(outDir, `context-menu-${name}.png`)
  writeFileSync(path, Buffer.from(image.data, 'base64'))
  report.screenshots.push(path)
  return path
}

const readMenu = () => cdp.evaluate(`(() => {
  const root = document.querySelector('[data-context-menu-open="true"]')
  if (!root) return null
  const items = [...root.querySelectorAll('[data-menu-item]')].map(el => ({
    id: el.getAttribute('data-menu-item'),
    label: el.getAttribute('data-menu-label') ?? '',
    disabled: el.hasAttribute('data-menu-disabled')
  }))
  return { zone: root.getAttribute('data-context-menu-zone'), seq: root.getAttribute('data-context-menu-seq'), items }
})()`)

const elementPoint = (selector) => cdp.evaluate(`(() => {
  const el = document.querySelector(${JSON.stringify(selector)})
  if (!el) return null
  const rect = el.getBoundingClientRect()
  if (rect.width <= 0 || rect.height <= 0) return null
  return { x: Math.round(rect.left + rect.width / 2), y: Math.round(rect.top + rect.height / 2) }
})()`)

// Each dev_open_context_menu replaces the open menu; poll until the overlay seq
// advances so a stale menu from the previous zone is never read.
let lastSeq = 0
const openZone = async (zoneId, { point, selector } = {}) => {
  const args = { zoneId }
  if (point) { args.x = point.x; args.y = point.y }
  if (selector) args.selector = selector
  await call('dev_open_context_menu', args)
  let menu = null
  for (let i = 0; i < 30 && !menu; i += 1) {
    await sleep(100)
    const current = await readMenu()
    if (current && Number(current.seq) > lastSeq) menu = current
  }
  assert.ok(menu, `zone ${zoneId}: menu did not open`)
  lastSeq = Number(menu.seq)
  return menu
}

const verifyZone = async ({ name, zoneId, point, selector, expect, expectAny = [] }) => {
  const menu = await openZone(zoneId, { point, selector })
  const labels = menu.items.map((item) => item.label)
  for (const fragment of expect) {
    assert.ok(labels.some((label) => label.includes(fragment)), `zone ${zoneId}: expected "${fragment}" in ${JSON.stringify(labels)}`)
  }
  if (expectAny.length) {
    assert.ok(
      expectAny.some((fragment) => labels.some((label) => label.includes(fragment))),
      `zone ${zoneId}: expected any of ${JSON.stringify(expectAny)} in ${JSON.stringify(labels)}`
    )
  }
  await shot(name)
  report.zones.push({ name, zoneId, resolvedZone: menu.zone, target: selector ?? (point ? 'point' : 'zone-element'), items: labels })
  report.checks.push(`${name}: ${labels.length} items (${labels.slice(0, 4).join(' / ')}${labels.length > 4 ? ' …' : ''})`)
  return menu
}

try {
  // ---- fixture ----------------------------------------------------------
  rmSync(fixtureDir, { recursive: true, force: true })
  mkdirSync(nested, { recursive: true })
  writeFileSync(fileA, 'alpha sample for context menus\n'.repeat(4))
  writeFileSync(fileB, 'beta sample for context menus\n'.repeat(4))
  writeFileSync(join(nested, 'inner.txt'), 'nested sample\n')

  // ---- explorer shell zones ---------------------------------------------
  await call('quick_bookmarks_explorer', { action: 'navigate', path: fixtureDir })
  await sleep(600)
  await call('quick_bookmarks_explorer', { action: 'select', paths: [fileA, fileB] })
  await sleep(300)

  await verifyZone({ name: 'shell-top', zoneId: 'shell.top', expect: ['命令面板', '重置工作台布局'] })
  await verifyZone({ name: 'shell-activity', zoneId: 'shell.activity', expect: ['命令面板'] })
  await verifyZone({ name: 'shell-tabs', zoneId: 'shell.tabs', expect: ['重置工作台布局'] })

  // Entry hit via dev_open_context_menu selector: merged order-10 explorer menu + order-20 file-actions.
  const cardExists = await elementPoint('[data-entry-path]')
  assert.ok(cardExists, 'explorer fixture card not found after navigate')
  await verifyZone({
    name: 'explorer-workspace-entry',
    zoneId: 'explorer.workspace',
    selector: '[data-entry-path]',
    expect: ['收藏', '复制路径', '文件操作', '拖到其他应用']
  })
  await verifyZone({ name: 'explorer-workspace-blank', zoneId: 'explorer.workspace', expect: ['刷新', '排序'] })
  await verifyZone({ name: 'explorer-breadcrumb', zoneId: 'explorer.breadcrumb', expect: ['复制当前路径'] })
  await verifyZone({ name: 'explorer-tree', zoneId: 'explorer.tree', expect: ['新建收藏分组…'] })
  await verifyZone({ name: 'explorer-status', zoneId: 'explorer.status', expect: ['清除选择'] })
  await verifyZone({ name: 'explorer-inspector', zoneId: 'explorer.inspector', expect: ['导出目录清单…'] })
  await verifyZone({ name: 'fallback-desktop', zoneId: 'zone-that-does-not-exist', expect: ['命令面板'] })

  // ---- floating panels ----------------------------------------------------
  await command('ui.open-panel', { panel: 'debug-console' })
  await sleep(600)
  await verifyZone({ name: 'debug-rows', zoneId: 'debug.rows', expect: ['导出 JSON'] })
  await verifyZone({ name: 'debug-status', zoneId: 'debug.status', expect: ['打开调试台'] })

  await command('ui.open-panel', { panel: 'launcher' })
  await sleep(600)
  await verifyZone({ name: 'launcher-panel', zoneId: 'launcher.panel', expect: ['重新扫描'] })

  await mcpCall('open_settings_page', { page: 'storage' })
  await sleep(600)
  const storageRow = await elementPoint('[data-storage-path]')
  assert.ok(storageRow, 'settings storage row not found')
  await verifyZone({ name: 'settings-panel', zoneId: 'settings.panel', selector: '[data-storage-path]', expect: ['打开所在位置'] })

  await call('basket_manage', { action: 'add', items: [{ path: fileA, name: 'alpha.txt', isDirectory: false, kind: 'file', size: 120, modifiedAt: Date.now() }] })
  await command('ui.open-panel', { panel: 'basket' })
  await sleep(600)
  const basketCard = await elementPoint('[data-basket-path]')
  assert.ok(basketCard, 'basket card not found after add')
  await verifyZone({ name: 'insights-basket', zoneId: 'insights.basket', selector: '[data-basket-path]', expect: ['移出暂存', '复制路径'] })

  await command('ui.open-panel', { panel: 'clipboard' })
  await sleep(600)
  await verifyZone({ name: 'clipboard-panel', zoneId: 'clipboard.panel', expect: ['新建分组…'] })

  await call('resource_register', { path: fileB })
  await call('resource_view', { action: 'open' })
  await sleep(800)
  const resourceCard = await elementPoint('[data-resource-entry]')
  assert.ok(resourceCard, 'resource card not found after register')
  await verifyZone({ name: 'resources-panel', zoneId: 'resources.panel', selector: '[data-resource-entry]', expect: ['预览', '取消登记'] })

  // Search panel: empty query falls back to the desktop menu (typing needs real input; out of scope).
  await command('ui.toggle-floating-panel', { panel: 'global-search' })
  await sleep(500)
  const searchMenu = await openZone('search.results')
  assert.equal(searchMenu.zone, '__desktop', 'empty search results must fall back to the desktop menu')
  await shot('search-results-fallback')
  report.zones.push({ name: 'search-results-fallback', zoneId: 'search.results', resolvedZone: searchMenu.zone, items: searchMenu.items.map((item) => item.label) })
  report.checks.push('search.results: empty query falls back to __desktop (panel input needs real typing)')

  // ---- sidebar tabs -------------------------------------------------------
  await command('ui.open-tab', { region: 'left', id: 'annotations' })
  await sleep(600)
  await verifyZone({ name: 'annotations-tags', zoneId: 'annotations.tags', expect: ['新建根标签…'] })

  await call('quick_bookmarks_explorer', { action: 'select', paths: [fileA] })
  await call('versions_create', { path: fileA, title: 'context menu smoke', confirm: true })
  await sleep(1200)
  await command('ui.open-tab', { region: 'right', id: 'versions' })
  await sleep(800)
  await verifyZone({ name: 'versions-panel', zoneId: 'versions.panel', expect: ['刷新版本状态'] })

  // ---- workcrate ----------------------------------------------------------
  const project = parseJson(await mcpCall('command_run', { id: 'ipc.workcrate.projects.create', params: { args: ['ContextmenuSmoke'] } }), 'projects.create')
  const projectId = project?.project?.id ?? project?.id
  assert.ok(projectId, `workcrate project id missing: ${JSON.stringify(project)}`)
  await mcpCall('workcrate_panel_open', { projectId })
  await sleep(1000)
  const pageCard = await elementPoint('[data-page-id]')
  if (pageCard) {
    await verifyZone({ name: 'workcrate-pages', zoneId: 'workcrate.pages', selector: '[data-page-id]', expect: ['编辑页面', '导出选中图片'] })
    const thumb = await elementPoint('[data-board-id]')
    if (thumb) await verifyZone({ name: 'workcrate-thumbs', zoneId: 'workcrate.thumbs', selector: '[data-board-id]', expect: ['编辑页面'] })
    else report.checks.push('workcrate.thumbs: no thumbnail element rendered; skipped')
  } else {
    report.checks.push('workcrate.pages: pure project has no page card; skipped')
  }
  await mcpCall('workcrate_panel_open', {})
  await sleep(800)
  const projectCard = await elementPoint('[data-workcrate-project]')
  assert.ok(projectCard, 'workcrate project card not found after create')
  await verifyZone({ name: 'workcrate-projects', zoneId: 'workcrate.projects', selector: '[data-workcrate-project]', expect: ['打开页面管理', '删除工程'] })

  // ---- whiteboard -----------------------------------------------------------
  await mcpCall('whiteboard_panel', { action: 'open' })
  await sleep(1500)
  await verifyZone({ name: 'canvas-board-blank', zoneId: 'canvas.board', expect: ['添加元素', '导入文件…'] })
  // add selects the new node; fit {selection:true} centers it so the canvas-center
  // point is a realistic right-click position (handler also falls back to selection).
  await mcpCall('whiteboard_panel', { action: 'command', command: 'add', args: { type: 'rect', x: 140, y: 120 } })
  await sleep(400)
  await mcpCall('whiteboard_panel', { action: 'command', command: 'fit', args: { selection: true } })
  await sleep(400)
  const canvasPoint = await elementPoint('[data-context-zone="canvas.board"]')
  await verifyZone({ name: 'canvas-board-node', zoneId: 'canvas.board', point: canvasPoint, expect: ['复制', '层级', '锁定'] })
  await mcpCall('whiteboard_panel', { action: 'flush' })

  await call('basket_manage', { action: 'remove', path: fileA })
  report.finishedAt = new Date().toISOString()
} finally {
  cdp.close()
}

writeFileSync(join(outDir, 'context-menu.json'), JSON.stringify(report, null, 2))
console.log(`OK: ${report.zones.length} zones, ${report.screenshots.length} screenshots`)
for (const check of report.checks) console.log(` - ${check}`)
