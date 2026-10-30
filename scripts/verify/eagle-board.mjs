import assert from 'node:assert/strict'
import { createHash } from 'node:crypto'
import { createRequire } from 'node:module'
import { mkdir, readFile, writeFile, readdir, stat, realpath, unlink } from 'node:fs/promises'
import { basename, dirname, extname, join } from 'node:path'
import { pathToFileURL } from 'node:url'
import vm from 'node:vm'
import ts from 'typescript'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpText, mcpImage, outDir, projectRoot } from './common.mjs'

ensureOutDir()
const checks = []
const call = async (name, args = {}) => {
  const r = await mcpCall(name, args)
  assert.ok(!r.isError, mcpText(r))
  return JSON.parse(mcpText(r))
}
const panel = args => call('whiteboard_panel', args)
const command = (command, args = {}) => panel({ action: 'command', command, args })
const wait = async fn => {
  for (let i = 0; i < 100; i++) {
    const value = await fn()
    if (value) return value
    await new Promise(r => setTimeout(r, 100))
  }
  throw new Error('readiness timeout')
}
const shot = async (name, screen = false) => {
  const result = await mcpCall(screen ? 'capture_screen' : 'capture_window')
  await writeFile(join(outDir, name), Buffer.from(mcpImage(result).data, 'base64'))
}
const api = async (path, params = {}) => {
  const url = new URL(path, 'http://127.0.0.1:41595')
  Object.entries(params).forEach(([key, value]) => url.searchParams.set(key, value))
  const data = await (await fetch(url, { signal: AbortSignal.timeout(6000) })).json()
  assert.equal(data.status, 'success')
  return data.data
}
const hash = async path => createHash('sha256').update(await readFile(path)).digest('hex')

