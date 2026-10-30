import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!isError(result), mcpText(result))
  return JSON.parse(mcpText(result))
}
const isError = (result) => result.isError === true
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
const diff = (a, b, path = '') => {
  const out = []
  if (typeof a === 'number' && typeof b === 'number') {
    if (Math.abs(a - b) > 0.01) out.push(`${path}: ${a} -> ${b}`)
    return out
  }
  if (a === null || b === null || typeof a !== 'object' || typeof b !== 'object') {
    if (a !== b) out.push(`${path}: ${JSON.stringify(a)} -> ${JSON.stringify(b)}`)
    return out
  }
  for (const key of new Set([...Object.keys(a), ...Object.keys(b)]))
    out.push(...diff(a[key], b[key], `${path}.${key}`))
  return out
}

await panel({ action: 'open', boardId: 'crop-probe' })
const samples = join(outDir, 'samples', 'leafer-board')
const png = join(samples, 'sample.png')
await command('import', { paths: [png], x: 20, y: 230 })
await wait(async () => (await command('renderState')).images === 1)
const image = (await inspect()).scene.nodes.find((n) => n.type === 'image')?.id
assert.ok(image, 'image node missing')
await command('select', { ids: [image] })

const report = (label, live, after, node) => {
  console.log(`\n=== ${label} ===`)
  console.log('live :', JSON.stringify({ box: live?.box, layer: live?.layer, clip: live?.clip }))
  console.log('after:', JSON.stringify({ box: after?.box, layer: after?.layer, clip: after?.clip }))
  const problems = live && after
    ? [
        ...diff(live.box, after.box, 'box'),
        ...diff(live.layer, after.layer, 'layer'),
        ...diff({ ...live.clip, id: undefined }, { ...after.clip, id: undefined }, 'clip')
      ]
    : ['state missing']
  console.log(problems.length ? 'DIFF: ' + problems.join(' | ') : 'MATCH')
  console.log('node :', JSON.stringify(node))
}

const closeAndCompare = async (label, live) => {
  await wait(async () => (await command('renderState')).cropEditing === null)
  const node = await wait(async () => {
    const n = (await inspect()).scene.nodes.find((n) => n.id === image)
    return n.clip ? n : null
  })
  const after = await command('cropState', { id: image })
  report(label, live, after, {
    x: node.x, y: node.y, width: node.width, height: node.height,
    rotation: node.rotation, scaleX: node.scaleX, scaleY: node.scaleY, clip: node.clip
  })
  await writeFile(join(outDir, `crop-after-${label}.png`), Buffer.from((mcpImage(await mcpCall('capture_window'))).data, 'base64'))
}

const scenario = async (label, mutate) => {
  await command('cropOpen')
  await command('cropState')
  await mutate()
  const live = await command('cropState')
  await writeFile(join(outDir, `crop-live-${label}.png`), Buffer.from((mcpImage(await mcpCall('capture_window'))).data, 'base64'))
  assert.equal(await command('cropClose'), true)
  await closeAndCompare(label, live)
}

await scenario('resize', async () => {
  await command('cropResize', { width: 240, height: 135 })
})
await scenario('ratio-then-resize', async () => {
  await command('cropRatio', { ratio: '1:1' })
  await command('cropResize', { width: 160, height: 120 })
})

// 模拟"点击画布其他位置退出裁剪"：裁剪中把选区切到另一个节点，触发编辑器 unload → END → finishClip
await command('import', { paths: [png], x: 420, y: 230 })
await wait(async () => (await command('renderState')).images === 2)
const second = (await inspect()).scene.nodes.filter((n) => n.type === 'image' && n.id !== image).map((n) => n.id)[0]
await command('select', { ids: [image] })
{
  await command('cropOpen')
  await command('cropResize', { width: 200, height: 150 })
  const live = await command('cropState')
  await command('select', { ids: [second] })
  const stillEditing = (await command('renderState')).cropEditing
  console.log(`\n=== click-away === after select(other) cropEditing=${JSON.stringify(stillEditing)}`)
  await closeAndCompare('click-away', live)
}

// 先缩放再裁剪：transform scale 1.5 后进入裁剪并确认
await command('select', { ids: [image] })
await command('transform', { scale: 1.5 })
{
  await command('cropOpen')
  await command('cropResize', { width: 300, height: 200 })
  const live = await command('cropState')
  await command('cropClose')
  await closeAndCompare('scaled-source', live)
}

// 先旋转再裁剪
await command('select', { ids: [image] })
await command('transform', { angle: 15 })
{
  await command('cropOpen')
  await command('cropResize', { width: 260, height: 140 })
  const live = await command('cropState')
  await command('cropClose')
  await closeAndCompare('rotated-source', live)
}

console.log('\nprobe done')
