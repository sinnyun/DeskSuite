import assert from 'node:assert/strict'
import { mkdir, writeFile, copyFile, readdir } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'
ensureOutDir()
const root = join(projectRoot, 'artifacts/verify/samples/explorer-concept')
await mkdir(root, { recursive: true })
for (const folder of ['.workcrate', '999', '20260412', '临时文件', '头像']) await mkdir(join(root, folder), { recursive: true })
await writeFile(join(root, '设计说明.md'), '# 界面优化\n\n紧凑工具栏、清晰层级与统一蓝色强调。\n')
await writeFile(join(root, '素材清单.md'), '# 素材清单\n')
await writeFile(join(root, '示例.vectorcraft'), '{}')
const source = process.argv[2] || 'D:/桌面文件夹/测试'
try {
  const images = (await readdir(source)).filter(name => /\.png$/i.test(name))
  for (const name of images) await copyFile(join(source, name), join(root, name))
} catch {
  assert.ok((await readdir(root)).some(name => /\.png$/i.test(name)), 'Provide a PNG sample directory as the first argument.')
}
await mcpHandshake()
const call = async (name, args) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  return result
}
const pane = args => call('quick_bookmarks_explorer', args)
const command = id => call('command_run', { id })
const cdp = await connectCdp()
const pause = () => new Promise(resolve => setTimeout(resolve, 700))
const shot = async name => {
  await pause()
  const image = mcpImage(await call('capture_window', {}))
  assert.ok(image)
  await writeFile(join(outDir, name), Buffer.from(image.data, 'base64'))
}
try {
  for (let i = 0; i < 100; i++) {
    if (await cdp.evaluate('!!document.querySelector("[data-file-explorer-toolbar]")')) break
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  await call('control_window', { action: 'resize', width: 2048, height: 1152 })
  await pane({ action: 'navigate', path: root })
  const names = await readdir(root)
  const image = names.includes('Shot 007.png') ? 'Shot 007.png' : names.find(name => /\.png$/i.test(name))
  const selected = join(root, image)
  await call('meta_rate', { path: selected, rating: 4 })
  await call('meta_favorite', { path: selected, favorite: true })
  const groups = JSON.parse(mcpText(await call('quick_bookmarks', { action: 'list' })))
  if (!groups[0].items.some(item => item.path === root)) await call('quick_bookmarks', { action: 'add', groupId: groups[0].id, paths: [root] })
  if (await cdp.evaluate(`!!document.querySelector('[title="折叠底部抽屉"]')`)) await call('command_run', { id: 'ui.toggle-sidebar', params: { region: 'bottom' } })
  await pane({ action: 'view', viewMode: 'grouped' })
  await pane({ action: 'select', paths: [selected] })
  await pause()
  const inspect = () => cdp.evaluate(`(() => {
    const rect = el => { const r = el.getBoundingClientRect(); return { x:r.x, y:r.y, width:r.width, height:r.height } }
    return { cards: [...document.querySelectorAll('[data-file-card]')].map(el => ({ ...rect(el), text:el.innerText, selected:el.getAttribute('aria-pressed') })),
      toolbar: [...document.querySelectorAll('[data-toolbar-row]')].map(el => ({...rect(el), scrollWidth:el.scrollWidth})),
      workspaceCaption: document.querySelector('[data-workspace-tools] select')?.selectedOptions[0]?.textContent,
      filterRows: [...new Set([...document.querySelector('[data-toolbar-filters]').children].map(el => Math.round(el.getBoundingClientRect().top)))],
      filterControlHeights: [...document.querySelectorAll('[data-toolbar-filters] select')].map(el => el.getBoundingClientRect().height),
      inspector: document.querySelector('[data-file-inspector]')?.innerText,
      overflow: document.documentElement.scrollWidth > innerWidth,
      dark: document.documentElement.classList.contains('dark') }
  })()`)
  if ((await inspect()).dark) await command('system.toggle-theme')
  await shot('explorer-concept-light.png')
  const wide = await inspect()
  assert.ok(wide.cards.length >= 9)
  assert.ok(wide.cards.every(card => card.width === 152))
  assert.ok(wide.cards.some(card => card.selected === 'true' && card.text.includes('4')))
  assert.ok(wide.inspector.includes('完整路径'))
  assert.ok(!wide.overflow)
  assert.ok(wide.workspaceCaption.includes('工作区：'))
  assert.ok(wide.filterControlHeights.every(height => height === 28))
  assert.equal(wide.toolbar[1].height, 40)
  await command('system.toggle-theme')
  await shot('explorer-concept-dark.png')
  await command('system.toggle-theme')
  await call('control_window', { action: 'resize', width: 1280, height: 850 })
  await shot('explorer-concept-compact.png')
  const compact = await inspect()
  assert.ok(!compact.overflow)
  assert.ok(compact.toolbar.every(row => row.scrollWidth <= row.width + 1))
  await call('control_window', { action: 'resize', width: 2048, height: 1152 })
  await writeFile(join(outDir, 'explorer-concept.json'), JSON.stringify({ wide, compact }, null, 2))
  console.log('Explorer concept: MCP navigation/view/selection/metadata and wide/compact geometry passed.')
} finally { cdp.close() }