// Run production original-selection code against controlled API responses and
// filesystem fixtures. No mock network listeners or Electron UI events.
const fixture = join(outDir, 'samples', 'eagle-cases', 'TEST1.info')
await mkdir(fixture, { recursive: true })
const thumb = join(fixture, 'thumb.png'), original = join(fixture, 'original.png'), duplicate = join(fixture, 'duplicate.png')
await writeFile(thumb, 'thumbnail')
await writeFile(original, 'original-image')
await unlink(duplicate).catch(e => { if (e.code !== 'ENOENT') throw e })
const sourceCode = await readFile(join(projectRoot, 'src/main/plugins/data-provider-eagle-links/eagle.ts'), 'utf8')
const exports = {}
const context = vm.createContext({ exports, require: createRequire(import.meta.url), Buffer, URL, AbortSignal, AbortController, process, fetch })
vm.runInContext(ts.transpileModule(sourceCode, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, context)
let item = { id: 'TEST1', name: '测试原图', ext: 'png', size: 14, folders: ['FOLDER1'], tags: ['标签'], width: 10, height: 20 }
let calls = 0
const client = new exports.EagleClient(async url => {
  calls++
  const path = new URL(url).pathname
  const data = path.endsWith('/thumbnail') ? encodeURIComponent(thumb)
    : path.endsWith('/folder/get') ? { data: [{ id: 'PARENT', name: '父级', children: [{ id: 'FOLDER1', name: '分类' }] }] }
    : { data: [item] }
  return new Response(JSON.stringify({ status: 'success', data }))
})
const normal = await client.resolve('TEST1')
assert.equal(normal.originalPath.toLowerCase(), (await realpath(original)).toLowerCase())
assert.equal(normal.folders[0].name, '分类')
await writeFile(duplicate, 'original-image')
await assert.rejects(client.resolve('TEST1'), /唯一/)
await unlink(duplicate)
item = { ...item, isDeleted: true }
await assert.rejects(client.resolve('TEST1'), /回收站/)
item = { ...item, isDeleted: false, id: 'OTHER' }
await assert.rejects(client.resolve('TEST1'), /不存在/)
item = { ...item, id: 'TEST1', noThumbnail: true, size: 9 }
assert.equal((await client.resolve('TEST1')).originalPath.toLowerCase(), (await realpath(thumb)).toLowerCase())
const beforeInvalidId = calls
await assert.rejects(client.resolve('../bad'), /./)
assert.equal(calls, beforeInvalidId)
checks.push('production resolver: unique original, nested folders, ambiguity/deleted/wrong-ID rejection, noThumbnail and invalid ID')

await mcpHandshake()
const cdp = await connectCdp()
try {
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(join(outDir, 'eagle-board.json'), 'utf8'))
    await panel({ action: 'open', boardId: expected.boardId })
    await wait(async () => (await command('renderState')).images === expected.scene.nodes.length)
    assert.deepEqual((await panel({ action: 'inspect' })).scene.nodes, expected.scene.nodes)
    assert.deepEqual(await call('eagle_source', { reference: expected.source.resourceUri }), expected.source)
    await command('select', { ids: [expected.nodeId] })
    await command('inspector', { tab: 'properties' })
    await wait(() => cdp.evaluate(`!!document.querySelector('[data-eagle-item="${expected.source.itemId}"]')`))
    await shot('eagle-board-restart.png')
    checks.push('restart restores exact image nodes, stable references and cached Eagle metadata in properties')
    await writeFile(join(outDir, 'eagle-board-restart.json'), JSON.stringify({ passed: true, checks }, null, 2))
  } else {
    const page = await api('/api/v2/item/get', { limit: '20' })
    const candidates = page.data.filter(i => !i.isDeleted && /^(png|jpe?g|webp)$/i.test(i.ext))
    const nativeItem = candidates.find(i => !i.noThumbnail && i.ext === 'png') ?? candidates.find(i => !i.noThumbnail)
    const noThumb = candidates.find(i => i.noThumbnail)
    assert.ok(nativeItem && noThumb, 'running Eagle must contain original+thumbnail and noThumbnail image cases')
    const thumbnail = decodeURIComponent(await api('/api/item/thumbnail', { id: nativeItem.id }))
    const candidatesOnDisk = []
    for (const file of await readdir(dirname(thumbnail))) {
      const path = join(dirname(thumbnail), file)
      const info = await stat(path)
      if (info.isFile() && basename(path) !== basename(thumbnail) && extname(path).slice(1).toLowerCase() === nativeItem.ext.toLowerCase() && info.size === nativeItem.size) candidatesOnDisk.push(path)
    }
    assert.equal(candidatesOnDisk.length, 1)
    const path = candidatesOnDisk[0], originalHash = await hash(path)
    const boardId = `eagle-verify-${Date.now()}`
    await panel({ action: 'open', boardId })
    const box = await cdp.evaluate(`(() => { const r=document.querySelector('[data-whiteboard-canvas]').getBoundingClientRect();return {left:r.left,top:r.top} })()`)
    const point = { clientX: box.left + 140, clientY: box.top + 180 }
    const ids = await command('dropImport', { paths: [path], ...point })
    assert.equal(ids.length, 1)
    await wait(async () => (await command('renderState')).images === 1)
    let scene = (await panel({ action: 'inspect' })).scene
    assert.equal(scene.nodes[0].name, nativeItem.name.slice(0, 300))
    const reference = scene.nodes[0].resource
    assert.match(reference, /^desksuite-resource:\/\/local\//)
    let source = await command('eagleInspect')
    assert.equal(source.itemId, nativeItem.id)
    assert.equal(source.resourceUri, reference)
    assert.equal(source.folders.length, nativeItem.folders?.length ?? 0)
    assert.equal((await realpath(path)).toLowerCase(), source.originalPath.toLowerCase())
    checks.push('actual Eagle disk drag entry auto-identifies original, initializes node name/tags and links shared resource')
    const repeated = await call('eagle_link', { location: pathToFileURL(path).href })
    assert.equal(repeated.resourceUri, reference)
    const viaFileUri = await command('dropImport', { uriList: pathToFileURL(source.originalPath).href, ...point })
    assert.equal(viaFileUri.length, 1)
    const viaFileNode = (await panel({ action: 'inspect' })).scene.nodes.find(n => n.id === viaFileUri[0])
    assert.equal(viaFileNode.resource, reference)
    await command('undo')
    await command('select', { ids: [ids[0]] })
    checks.push('canonical UNC file URI drag reuses original identity and can be undone as a batch')
    await command('inspector', { tab: 'properties' })
    await wait(() => cdp.evaluate(`!!document.querySelector('[data-eagle-item="${nativeItem.id}"]')`))
    const text = await cdp.evaluate(`document.querySelector('[data-eagle-item="${nativeItem.id}"]').textContent`)
    assert.ok(text.includes(nativeItem.name) && text.includes('在 Eagle 中定位'))
    assert.ok(source.folders.every(folder => text.includes(folder.name)))
    await shot('eagle-board-properties.png')
    checks.push('properties renders Eagle name/ID/folders, metadata and locate action through registered inspector')
    const before = JSON.stringify((await panel({ action: 'inspect' })).scene)
    for (const args of [{ paths: [thumbnail] }, { uriList: 'eagle://item/../bad' }, { uriList: 'eagle://item/TEST1?unsafe=1' }]) {
      const result = await mcpCall('whiteboard_panel', { action: 'command', command: 'dropImport', args: { ...point, ...args } })
      assert.ok(result.isError)
      assert.equal(JSON.stringify((await panel({ action: 'inspect' })).scene), before)
    }
    const invalidOpen = await mcpCall('eagle_open_item', { itemId: '../unsafe' })
    assert.ok(invalidOpen.isError)
    const deepIds = await command('dropImport', { uriList: `eagle://item/${noThumb.id}`, ...point })
    assert.equal(deepIds.length, 1)
    await wait(async () => (await command('renderState')).images === 2)
    const noThumbSource = await command('eagleInspect')
    assert.equal(noThumbSource.itemId, noThumb.id)
    assert.equal(noThumbSource.originalPath, noThumbSource.thumbnailPath)
    await command('undo')
    assert.equal((await panel({ action: 'inspect' })).scene.nodes.length, 1)
    await command('redo')
    assert.equal((await panel({ action: 'inspect' })).scene.nodes.length, 2)
    checks.push('Eagle item deep-link imports noThumbnail original; invalid links/thumbnail drop fail atomically; undo/redo works')
    await command('select', { ids: [ids[0]] })
    source = await command('eagleInspect', { refresh: true })
    const opened = await command('eagleOpen')
    assert.equal(opened.deepLink, `eagle://item/${nativeItem.id}`)
    await wait(async () => {
      const selected = await api('/api/v2/item/get', { isSelected: 'true', limit: '50' })
      return selected.data.some(i => i.id === nativeItem.id)
    })
    await shot('eagle-item-opened.png', true)
    checks.push('locate dispatched by DeskSuite MCP and actual Eagle API confirms target item is selected')
    await panel({ action: 'flush' })
    scene = (await panel({ action: 'inspect' })).scene
    const stored = await call('whiteboard_get', { id: boardId })
    assert.deepEqual(JSON.parse(stored).nodes, scene.nodes)
    assert.ok(!/data:|base64|blob:|\?v=/.test(stored))
    assert.equal(await hash(path), originalHash)
    // A mapped drive and its canonical UNC path must share one registry identity.
    const viaPath = await call('resource_register', { path })
    const viaCanonical = await call('resource_register', { path: source.originalPath })
    assert.equal(viaPath.uri, viaCanonical.uri)
    checks.push('disk scenes contain stable links only, mapped/UNC paths deduplicate, source bytes unchanged')
    await writeFile(join(outDir, 'eagle-board.json'), JSON.stringify({ passed: true, checks, boardId, nodeId: ids[0], scene, source }, null, 2))
  }
  console.log(JSON.stringify({ passed: true, checks }, null, 2))
} finally { cdp.close() }
