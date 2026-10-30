import assert from 'node:assert/strict'
import { writeFile, readFile, mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { spawnSync } from 'node:child_process'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const checks = []
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
const shot = async (name) => {
  const image = mcpImage(await mcpCall('capture_window'))
  assert.ok(image)
  await writeFile(join(outDir, name), Buffer.from(image.data, 'base64'))
}
try {
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(join(outDir, 'leafer-expected.json'), 'utf8'))
    for (const [id, json] of Object.entries(expected)) assert.equal(await call('whiteboard_get', { id }), json)
    await panel({ action: 'open', boardId: 'leafer-verify-a' })
    await wait(async () => {
      try {
        return (await command('renderState')).images === 1
      } catch {
        return false
      }
    })
    assert.equal((await inspect()).scene.nodes.filter((n) => n.type === 'image').length, 1)
    checks.push('restart restores exact scenes and decoded image reference')
  } else {
    const samples = join(outDir, 'samples', 'leafer-board')
    await mkdir(samples, { recursive: true })
    const png = join(samples, 'sample.png'),
      video = join(samples, 'sample.webm')
    for (const [target, source] of [
      [png, 'testsrc2=size=320x180'],
      [video, 'testsrc2=size=320x180:rate=20']
    ]) {
      const result = spawnSync(
        'C:/ffmpeg/bin/ffmpeg.exe',
        [
          '-y',
          '-f',
          'lavfi',
          '-i',
          source,
          ...(target.endsWith('.png') ? ['-frames:v', '1'] : ['-t', '3', '-c:v', 'libvpx', '-an']),
          target
        ],
        { encoding: 'utf8' }
      )
      assert.equal(result.status, 0, result.stderr)
    }
    await panel({ action: 'open', boardId: 'leafer-verify-a' })
    await wait(async () => {
      try {
        return (await command('renderState')).engine === 'LeaferJS'
      } catch {
        return false
      }
    })
    const blank = {
      format: 'desksuite-leafer',
      version: 1,
      title: 'Leafer 验收画板',
      nodes: [],
      view: { x: 40, y: 35, zoom: 1 },
      background: 'dots',
      snap: true,
      rulers: false,
      guides: [],
      bookmarks: []
    }
    await panel({ action: 'replace', sceneJson: JSON.stringify(blank) })
    const rect = await command('add', { type: 'rect', name: '研究区域', x: 20, y: 40, width: 180, height: 130 })
    const note = await command('add', {
      type: 'note',
      name: '待办便签',
      text: 'LeaferJS 资源画板\n统一链接 · 自动保存',
      x: 240,
      y: 40,
      width: 260,
      height: 150
    })
    await command('select', { ids: [rect, note] })
    const group = await command('group')
    assert.ok(group)
    assert.ok((await inspect()).scene.nodes.every((n) => n.group === group))
    await command('rotate', { angle: 15 })
    await command('undo')
    assert.ok((await inspect()).scene.nodes.every((n) => n.rotation === 0))
    await command('redo')
    assert.ok((await inspect()).scene.nodes.every((n) => n.rotation === 15))
    await command('undo')
    await command('select', { ids: [rect, note] })
    await command('ungroup')
    checks.push('real command path: shapes, notes, group, rotation, undo and redo')
    await command('select', { ids: [rect] })
    await command('settings', { snap: false })
    const transformed = await command('transform', { dx: 30, dy: 20, scale: 1.2, angle: 10 })
    assert.ok(transformed[0].rotation !== 0)
    assert.ok(Math.abs(transformed[0].width * transformed[0].scaleX - 216) < 0.001)
    await command('undo')
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).x, 20)
    await command('settings', { snap: true })
    await command('select', { ids: [rect] })
    await command('transform', { dx: 34, dy: 0 })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).x, 60)
    await command('undo')
    await command('guide', { id: 'snap-guide-x', axis: 'x', value: 300 })
    await command('settings', { snap: false })
    await command('settings', { snap: true })
    await command('select', { ids: [rect] })
    await command('transform', { dx: 94, dy: 0 })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).x, 120)
    await shot('leafer-snap.png')
    await command('undo')
    await command('settings', { snap: false })
    await command('zoom', { value: 2 })
    await command('guide', { id: 'snap-guide-zoom-x', axis: 'x', value: 700 })
    await command('settings', { snap: true })
    await command('select', { ids: [rect] })
    await command('transform', { dx: 500, dy: 0 })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).x, 520)
    await command('undo')
    await command('guide', { id: 'snap-guide-zoom-y', axis: 'y', value: 700 })
    await command('select', { ids: [rect] })
    await command('transform', { dx: 0, dy: 530 })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).y, 570)
    await command('undo')
    await command('guide', { id: 'snap-guide-zoom-x', remove: true })
    await command('guide', { id: 'snap-guide-zoom-y', remove: true })
    await command('zoom', { value: 1 })
    await command('settings', { snap: false })
    checks.push('easy-snap alignment to sibling nodes and persistent ruler guides on both axes at zoom 1x and 2x through the MCP editor transform path')
    await command('select', { ids: [rect] })
    await command('copy')
    await command('paste')
    assert.equal((await inspect()).scene.nodes.length, 3)
    await command('delete')
    assert.equal((await inspect()).scene.nodes.length, 2)
    await command('select', { ids: [rect] })
    await command('lock', { value: true })
    await command('delete')
    assert.equal((await inspect()).scene.nodes.length, 2)
    await command('select', { ids: [rect] })
    await command('lock', { value: false })
    await command('flip', { axis: 'x' })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === rect).scaleX, -1)
    await command('undo')
    await command('select', { ids: [rect, note] })
    const frame = await command('frameSelection')
    assert.equal((await inspect()).scene.nodes.filter((n) => n.frame === frame).length, 2)
    await command('undo')
    await command('select', { ids: [note] })
    await command('update', {
      patch: {
        html: '<b>LeaferJS</b><ul><li>统一资源</li><li><i>重启恢复</i></li></ul>',
        text: 'LeaferJS\n统一资源\n重启恢复',
        tags: ['研究', '资源']
      }
    })
    const invalidUpdate = await mcpCall('whiteboard_panel', {
      action: 'command',
      command: 'update',
      args: { patch: { width: -2 } }
    })
    assert.ok(invalidUpdate.isError)
    await command('collapse', { value: true })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === note).collapsed, true)
    await command('collapse', { value: false })
    checks.push(
      'Leafer editor transforms, proportional scaling, clipboard, lock, flip, frames, rich text/list data, collapse and validation'
    )
    const [image] = await command('import', { paths: [png], x: 20, y: 230 })
    const [movie] = await command('import', { paths: [video], x: 370, y: 230 })
    await wait(async () => (await command('renderState')).images === 1)
    await command('select', { ids: [image] })
    assert.equal(await command('cropOpen'), true)
    assert.equal((await command('renderState')).cropEditing, image)
    const opened = await command('cropState')
    assert.equal(opened.editing, true)
    assert.ok(opened.layer.width > 0 && opened.layer.height > 0)
    const entryWidth = opened.box.width
    const squared = await command('cropRatio', { ratio: '1:1' })
    assert.ok(squared.clip.width > 0 && squared.clip.height > 0)
    const resized = await command('cropResize', { width: 200, height: 120 })
    assert.ok(Math.abs(resized.box.width - 200) < 1 && Math.abs(resized.box.height - 120) < 1)
    await shot('leafer-crop.png')
    assert.equal(await command('cropClose'), true)
    await wait(async () => (await command('renderState')).cropEditing === null)
    const cropped = await wait(async () => {
      const n = (await inspect()).scene.nodes.find((n) => n.id === image)
      return n.clipSpace === 'leafer-local' && Math.abs(n.width - 200) < 1 ? n : null
    })
    assert.equal(cropped.clipSpace, 'leafer-local')
    const committedClip = (await command('cropState', { id: image })).clip
    assert.ok(Math.abs(cropped.width - 200) < 1)
    assert.equal(await command('cropOpen'), true)
    const reset = await command('cropReset')
    assert.ok(Math.abs(reset.box.width - 200) < 1 && Math.abs(reset.box.height - 120) < 1)
    assert.deepEqual(reset.clip, committedClip)
    assert.equal(await command('cropClose'), true)
    await wait(async () => (await command('renderState')).cropEditing === null)
    checks.push('ClipImage inner editor open/ratio/resize/reset/close with native Leafer clip persistence')
    await command('settings', { rulers: true })
    const rulerLayers = await cdp.evaluate(
      `document.querySelector('[data-whiteboard-canvas]')?.querySelectorAll('canvas').length ?? 0`
    )
    assert.ok(rulerLayers >= 3, `expected Leafer ruler canvas layer, found ${rulerLayers}`)
    await command('guide', { axis: 'x', value: 20 })
    await command('bookmark', { name: '总览' })
    assert.equal((await command('search', { query: '待办' })).length, 1)
    let media = await command('media', { id: movie, action: 'inspect' })
    assert.ok(media.readyState >= 1)
    await command('media', { id: movie, action: 'play' })
    media = await command('media', { id: movie, action: 'pause' })
    assert.equal(media.paused, true)
    await command('media', { id: movie, action: 'seek', time: 1 })
    await command('media', { id: movie, action: 'volume', value: 0.4 })
    await wait(async () => Math.abs((await command('media', { id: movie, action: 'inspect' })).currentTime - 1) < 0.2)
    checks.push('image unified URI/decoded lease/crop and native video play/pause/seek/volume')
    const exported = await command('export', { format: 'png', download: false })
    assert.ok(exported.data.startsWith('data:image/png'))
    await writeFile(join(outDir, 'leafer-export.png'), Buffer.from(exported.data.split(',')[1], 'base64'))
    checks.push('PNG static export')
    const jpeg = await command('export', { format: 'jpeg', download: false })
    assert.ok(jpeg.data.startsWith('data:image/jpeg'))
    await command('select', { ids: [image, movie] })
    await command('arrange', { mode: 'horizontal', gap: 30 })
    let arranged = (await inspect()).scene.nodes
    assert.equal(arranged.find((n) => n.id === image).y, arranged.find((n) => n.id === movie).y)
    await command('undo')
    await command('fit')
    let viewport = await command('renderState')
    let viewportScene = await inspect()
    for (const axis of ['x', 'y', 'zoom']) assert.ok(Math.abs(viewport.view[axis] - viewportScene.scene.view[axis]) < 0.001)
    await command('zoom', { value: 1 })
    viewport = await command('renderState')
    viewportScene = await inspect()
    assert.ok(Math.abs(viewport.view.zoom - 1) < 0.001)
    for (const axis of ['x', 'y', 'zoom']) assert.ok(Math.abs(viewport.view[axis] - viewportScene.scene.view[axis]) < 0.001)
    assert.equal(await command('zoom', { value: 0.01 }), 0.05)
    viewport = await command('renderState')
    viewportScene = await inspect()
    assert.equal(viewport.view.zoom, 0.05)
    assert.equal(viewportScene.scene.view.zoom, 0.05)
    await command('zoom', { value: 1 })
    await command('settings', { background: 'grid' })
    await command('settings', { background: 'dots' })
    checks.push('JPEG, arrangement, fit, zoom and background commands')
    const line = await command('add', { type: 'line', name: '连接线', x: 530, y: 70, width: 120, height: 1 })
    const arrow = await command('add', { type: 'arrow', name: '指向箭头', x: 530, y: 120, width: 120, height: 1 })
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === line).type, 'line')
    assert.equal((await inspect()).scene.nodes.find((n) => n.id === arrow).type, 'arrow')
    checks.push('line and arrow scene nodes render through Leafer Line and official Arrow plugin')
    const before = await call('whiteboard_get', { id: 'leafer-verify-a' })
    const b = await command('new', { title: '独立画板 B' })
    assert.equal((await call('resource_view', { action: 'inspect' })).cache.leases, 0)
    await command('add', { type: 'ellipse', name: 'B 的圆', x: 30, y: 30 })
    await panel({ action: 'open', boardId: 'leafer-verify-a' })
    await wait(async () => (await command('renderState')).images === 1)
    assert.equal((await call('resource_view', { action: 'inspect' })).cache.leases, 1)
    assert.equal(await call('whiteboard_get', { id: 'leafer-verify-a' }), before)
    assert.equal((await inspect()).scene.nodes.length, 6)
    assert.equal(JSON.parse(await call('whiteboard_get', { id: b })).nodes.length, 1)
    const bad = await mcpCall('whiteboard_set', { id: 'leafer-verify-a', sceneJson: '{"elements":[]}' })
    assert.equal(bad.isError, true)
    assert.equal(await call('whiteboard_get', { id: 'leafer-verify-a' }), before)
    const expected = Object.fromEntries(
      await Promise.all(['leafer-verify-a', b].map(async (id) => [id, await call('whiteboard_get', { id })]))
    )
    await writeFile(join(outDir, 'leafer-expected.json'), JSON.stringify(expected))
    checks.push('multi-board isolation and invalid legacy schema rejection without overwrite')
  }
  await wait(async () => {
    try {
      return (await command('renderState')).images === 1
    } catch {
      return false
    }
  })
  const geometry = await cdp.evaluate(
    `(()=>{const e=document.querySelector('[data-whiteboard-canvas]'),r=e?.getBoundingClientRect();return {canvas:e?.querySelectorAll('canvas').length,width:r?.width,height:r?.height,video:e?.querySelectorAll('video').length,alerts:[...document.querySelectorAll('[role="alert"]')].map(e=>e.textContent)}})()`
  )
  assert.ok(geometry.canvas >= 1 && geometry.width > 500 && geometry.height > 300)
  assert.deepEqual(geometry.alerts, [])
  await shot('leafer-board.png')
  const report = { passed: true, checks, geometry }
  await writeFile(
    join(outDir, process.argv.includes('--check-restart') ? 'leafer-restart.json' : 'leafer-board.json'),
    JSON.stringify(report, null, 2)
  )
  console.log(JSON.stringify(report, null, 2))
} finally {
  cdp.close()
}
