import assert from 'node:assert/strict'
import { readFileSync, writeFileSync } from 'node:fs'
import { createRequire } from 'node:module'
import { dirname, join, resolve } from 'node:path'
import vm from 'node:vm'
import ts from 'typescript'
import { ensureOutDir, outDir, projectRoot } from './common.mjs'

// Execute the production services with a deterministic clock and IPC/Store faults.
const require = createRequire(import.meta.url)
let now = 0, sequence = 0
const timers = new Map()
const setTimer = (fn, ms) => { const id = ++sequence; timers.set(id, { fn, at: now + ms }); return id }
const settle = async () => { for (let n = 0; n < 25; n++) await Promise.resolve() }
async function tick(ms) {
  const end = now + ms
  for (;;) {
    const next = [...timers].sort((a, b) => a[1].at - b[1].at)[0]
    if (!next || next[1].at > end) break
    now = next[1].at; timers.delete(next[0]); next[1].fn(); await settle()
  }
  now = end; await settle()
}
let calls = [], fail = false, hold
const persisted = new Map()
async function call(_service, method, ...args) {
  if (method === 'set') {
    calls.push(args)
    if (hold) await hold
    if (fail) throw Error('disk fault')
    persisted.set(args[0], args[1]); return true
  }
  if (method === 'get') return persisted.get(args[0]) ?? null
  if (method === 'summaries') return [...persisted].map(([id, json]) => ({ id, title: JSON.parse(json).title }))
}
const modules = new Map()
function load(path) {
  path = resolve(path)
  if (modules.has(path)) return modules.get(path).exports
  const module = { exports: {} }; modules.set(path, module)
  const context = vm.createContext({ module, exports: module.exports, structuredClone, Buffer, console,
    setTimeout: setTimer, clearTimeout: id => timers.delete(id),
    require: name => name.endsWith('workbench/sdk') ? { call } : name.startsWith('.')
      ? load(resolve(dirname(path), name + '.ts')) : require(name) })
  vm.runInContext(ts.transpileModule(readFileSync(path, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 }
  }).outputText, context)
  return module.exports
}
const { BoardService, emptyScene } = load(join(projectRoot, 'src/renderer/src/plugins/canvas-provider-scene/model.ts'))
const board = new BoardService()
await board.open('a'); calls = []
for (let n = 1; n <= 100; n++) board.setView({ x: n, y: 0, zoom: 1 })
assert.equal(calls.length, 0); assert.equal(board.getSnapshot().saving, true)
await tick(499); assert.equal(calls.length, 0)
await tick(1); assert.equal(calls.length, 1); assert.equal(JSON.parse(calls[0][1]).view.x, 100)
assert.equal(board.getSnapshot().saving, false)
calls = []
for (let n = 0; n < 10; n++) { board.setView({ x: n + 200, y: 0, zoom: 1 }); await tick(200) }
assert.equal(calls.length, 1, 'max wait bounds continuous changes')
calls = []
board.setView({ x: 1, y: 2, zoom: 1 }); board.setView({ x: 209, y: 0, zoom: 1 })
await board.flush(); assert.equal(calls.length, 0, 'returning to persisted scene skips IPC')
let release
hold = new Promise(r => { release = r })
board.edit(s => { s.title = 'first' }); const flushing = board.flush()
await settle(); board.edit(s => { s.title = 'latest' }); hold = undefined; release(); await flushing
assert.equal(JSON.parse(persisted.get('a')).title, 'latest')
fail = true; board.edit(s => { s.title = 'retry' })
await assert.rejects(board.flush(), /disk fault/)
assert.equal(board.getSnapshot().saving, true); assert.match(board.getSnapshot().error, /disk fault/)
fail = false; await board.flush(); assert.equal(board.getSnapshot().error, '')
board.edit(s => { s.title = 'switch' }); await board.open('b')
assert.equal(JSON.parse(persisted.get('a')).title, 'switch')
await tick(3000); assert.equal(timers.size, 0)

