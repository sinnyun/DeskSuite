import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const report = []
const root = join(projectRoot, 'artifacts/verify/samples/quick-bookmarks')
const a = join(root, '设计素材')
const b = join(root, '工作文件')
const file = join(root, '说明.txt')
const call = async (tool, args) => {
  const result = await mcpCall(tool, args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const act = (args) => call('quick_bookmarks', args)
const pane = (args) => call('quick_bookmarks_explorer', args)
const wait = async (expression) => {
  for (let i = 0; i < 80; i++) {
    if (await cdp.evaluate(expression)) return
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error(`DOM timeout: ${expression}`)
}
try {
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(join(outDir, 'quick-bookmarks-expected.json'), 'utf8'))
    assert.deepEqual(await act({ action: 'list' }), expected)
    await wait('document.querySelectorAll("[data-bookmark-path]").length === 2')
    report.push('重启后分组、名称、路径及删除结果保持一致')
  } else {
    await mkdir(a, { recursive: true }); await mkdir(b, { recursive: true }); await writeFile(file, 'fixture')
    for (const group of await act({ action: 'list' })) await act({ action: 'deleteGroup', groupId: group.id })
    let groups = await act({ action: 'createGroup', name: '常用' })
    const groupId = groups.at(-1).id
    groups = await act({ action: 'createGroup', name: '临时' })
    const secondId = groups.at(-1).id
    await pane({ action: 'navigate', path: root })
    await pane({ action: 'select', paths: [a, b, file] })
    groups = await pane({ action: 'addSelected', groupId })
    assert.equal(groups[0].items.length, 2)
    assert.deepEqual(groups[0].items.map((item) => item.path).sort(), [a, b].sort())
    groups = await pane({ action: 'addSelected', groupId })
    assert.equal(groups[0].items.length, 2)
    groups = await act({ action: 'add', groupId, paths: [a + '\\', a.toUpperCase()] })
    assert.equal(groups[0].items.length, 2)
    await pane({ action: 'addSelected', groupId: secondId })
    report.push('混合选择只收藏文件夹；同组去重；跨组允许相同地址')
    const itemId = groups[0].items[0].id
    const otherPath = groups[0].items[1].path
    groups = await act({ action: 'renameGroup', groupId, name: '我的工作' })
    groups = await act({ action: 'edit', groupId, itemId, name: '素材仓库', path: root })
    await pane({ action: 'open', groupId, itemId })
    await wait(`Array.from(document.querySelectorAll('[data-bookmark-path]')).some(el => el.dataset.bookmarkPath === ${JSON.stringify(root)})`)
    await pane({ action: 'open', groupId, itemId: groups[0].items[1].id })
    await wait(`Array.from(document.querySelectorAll('button[title]')).some(el => el.title === ${JSON.stringify(otherPath)} && el.className.includes('font-semibold'))`)
    report.push('分组重命名、收藏名称/地址编辑、点击收藏跳转')
    await pane({ action: 'navigate', path: root })
    await pane({ action: 'select', paths: [a, b] })
    await wait('document.querySelectorAll("[data-bookmark-path]").length === 4')
    await mcpCall('control_window', { action: 'focus' })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const groupsImage = mcpImage(await mcpCall('capture_window'))
    await writeFile(join(outDir, 'quick-bookmarks-groups.png'), Buffer.from(groupsImage.data, 'base64'))
    const before = await act({ action: 'list' })
    for (const args of [
      { action: 'add', groupId, paths: [a, file] },
      { action: 'edit', groupId, itemId, name: '错误', path: file },
      { action: 'renameGroup', groupId, name: ' ' },
      { action: 'add', groupId, paths: ['relative'] },
      { action: 'edit', groupId, itemId, name: '重复', path: otherPath }
    ]) assert.equal((await mcpCall('quick_bookmarks', args)).isError, true)
    assert.deepEqual(await act({ action: 'list' }), before)
    await pane({ action: 'select', paths: [] })
    assert.equal((await mcpCall('quick_bookmarks_explorer', { action: 'addSelected', groupId })).isError, true)
    report.push('文件/相对路径/空名称/重复编辑/空选择拒绝，批量失败原子保留')
    await act({ action: 'remove', groupId: secondId, itemId: before[1].items[0].id })
    await act({ action: 'deleteGroup', groupId: secondId })
    const final = await act({ action: 'list' })
    await writeFile(join(outDir, 'quick-bookmarks-expected.json'), JSON.stringify(final, null, 2))
    await wait('document.querySelectorAll("[data-bookmark-group]").length === 1 && document.querySelectorAll("[data-bookmark-path]").length === 2')
    const geometry = await cdp.evaluate(`(() => { const el = document.querySelector('[data-quick-bookmarks]'); const rect = el.getBoundingClientRect(); return { width: rect.width, overflow: el.scrollWidth > el.clientWidth, text: el.innerText, plusDisabled: [...el.querySelectorAll('button')].filter(b => b.title.includes('请先')).every(b => b.disabled) } })()`)
    assert.ok(geometry.width > 100 && !geometry.overflow)
    assert.ok(geometry.plusDisabled)
    assert.ok(!geometry.text.includes('当前目录'))
    report.push({ geometry })
    await new Promise((resolve) => setTimeout(resolve, 600))
    const image = mcpImage(await mcpCall('capture_window'))
    assert.ok(image)
    await writeFile(join(outDir, 'quick-bookmarks.png'), Buffer.from(image.data, 'base64'))
  }
  console.log(JSON.stringify({ ok: true, report }, null, 2))
  await writeFile(join(outDir, process.argv.includes('--check-restart') ? 'quick-bookmarks-restart.json' : 'quick-bookmarks.json'), JSON.stringify({ ok: true, report }, null, 2))
} finally { cdp.close() }
