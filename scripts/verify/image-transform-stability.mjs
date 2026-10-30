import assert from 'node:assert/strict'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureOutDir, outDir, mcpHandshake, mcpCall, mcpText, mcpImage } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const call = async (name, args = {}) => {
  const r = await mcpCall(name, args)
  assert.ok(!r.isError, mcpText(r))
  return JSON.parse(mcpText(r))
}
const panel = args => call('whiteboard_panel', args)
const command = (command, args = {}) => panel({ action: 'command', command, args })
const inspect = () => panel({ action: 'inspect' })
const wait = async fn => {
  for (let i = 0; i < 100; i++) {
    const result = await fn()
    if (result) return result
    await new Promise(r => setTimeout(r, 50))
  }
  throw new Error('readiness timeout')
}
const checkGeometry = (actual, expected) => {
  for (const part of ['box', 'layer']) for (const key of Object.keys(expected[part]))
    assert.ok(Math.abs(actual[part][key] - expected[part][key]) < 0.001, `${part}.${key}: ${actual[part][key]} != ${expected[part][key]}`)
}
const samples = join(outDir, 'samples', 'image-transform-stability')
await mkdir(samples, { recursive: true })
const png = join(samples, 'source.png')
const generated = spawnSync('C:/ffmpeg/bin/ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=960x640', '-frames:v', '1', png], { encoding: 'utf8' })
assert.equal(generated.status, 0, generated.stderr)
await panel({ action: 'open', boardId: `image-stable-${Date.now()}` })
await command('import', { paths: [png], x: 100, y: 140 })
const id = (await inspect()).scene.nodes.find(n => n.type === 'image').id
await command('select', { ids: [id] })
const runtime = async () => (await command('renderState')).imageNodes.find(n => n.id === id)
await wait(async () => (await runtime())?.ready)
const initial = await runtime()
const checks = []
const stable = async label => {
  const actual = await runtime()
  assert.deepEqual(actual, initial, `${label}: image instance/layer/lease replaced or image became unready`)
  checks.push(label)
}
for (const [label, args] of [
  ['move', { dx: 50, dy: -15 }], ['scale', { scale: 0.8 }], ['rotate', { angle: 25 }], ['flip', { flip: 'x' }]
]) {
  await command('transform', args)
  await stable(label)
  await command('undo')
  await stable(`${label} undo`)
  await command('redo')
  await stable(`${label} redo`)
  await command('select', { ids: [id] })
}
await command('update', { patch: { name: '更新名称', tags: ['图片'], x: 125, y: 145, width: 360, height: 240 } })
await stable('model update and resize')
await command('lock', { value: true })
await stable('lock')
await command('select', { ids: [id] })
await command('lock', { value: false })
await stable('unlock')
await command('select', { ids: [id] })
await command('cropOpen')
await command('cropResize', { width: 240, height: 160 })
const liveCrop = await command('cropState')
await command('cropClose')
await stable('crop commit')
checkGeometry(await command('cropState', { id }), liveCrop)
await command('select', { ids: [id] })
const beforeResize = await command('cropState', { id })
await command('transform', { scale: 1.25 })
await stable('cropped scale')
const scaledCrop = await command('cropState', { id })
const savedNode = (await inspect()).scene.nodes.find(n => n.id === id)
for (const key of Object.keys(savedNode.clip))
  assert.ok(Math.abs(savedNode.clip[key] - scaledCrop.layer[key]) < 0.001, `saved crop child ${key} differs from displayed child`)
await command('undo')
await stable('cropped scale undo')
checkGeometry(await command('cropState', { id }), beforeResize)
await command('redo')
await stable('cropped scale redo')
checkGeometry(await command('cropState', { id }), scaledCrop)
await command('select', { ids: [id] })
await command('transform', { dx: 20, dy: 10, angle: 10 })
await stable('cropped move and rotate')
await panel({ action: 'flush' })
const geometry = await command('cropState', { id })
const boardId = (await inspect()).id
await panel({ action: 'open', boardId: `stable-other-${Date.now()}` })
await panel({ action: 'open', boardId })
await wait(async () => (await runtime())?.ready)
checkGeometry(await command('cropState', { id }), geometry)
assert.notEqual((await runtime()).instance, initial.instance, 'board reopen should own a new image instance')
checks.push('reopen reproduces persisted cropped image geometry')
await command('select', { ids: [id] })
const screenshotScene = (await inspect()).scene
screenshotScene.view = { x: 420, y: 100, zoom: 1 }
await panel({ action: 'replace', sceneJson: JSON.stringify(screenshotScene) })
await command('select', { ids: [id] })
const exported = await command('export', { format: 'png', download: false })
assert.ok(exported.data.startsWith('data:image/png'))
checks.push('full export after rapid board navigation remains available')
const result = await mcpCall('capture_window')
await writeFile(join(outDir, 'image-transform-stability.png'), Buffer.from(mcpImage(result).data, 'base64'))
await writeFile(join(outDir, 'image-transform-stability.json'), JSON.stringify({ passed: true, boardId, checks, initial }, null, 2))
console.log(JSON.stringify({ passed: true, checks }, null, 2))
