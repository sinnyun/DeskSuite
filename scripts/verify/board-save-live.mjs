import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureOutDir, outDir, mcpHandshake, mcpCall, mcpText, mcpImage } from './common.mjs'

ensureOutDir()
await mcpHandshake()
async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  try { return JSON.parse(mcpText(result)) } catch { return mcpText(result) }
}
const panel = args => call('whiteboard_panel', args)
const command = (command, args = {}, deferSave = false) => panel({ action: 'command', command, args, deferSave })
const inspect = () => panel({ action: 'inspect' })
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms))
const profile = join(outDir, 'profiles', process.env.DESKSUITE_SAVE_PROFILE || 'board-save-v2')
const expectedPath = join(outDir, 'board-save-expected.json')
const boardId = 'save-live'
const checks = []
if (process.argv.includes('--check-restart')) {
  const expected = JSON.parse(await readFile(expectedPath, 'utf8'))
  assert.equal(await call('whiteboard_get', { id: boardId }), expected.json)
  await panel({ action: 'open', boardId })
  assert.equal((await inspect()).scene.nodes[0].x, 999)
  assert.ok(!(await call('whiteboard_list')).includes('legacy-save'))
  checks.push('window close flush survives restart; removed legacy scene stays removed')
} else {
  // Fixture only: seed an isolated profile before the first storage request.
  const scene = { format: 'desksuite-leafer', version: 1, title: '迁移测试画板', nodes: [],
    view: { x: 60, y: 60, zoom: 1 }, background: 'dots', snap: false, rulers: false, guides: [], bookmarks: [] }
  await mkdir(join(profile, 'data'), { recursive: true })
  const legacyPath = join(profile, 'data/leafer-board-scenes.json')
  const legacy = JSON.stringify({ version: 1, data: { 'legacy-save': JSON.stringify(scene) } })
  await writeFile(legacyPath, legacy)
  assert.equal(JSON.parse(await call('whiteboard_get', { id: 'legacy-save' })).title, scene.title)
  assert.equal(await readFile(legacyPath, 'utf8'), legacy)
  checks.push('legacy scene migrated with original file untouched')
  await call('whiteboard_set', { id: boardId, sceneJson: JSON.stringify({ ...scene, title: '防抖保存验证' }) })
  await panel({ action: 'open', boardId })
  const id = await command('add', { type: 'rect', x: 80, y: 90 })
  const file = join(profile, 'data/leafer-boards', `${Buffer.from(boardId).toString('hex')}.json`)
  const index = join(profile, 'data/leafer-boards/index.json')
  const before = await stat(file), indexBefore = await stat(index)
  for (let n = 1; n <= 20; n++) await command('update', { ids: [id], patch: { x: 80 + n } }, true)
  assert.equal((await inspect()).saving, true)
  assert.equal(JSON.parse(await call('whiteboard_get', { id: boardId })).nodes[0].x, 80)
  assert.equal((await stat(file)).mtimeMs, before.mtimeMs)
  await sleep(700)
  assert.equal(JSON.parse(await call('whiteboard_get', { id: boardId })).nodes[0].x, 100)
  assert.equal((await inspect()).saving, false)
  assert.equal((await stat(index)).mtimeMs, indexBefore.mtimeMs)
  checks.push('20 edits coalesce; pending status honest; index untouched by geometry changes')
  for (let n = 1; n <= 11; n++) {
    await command('update', { ids: [id], patch: { x: 200 + n } }, true)
    if (n === 10) assert.ok(JSON.parse(await call('whiteboard_get', { id: boardId })).nodes[0].x > 200)
    await sleep(220)
  }
  await panel({ action: 'flush' })
  checks.push('continuous changes persist within maximum wait')
  const stable = await stat(file)
  const json = await call('whiteboard_get', { id: boardId })
  await call('whiteboard_set', { id: boardId, sceneJson: json })
  assert.equal((await stat(file)).mtimeMs, stable.mtimeMs)
  checks.push('identical external save does not rewrite document')
  await call('whiteboard_remove', { id: 'legacy-save' })
  await command('update', { ids: [id], patch: { x: 450 } }, true)
  await panel({ action: 'open', boardId: 'save-other' })
  assert.equal(JSON.parse(await call('whiteboard_get', { id: boardId })).nodes[0].x, 450)
  checks.push('switching boards drains pending changes')
  await panel({ action: 'open', boardId })
}
await sleep(350)
const shot = mcpImage(await mcpCall('capture_window'))
assert.ok(shot)
await writeFile(join(outDir, 'board-save-live.png'), Buffer.from(shot.data, 'base64'))
if (!process.argv.includes('--check-restart')) {
  const snapshot = await inspect()
  const nodeId = snapshot.scene.nodes[0].id
  await command('update', { ids: [nodeId], patch: { x: 999 } }, true)
  const expected = await inspect()
  assert.equal(expected.saving, true)
  await writeFile(expectedPath, JSON.stringify({ json: JSON.stringify(expected.scene) }))
  await call('control_window', { action: 'close' })
  await sleep(700)
  const stored = JSON.parse(await readFile(join(profile, 'data/leafer-boards', `${Buffer.from(boardId).toString('hex')}.json`), 'utf8'))
  assert.equal(JSON.parse(stored.data).nodes[0].x, 999)
  checks.push('closing application flushes pending edit before debounce expires')
}
await writeFile(join(outDir, process.argv.includes('--check-restart') ? 'board-save-restart.json' : 'board-save-live.json'), JSON.stringify({ passed: true, checks }, null, 2))
console.log(JSON.stringify({ passed: true, checks }, null, 2))
