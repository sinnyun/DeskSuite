#!/usr/bin/env node
// Zustand smoke: exercise plugin and Explorer pane state through DeskSuite MCP.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, projectRoot } from './common.mjs'

await mcpHandshake()
const report = { checkedAt: new Date().toISOString(), checks: [] }
const targetPath = join(ensureOutDir(), 'samples', 'zustand-s1-marker.txt')
const tagName = `zustand-s1-${Date.now()}`
let tagId
let initialView
const cdp = await connectCdp()
const initialPath = await cdp.evaluate("document.querySelector('[data-current-path]')?.getAttribute('data-current-path') ?? null")
const initialWorkspace = await runCommand('ipc.workspaces.active').catch(() => null)

async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}

async function runCommand(id, params = {}) {
  const raw = await callTool('command_run', { id, params })
  try { return JSON.parse(raw) } catch { return raw }
}

try {
  initialView = JSON.parse(await callTool('quick_bookmarks_explorer', { action: 'view' }))
  await callTool('meta_favorite', { path: targetPath, favorite: true })
  await callTool('meta_rate', { path: targetPath, rating: 4 })
  const metadata = await runCommand('ipc.annotations.for.paths', { args: [[targetPath]] })
  assert.equal(metadata[targetPath]?.favorite, true)
  assert.equal(metadata[targetPath]?.rating, 4)
  const failedRating = await mcpCall('meta_rate', { path: targetPath, rating: 9 })
  assert.equal(failedRating.isError, true)
  const metadataAfterFailure = await runCommand('ipc.annotations.for.paths', { args: [[targetPath]] })
  assert.equal(metadataAfterFailure[targetPath]?.rating, 4)
  report.checks.push('annotation cache reflects MCP favorite/rating writes')
  report.checks.push('invalid annotation write is rejected without replacing the last valid value')

  const tag = JSON.parse(await callTool('tag_create', { name: tagName }))
  tagId = tag.id
  await callTool('tag_assign', { paths: [targetPath], tagId })
  const tagged = JSON.parse(await callTool('tag_files', { tagId }))
  assert.ok(tagged.includes(targetPath))
  report.checks.push('annotation tag writes remain consistent across the MCP boundary')

  const basketItem = { path: targetPath, name: 'zustand-s1-marker.txt', isDirectory: false, kind: 'document', size: 1, modifiedAt: 0 }
  const basket = JSON.parse(await callTool('basket_manage', { action: 'add', items: [basketItem] }))
  assert.ok(basket.some((item) => item.path === targetPath))
  await runCommand('ui.open-panel', { panel: 'basket' })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const basketShot = await mcpCall('capture_window')
  const basketImage = mcpImage(basketShot)
  assert.ok(basketImage, mcpText(basketShot) ?? 'capture_window did not return an image')
  const basketScreenshot = join(ensureOutDir(), 'state-validation-s1-basket.png')
  writeFileSync(basketScreenshot, Buffer.from(basketImage.data, 'base64'))
  report.checks.push('basket MCP write broadcasts to the renderer Zustand cache')
  report.basketScreenshot = basketScreenshot

  const view = JSON.parse(await callTool('quick_bookmarks_explorer', {
    action: 'view', viewMode: 'grid', groupingEnabled: true, groupBy: 'rating', includeChildren: false
  }))
  assert.equal(view.groupOptions.groupBy, 'rating')
  assert.equal(view.groupOptions.includeChildren, false)
  report.checks.push('group options update and read back through the Explorer MCP bridge')

  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: join(projectRoot, 'docs') })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const navigatedPath = await cdp.evaluate("document.querySelector('[data-current-path]')?.getAttribute('data-current-path') ?? null")
  assert.equal(navigatedPath?.toLowerCase(), join(projectRoot, 'docs').toLowerCase())
  report.checks.push('Explorer MCP navigation updates the active pane Zustand store')

  for (const layout of [1, 2, 4]) {
    const result = JSON.parse(await callTool('quick_bookmarks_explorer', { action: 'layout', layout }))
    assert.equal(result.layout, layout)
    assert.equal(result.paneIds.length, layout)
  }
  const fourPane = JSON.parse(await callTool('quick_bookmarks_explorer', { action: 'layout', layout: 4 }))
  await callTool('quick_bookmarks_explorer', { action: 'pane', paneId: fourPane.paneIds[0] })
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: join(projectRoot, 'docs') })
  await callTool('quick_bookmarks_explorer', { action: 'pane', paneId: fourPane.paneIds[1] })
  await callTool('quick_bookmarks_explorer', { action: 'navigate', path: join(projectRoot, 'src') })
  await new Promise((resolve) => setTimeout(resolve, 300))
  const panePaths = await cdp.evaluate("Array.from(document.querySelectorAll('[data-file-workspace][data-pane-id]'), (node) => ({ id: node.getAttribute('data-pane-id'), path: node.getAttribute('data-current-path') }))")
  assert.equal(panePaths.find((pane) => pane.id === fourPane.paneIds[0])?.path?.toLowerCase(), join(projectRoot, 'docs').toLowerCase())
  assert.equal(panePaths.find((pane) => pane.id === fourPane.paneIds[1])?.path?.toLowerCase(), join(projectRoot, 'src').toLowerCase())
  report.checks.push('1/2/4 layouts and independent pane navigation survive active-pane switches')

  await runCommand('ui.open-panel', { panel: 'debug-console' })
  await new Promise((resolve) => setTimeout(resolve, 250))
  const shot = await mcpCall('capture_window')
  const image = mcpImage(shot)
  assert.ok(image, mcpText(shot) ?? 'capture_window did not return an image')
  const screenshot = join(ensureOutDir(), 'state-validation-s1.png')
  writeFileSync(screenshot, Buffer.from(image.data, 'base64'))
  report.screenshot = screenshot
} finally {
  await callTool('basket_manage', { action: 'clear' }).catch(() => undefined)
  if (tagId) {
    await callTool('tag_assign', { paths: [targetPath], tagId, assigned: false }).catch(() => undefined)
    await runCommand('ipc.annotations.remove', { args: [tagId] }).catch(() => undefined)
  }
  await callTool('meta_favorite', { path: targetPath, favorite: false }).catch(() => undefined)
  await callTool('meta_rate', { path: targetPath, rating: 0 }).catch(() => undefined)
  if (initialView) await callTool('quick_bookmarks_explorer', {
    action: 'view',
    viewMode: initialView.viewMode,
    groupingEnabled: initialView.groupingEnabled,
    groupBy: initialView.groupOptions.groupBy,
    includeChildren: initialView.groupOptions.includeChildren
  }).catch(() => undefined)
  if (initialPath) await callTool('quick_bookmarks_explorer', { action: 'navigate', path: initialPath }).catch(() => undefined)
  if (initialWorkspace?.layout) await callTool('quick_bookmarks_explorer', { action: 'layout', layout: initialWorkspace.layout }).catch(() => undefined)
  cdp.close()
}

writeFileSync(join(ensureOutDir(), 'state-validation-s1.json'), `${JSON.stringify(report, null, 2)}\n`)
console.log(JSON.stringify(report, null, 2))
