import assert from 'node:assert/strict'
import { join } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpText, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const panel = (args) => call('whiteboard_panel', args)
const command = (command, args = {}) => panel({ action: 'command', command, args })
const inspect = () => panel({ action: 'inspect' })
const wait = async (fn) => {
  for (let i = 0; i < 100; i++) {
    const v = await fn()
    if (v) return v
    await new Promise((r) => setTimeout(r, 100))
  }
  throw new Error('readiness timeout')
}
const geo = (n) => ({ x: n.x, y: n.y, width: n.width, height: n.height, rotation: n.rotation, scaleX: n.scaleX, scaleY: n.scaleY, clip: n.clip ?? null, crop: n.crop ?? null })

await panel({ action: 'open', boardId: `crop-undo-probe-${Date.now()}` })
const png = join(outDir, 'samples', 'leafer-board', 'sample.png')
await command('import', { paths: [png], x: 20, y: 230 })
await wait(async () => (await command('renderState')).images === 1)
const image = (await inspect()).scene.nodes.find((n) => n.type === 'image')?.id
assert.ok(image)
await command('select', { ids: [image] })
const before = geo((await inspect()).scene.nodes.find((n) => n.id === image))

await command('cropOpen')
await command('cropResize', { width: 240, height: 135 })
await command('cropClose')
const cropped = await wait(async () => {
  const n = (await inspect()).scene.nodes.find((n) => n.id === image)
  return n.clip ? geo(n) : null
})
console.log('cropped:', JSON.stringify(cropped))

await command('undo')
const undone = await wait(async () => {
  const n = (await inspect()).scene.nodes.find((n) => n.id === image)
  return n.clip ? n : geo(n)
})
console.log('after undo :', JSON.stringify(geo(undone)))
const undoOk = !undone.clip && Math.abs(undone.width - before.width) < 0.01 && Math.abs(undone.height - before.height) < 0.01

await command('redo')
const redone = await wait(async () => {
  const n = (await inspect()).scene.nodes.find((n) => n.id === image)
  return n.clip ? geo(n) : null
})
console.log('after redo :', JSON.stringify(redone))
const redoOk = redone && Math.abs(redone.width - cropped.width) < 0.01 && Math.abs(redone.height - cropped.height) < 0.01 &&
  Math.abs((redone.clip?.width ?? 0) - (cropped.clip?.width ?? 0)) < 0.001

await command('select', { ids: [image] })
await command('duplicate')
await wait(async () => (await command('renderState')).images === 2)
const nodes = (await inspect()).scene.nodes.filter((n) => n.type === 'image')
const copy = nodes.find((n) => n.id !== image)
const copyOk = copy && Math.abs(copy.width - cropped.width) < 0.01 &&
  Math.abs((copy.clip?.width ?? 0) - (cropped.clip?.width ?? 0)) < 0.001
console.log('copy       :', JSON.stringify(copy ? geo(copy) : null))

console.log(`\nundo: ${undoOk ? 'OK' : 'BROKEN'} | redo: ${redoOk ? 'OK' : 'BROKEN'} | duplicate: ${copyOk ? 'OK' : 'BROKEN'}`)
