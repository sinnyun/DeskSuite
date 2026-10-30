import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile, copyFile } from 'node:fs/promises'
import { createHash } from 'node:crypto'
import { spawnSync } from 'node:child_process'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir, projectRoot } from './common.mjs'

ensureOutDir()
const checks = []
// Verify the native File boundary without automating a file picker or drag event.
const preload = await readFile(join(projectRoot, 'src/preload/index.ts'), 'utf8')
let bridge, sent = []
class NativeFile { constructor(path) { this.path = path } }
const context = vm.createContext({ File: NativeFile, exports: {}, require: () => ({
  contextBridge: { exposeInMainWorld(name, value) { assert.equal(name, 'bridge'); bridge = value } },
  ipcRenderer: { on() {}, invoke: async (...args) => { sent.push(args); return 'registered' } },
  webUtils: { getPathForFile: file => file.path }
}) })
vm.runInContext(ts.transpileModule(preload, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
await bridge.invoke('resources', 'register', new NativeFile('E:\\图片 #1.png'))
assert.equal(sent[0][3][0], 'E:\\图片 #1.png')
assert.throws(() => bridge.invoke('resources', 'register', new NativeFile('')), /本地源文件/)
assert.equal(sent.length, 1)
checks.push('native File arguments become original paths; pathless files fail before IPC (boundary harness)')
await mcpHandshake()
const panel = async args => {
  const result = await mcpCall('whiteboard_panel', args)
  assert.ok(!result.isError, mcpText(result))
  return JSON.parse(mcpText(result))
}
const command = (command, args = {}) => panel({ action: 'command', command, args })
const wait = async fn => {
  for (let i = 0; i < 100; i++) {
    if (await fn()) return
    await new Promise(resolve => setTimeout(resolve, 100))
  }
  throw new Error('readiness timeout')
}
const shot = async name => {
  const result = await mcpCall('capture_window')
  await writeFile(join(outDir, name), Buffer.from(mcpImage(result).data, 'base64'))
}
const cdp = await connectCdp()
try {
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(join(outDir, 'whiteboard-drop.json'), 'utf8'))
    await panel({ action: 'open', boardId: expected.boardId })
    await wait(async () => (await command('renderState')).images === expected.scene.nodes.length)
    // Leafer may recenter the camera when the floating panel/window resizes.
    // Image geometry and durable resource identities must remain exact.
    assert.deepEqual((await panel({ action: 'inspect' })).scene.nodes, expected.scene.nodes)
    const stored = mcpText(await mcpCall('whiteboard_get', { id: expected.boardId }))
    assert.ok(!/data:|base64|blob:|\?v=/.test(stored))
    await shot('whiteboard-drop-restart.png')
    checks.push('restart restores exact image geometry/resource links and decodes every image')
    console.log(JSON.stringify({ passed: true, checks }, null, 2))
  } else {
    const folder = join(outDir, 'samples', 'whiteboard-drop')
    await mkdir(folder, { recursive: true })
    const first = join(folder, '中文 空格 #1%.png'), second = join(folder, 'second.png')
    const generated = spawnSync('C:/ffmpeg/bin/ffmpeg.exe', ['-y', '-f', 'lavfi', '-i', 'testsrc2=size=800x600', '-frames:v', '1', first], { encoding: 'utf8' })
    assert.equal(generated.status, 0, generated.stderr)
    await copyFile(first, second)
    const hash = createHash('sha256').update(await readFile(first)).digest('hex')
    const boardId = `drop-verify-${Date.now()}`
    await panel({ action: 'open', boardId })
    const blank = (await panel({ action: 'inspect' })).scene
    blank.view = { x: 25, y: 35, zoom: 2 }
    blank.background = 'none'
    await panel({ action: 'replace', sceneJson: JSON.stringify(blank) })
    const box = await cdp.evaluate(`(() => { const r = document.querySelector('[data-whiteboard-canvas]').getBoundingClientRect(); return {left:r.left,top:r.top,width:r.width,height:r.height} })()`)
    const point = { clientX: box.left + 125, clientY: box.top + 135 }
    const drop = args => command('dropImport', { ...point, ...args })
    const ids = await drop({ payload: JSON.stringify([first, second, first]) })
    assert.equal(ids.length, 2)
    await wait(async () => (await command('renderState')).images === 2)
    let scene = (await panel({ action: 'inspect' })).scene
    assert.equal(scene.nodes[0].x, 50)
    assert.equal(scene.nodes[0].y, 50)
    assert.equal(scene.nodes[1].x, 82)
    assert.equal(scene.nodes[0].width, 480)
    assert.equal(scene.nodes[0].height, 360)
    const reference = scene.nodes[0].resource
    assert.match(reference, /^desksuite-resource:\/\/local\//)
    await command('undo')
    assert.equal((await panel({ action: 'inspect' })).scene.nodes.length, 0)
    await command('redo')
    assert.equal((await panel({ action: 'inspect' })).scene.nodes.length, 2)
    checks.push('multi-file internal payload deduplicates, respects 2x drop coordinates/aspect ratio, and is one undo step')
    await drop({ uriList: `# local paths\r\n${pathToFileURL(first).href}\r\n${pathToFileURL(first).href}` })
    scene = (await panel({ action: 'inspect' })).scene
    assert.equal(scene.nodes.length, 3)
    assert.equal(scene.nodes[2].resource, reference)
    await drop({ uriList: `${reference}\n${reference}` })
    assert.equal((await panel({ action: 'inspect' })).scene.nodes.length, 4)
    checks.push('encoded Chinese/space/hash/percent file URI and existing resource links reuse stable identity')
    const before = JSON.stringify((await panel({ action: 'inspect' })).scene)
    for (const args of [
      { payload: '{bad-json' }, { paths: [''] }, { paths: [folder] },
      { paths: [first, join(folder, 'missing.png')] },
      { uriList: 'https://example.com/image.png' }, { uriList: 'data:image/png;base64,AAAA' },
      { uriList: 'file:///E:/bad%ZZ.png' }, { paths: Array(101).fill(first) },
      { paths: [first], clientX: 'invalid' }, { files: [{}] }
    ]) {
      const result = await mcpCall('whiteboard_panel', { action: 'command', command: 'dropImport', args: { ...point, ...args } })
      assert.ok(result.isError, JSON.stringify(args))
      assert.equal(JSON.stringify((await panel({ action: 'inspect' })).scene), before, 'invalid batch inserted partial nodes')
    }
    checks.push('10 invalid/pathless/missing/remote/oversized inputs leave scene unchanged')
    await panel({ action: 'flush' })
    scene = (await panel({ action: 'inspect' })).scene
    const stored = JSON.parse(mcpText(await mcpCall('whiteboard_get', { id: boardId })))
    assert.deepEqual(JSON.parse(stored), scene)
    assert.ok(!/data:|base64|blob:|\?v=/.test(stored))
    assert.ok(stored.length < 10000)
    assert.equal(createHash('sha256').update(await readFile(first)).digest('hex'), hash)
    assert.ok(scene.nodes.every(n => n.type === 'image' && n.resource.startsWith('desksuite-resource:')))
    checks.push('disk scene stores stable links only, source bytes unchanged')
    await wait(async () => (await command('renderState')).images === 4)
    await shot('whiteboard-drop.png')
    await writeFile(join(outDir, 'whiteboard-drop.json'), JSON.stringify({ passed: true, boardId, checks, scene }, null, 2))
    console.log(JSON.stringify({ passed: true, checks }, null, 2))
  }
} finally { cdp.close() }
