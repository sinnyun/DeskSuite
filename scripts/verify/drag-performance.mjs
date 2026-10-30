import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureOutDir, outDir, mcpCall, mcpText, mcpHandshake, connectCdp, mcpImage } from './common.mjs'

ensureOutDir()
await mcpHandshake()
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const panel = args => call('whiteboard_panel', args)
const command = (command, args = {}) => panel({ action: 'command', command, args })
if (process.argv.includes('--inspect-live')) {
  const state = await command('renderState')
  const capture = mcpImage(await mcpCall('capture_window'))
  const png = Buffer.from(capture.data, 'base64')
  await writeFile(join(outDir, 'drag-live-window.png'), png)
  console.log(JSON.stringify({ state, pngWidth: png.readUInt32BE(16), pngHeight: png.readUInt32BE(20) }))
  process.exitCode = 0
} else {
assert.ok(!(await mcpCall('control_window', { action: 'focus' })).isError)
const gpu = await call('get_app_info')
const cdp = await connectCdp()
const results = []
try {
  await panel({ action: 'open', boardId: `drag-perf-${Date.now()}` })
  const blank = (await panel({ action: 'inspect' })).scene
  for (const count of [9, 200]) {
    const scene = { ...blank, view: { x: 40, y: 35, zoom: 1 }, snap: false, rulers: false, background: 'none', nodes: Array.from({ length: count }, (_, i) => ({
      id: `shape-${i}`, type: 'rect', name: `对象 ${i}`, x: 40 + (i % 10) * 90, y: 140 + Math.floor(i / 10) * 80,
      width: 64, height: 50, rotation: 0, scaleX: 1, scaleY: 1, fill: '#dbeafe', tags: [], locked: false, collapsed: false
    })) }
    for (const snap of [false, true]) for (const effects of ['current', 'opaque']) {
      scene.snap = snap
      await panel({ action: 'replace', sceneJson: JSON.stringify(scene) })
      await command('select', { ids: ['shape-0'] })
      // Let pending auto-save and preview effects settle before measuring gesture-only work.
      await panel({ action: 'flush' })
      await new Promise(r => setTimeout(r, 400))
      const measured = await command('profileMove', { steps: 60, dx: 1, dy: 0.3, effects })
      if (!process.argv.includes('--baseline')) {
        const sizing = await command('renderState')
        assert.equal(sizing.height, sizing.viewport.height)
        assert.equal(sizing.width, sizing.viewport.width)
        assert.deepEqual(sizing.rendererSize, sizing.viewport)
      }
      assert.equal(measured.sceneUpdatesDuringMove, 0, 'gesture updated React/persistent scene')
      if (!snap) assert.ok(measured.maximumOffset < 0.001, 'element lags requested movement coordinates')
      results.push(measured)
      console.log(JSON.stringify(measured))
      await command('undo')
      const restored = (await panel({ action: 'inspect' })).scene.nodes[0]
      assert.equal(restored.x, scene.nodes[0].x)
      assert.equal(restored.y, scene.nodes[0].y)
    }
  }
  const page = await (await fetch('http://127.0.0.1:41595/api/v2/item/get?limit=30', { signal: AbortSignal.timeout(5000) })).json()
  assert.equal(page.status, 'success')
  const candidate = page.data.data.find(item => !item.isDeleted && /^(jpg|jpeg|png|webp)$/i.test(item.ext) && item.width * item.height >= 4_000_000)
  assert.ok(candidate, 'Eagle must expose an image of at least 4 megapixels for the large-image profile')
  const eagle = await call('eagle_link', { itemId: candidate.id })
  const scene = { ...blank, nodes: [], snap: false, rulers: false, view: { x: 40, y: 35, zoom: 1 } }
  await panel({ action: 'replace', sceneJson: JSON.stringify(scene) })
  const [image] = await command('import', { reference: eagle.resourceUri, x: 100, y: 140 })
  await command('select', { ids: [image] })
  await new Promise(r => setTimeout(r, 500))
  for (const effects of ['current', 'opaque']) {
    const measured = await command('profileMove', { steps: 60, dx: 0.3, dy: 0.1, effects })
    assert.ok(measured.maximumOffset < 0.001)
    results.push({ ...measured, scenario: 'eagle-image', width: eagle.width, height: eagle.height })
    console.log(JSON.stringify(results.at(-1)))
  }
  const readGeometry = () => cdp.evaluate(`(() => { const root=document.querySelector('[data-whiteboard-canvas]');const mount=root.firstElementChild;const panel=root.closest('.wb-panel');return {panelBackdrop:getComputedStyle(panel).backdropFilter,canvasWidth:root.clientWidth,canvasHeight:root.clientHeight,mountWidth:mount.clientWidth,mountHeight:mount.clientHeight,mountPosition:getComputedStyle(mount).position,canvases:[...mount.querySelectorAll('canvas')].map(c=>({cssWidth:parseFloat(c.style.width),cssHeight:parseFloat(c.style.height),width:c.width,height:c.height,context:c.getContext('2d')?.getContextAttributes()})),pixelRatio:devicePixelRatio} })()`)
  const geometryChecks = []
  if (!process.argv.includes('--baseline')) {
    for (const [width, height] of [[1600, 1000], [1200, 760], [1500, 900], [1600, 1000]]) {
      assert.ok(!(await mcpCall('control_window', { action: 'resize', width, height })).isError)
      await new Promise(r => setTimeout(r, 350))
      const geometry = await readGeometry()
      assert.equal(geometry.mountPosition, 'absolute')
      assert.equal(geometry.mountWidth, geometry.canvasWidth)
      assert.equal(geometry.mountHeight, geometry.canvasHeight)
      for (const canvas of geometry.canvases) {
        assert.equal(canvas.cssWidth, geometry.canvasWidth)
        assert.equal(canvas.cssHeight, geometry.canvasHeight)
        assert.equal(canvas.width, Math.ceil(geometry.canvasWidth * geometry.pixelRatio))
        assert.equal(canvas.height, Math.ceil(geometry.canvasHeight * geometry.pixelRatio))
      }
      geometryChecks.push(geometry)
    }
  }
  const dom = await readGeometry()
  const suffix = process.argv.includes('--baseline') ? 'baseline' : 'after'
  await writeFile(join(outDir, `drag-performance-${suffix}.json`), JSON.stringify({ passed: true, gpu, dom, results, geometryChecks }, null, 2))
  const capture = await mcpCall('capture_window')
  await writeFile(join(outDir, `drag-performance-${suffix}.png`), Buffer.from(mcpImage(capture).data, 'base64'))
  console.log(JSON.stringify({ passed: true, gpu: gpu.gpuFeatures, dom }))
} finally { cdp.close() }
}
