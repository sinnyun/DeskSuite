import assert from 'node:assert/strict'
import { mkdir, copyFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { ensureOutDir, mcpHandshake, mcpCall, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const panel = async (args) => {
  const r = await mcpCall('whiteboard_panel', args)
  assert.ok(!r.isError, mcpText(r))
  return JSON.parse(mcpText(r))
}
const command = (command, args = {}) => panel({ action: 'command', command, args })
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('readiness timeout')
}
const shot = async (label) => {
  const r = await mcpCall('capture_window')
  await writeFile(join(outDir, `crop-render-${label}.png`), Buffer.from(mcpImage(r).data, 'base64'))
}
const samples = join(outDir, 'samples', 'crop-render')
await mkdir(samples, { recursive: true })
const png = join(samples, 'source.png')
if (process.argv[2]) await copyFile(process.argv[2], png)
else {
  const generated = spawnSync('C:/ffmpeg/bin/ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=1800x1200', '-frames:v', '1', png], { encoding: 'utf8' })
  assert.equal(generated.status, 0, generated.stderr)
}
await panel({ action: 'open', boardId: `crop-render-${Date.now()}` })
await command('import', { paths: [png], x: 30, y: 65 })
await wait(async () => (await command('renderState')).images === 1)
const id = (await panel({ action: 'inspect' })).scene.nodes.find(n => n.type === 'image').id
await command('select', { ids: [id] })
const initialScene = (await panel({ action: 'inspect' })).scene
initialScene.view = { x: 60, y: 90, zoom: 2 }
await panel({ action: 'replace', sceneJson: JSON.stringify(initialScene) })
await wait(async () => (await command('renderState')).images === 1)
const checks = []
const geometry = ({ box, layer }) => ({ box, layer })
const assertGeometry = (actual, expected) => {
  for (const part of ['box', 'layer']) for (const key of Object.keys(expected[part]))
    assert.ok(Math.abs(actual[part][key] - expected[part][key]) < 0.001, `${part}.${key}: ${actual[part][key]} != ${expected[part][key]}`)
}
for (const [label, width, height] of [['first', 350, 250], ['repeat', 270, 190]]) {
  await command('select', { ids: [id] })
  const before = geometry(await command('cropState', { id }))
  await command('cropOpen')
  await command('cropResize', { width, height })
  await new Promise(r => setTimeout(r, 350))
  const live = geometry(await command('cropState'))
  await shot(`${label}-live`)
  await command('cropClose')
  await new Promise(r => setTimeout(r, 800))
  const after = geometry(await command('cropState', { id }))
  assertGeometry(after, live)
  await shot(`${label}-after`)
  await command('undo')
  await new Promise(r => setTimeout(r, 500))
  assertGeometry(await command('cropState', { id }), before)
  await command('redo')
  await new Promise(r => setTimeout(r, 500))
  assertGeometry(await command('cropState', { id }), after)
  checks.push({ label, live, after, undoRedo: true })
}
const final = geometry(await command('cropState', { id }))
await panel({ action: 'flush' })
const boardId = (await panel({ action: 'inspect' })).id
await panel({ action: 'open', boardId: `crop-other-${Date.now()}` })
await panel({ action: 'open', boardId })
await wait(async () => (await command('renderState')).images === 1)
await new Promise(r => setTimeout(r, 500))
assertGeometry(await command('cropState', { id }), final)
await command('select', { ids: [id] })
await shot('reopened')
await writeFile(join(outDir, 'crop-render.json'), JSON.stringify({ passed: true, id, boardId, checks, reopened: true }, null, 2))
console.log(JSON.stringify({ passed: true, boardId, checks: checks.map(c => c.label), reopened: true }))