const { BoardStorage } = load(join(projectRoot, 'src/main/plugins/canvas-ops-whiteboard-storage/storage.ts'))
const documents = new Map([['leafer-board-scenes', { Old: JSON.stringify(emptyScene()) }]])
const definitions = new Map(), writes = []
let faultKey
const store = {
  register(key, def) { definitions.set(key, def) },
  registerDocument(key, path, def) { definitions.set(key, { ...def, path }) },
  has: key => definitions.has(key),
  async read(key) { return structuredClone(documents.get(key) ?? definitions.get(key).default) },
  async write(key, value) {
    if (faultKey === key) throw Error('storage fault')
    definitions.get(key).schema.parse(value); documents.set(key, structuredClone(value)); writes.push(key)
  }
}
const storage = new BoardStorage(store)
assert.deepEqual(Array.from(await storage.list()), ['Old'])
assert.equal(documents.get('leafer-board-scenes').Old, JSON.stringify(emptyScene()))
writes.length = 0
const json = JSON.stringify({ ...emptyScene(), title: 'new' })
await storage.set('a', json); await storage.set('A', json)
assert.notEqual(definitions.get('leafer-board-61').path, definitions.get('leafer-board-41').path)
writes.length = 0
await storage.set('a', json); assert.equal(writes.length, 0)
await storage.set('a', JSON.stringify({ ...JSON.parse(json), view: { x: 5, y: 5, zoom: 1 } }))
assert.deepEqual(writes, ['leafer-board-61'], 'ordinary edits only write their own board')
faultKey = 'leafer-board-index'
await assert.rejects(storage.set('new-id', json), /storage fault/)
assert.ok(!(await storage.list()).includes('new-id'))
faultKey = undefined; await storage.set('new-id', json)
assert.ok((await storage.list()).includes('new-id'))
await storage.remove('Old')
const restart = new BoardStorage(store)
assert.equal(await restart.get('Old'), null, 'legacy deletion never resurrects on restart')
assert.equal(await restart.get('A'), json)
assert.throws(() => storage.set('bad', '{"resource":"data:image/png;base64,abc"}'))
const shared = board.getSnapshot().scene.nodes
board.edit(s => { s.title = 'sharing' })
assert.equal(board.getSnapshot().scene.nodes, shared, 'non-node edits retain the nodes array')
assert.throws(() => storage.set('cycle', JSON.stringify({ ...emptyScene(), groups: [{ id: 'g', parent: 'g' }] })))
assert.throws(() => storage.set('singular', JSON.stringify({ ...emptyScene(), groups: [{ id: 'g', scaleX: 0 }] })))
const enginePath = join(projectRoot, 'src/renderer/src/plugins/canvas-ops-whiteboard/engine.ts')
const ast = ts.createSourceFile(enginePath, readFileSync(enginePath, 'utf8'), ts.ScriptTarget.Latest, true)
const engineClass = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'BoardEngine')
const guard = engineClass.members.find(n => n.name?.getText(ast) === 'protectComposition')
const guardContext = vm.createContext({})
vm.runInContext(ts.transpileModule('globalThis.guard = ' + guard.initializer.getText(ast), {
  compilerOptions: { target: ts.ScriptTarget.ES2022 }
}).outputText, guardContext)
for (const [isComposing, keyCode, expected] of [[true, 13, 1], [false, 229, 1], [false, 13, 0]]) {
  let stops = 0
  guardContext.guard({ isComposing, keyCode, stopPropagation() { stops++ } })
  assert.equal(stops, expected, 'IME keys do not reach native Enter/Escape shortcuts')
}
await board.flush()
ensureOutDir()
writeFileSync(join(outDir, 'board-save-unit.json'), JSON.stringify({ passed: true,
  checks: ['500ms debounce', '2s maximum wait', 'deferred serialization/no-op', 'in-flight edits',
    'save failure/retry', 'navigation flush', 'legacy migration', 'per-board writes', 'case-sensitive IDs',
    'index fault/retry', 'restart/deletion', 'invalid scenes rejected', 'structural sharing',
    'group cycles/singular transforms rejected', 'production IME shortcut guard'] }, null, 2))
console.log('Board save: 15 groups passed')
