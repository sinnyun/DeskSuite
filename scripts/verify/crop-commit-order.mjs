// Exercise the production handlers with Leafer's documented UP -> DOUBLE_TAP
// ordering, without dispatching UI events or operating an application window.
import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import vm from 'node:vm'
import ts from 'typescript'
import { ensureOutDir, outDir, projectRoot } from './common.mjs'
import { join } from 'node:path'

const path = join(projectRoot, 'src/renderer/src/plugins/canvas-ops-whiteboard/engine.ts')
const source = await readFile(path, 'utf8')
const ast = ts.createSourceFile(path, source, ts.ScriptTarget.Latest, true)
const engine = ast.statements.find(n => ts.isClassDeclaration(n) && n.name.text === 'BoardEngine')
const constructor = engine.members.find(ts.isConstructorDeclaration)
const handlers = constructor.body.statements.filter(n =>
  /this\.app\.(?:editor\.)?on\((?:ClipResizeEditorEvent\.END|PointerEvent\.UP|DragEvent\.END),/.test(n.getText(ast)))
assert.equal(handlers.length, 3)
const methods = engine.members.filter(n => ts.isMethodDeclaration(n) &&
  ['layerState', 'clipData', 'prepareClipCommit', 'finishClip', 'scheduleTransformCommit', 'commitTransforms'].includes(n.name.getText(ast)))
const code = `class BoardEngine { constructor() { const board = this.board; ${handlers.map(n => n.getText(ast)).join('\n')} }
${methods.map(n => n.getText(ast)).join('\n')} }; globalThis.Engine = BoardEngine;`
class ClipImage {}
const context = vm.createContext({
  queueMicrotask, ClipImage,
  ClipResizeEditorEvent: { END: 'end' }, PointerEvent: { UP: 'up' }, DragEvent: { END: 'drag-end' }
})
// Install handlers against controlled runtime objects, retaining actual engine methods.
vm.runInContext(ts.transpileModule(code, { compilerOptions: { target: ts.ScriptTarget.ES2022 } }).outputText, context)
const checks = []
for (const queuedBeforeClose of [false, true]) {
  const events = new Map()
  const ui = Object.assign(new ClipImage(), {
    x: 35, y: 45, width: 271, height: 192, rotation: 0, scaleX: 1, scaleY: 1,
    layerImg: { x: -20, y: -30, width: 480, height: 339, rotation: 0, scaleX: 1, scaleY: 1 }
  })
  const node = { id: 'image', type: 'image', x: 0, y: 0, width: 480, height: 339, rotation: 0, scaleX: 1, scaleY: 1 }
  const nodes = new Map([['image', ui]])
  const state = { id: 'board', scene: { nodes: [node] } }
  let transactions = 0
  const board = {
    getSnapshot: () => state, setCropEditing: () => {},
    edit(fn) {
      fn(state.scene)
      transactions++
      // Model sync(): a transaction replaces the node before URL decoding.
      nodes.set('image', Object.assign(new ClipImage(), ui, {
        layerImg: { x: 0, y: 0, width: 100, height: 100, rotation: 0, scaleX: 1, scaleY: 1 }
      }))
    }
  }
  const app = { editor: { innerEditing: true, on: (name, fn) => events.set(name, fn) }, on: (name, fn) => events.set(name, fn) }
  context.Engine.prototype.app = app
  context.Engine.prototype.board = board
  const instance = new context.Engine()
  Object.assign(instance, { nodes, clipEditing: 'image', pendingClipCommits: 0, suppressClipCommit: false })
  if (queuedBeforeClose) queueMicrotask(() => instance.commitTransforms())
  events.get('up')()
  app.editor.innerEditing = false
  events.get('end')()
  events.get('drag-end')()
  await new Promise(resolve => setImmediate(resolve))
  assert.equal(node.clip?.width, 480, 'crop captured default 100px image after an early frame-only save')
  assert.equal(node.clip?.height, 339)
  assert.equal(transactions, 1, 'crop must be one atomic history transaction')
  assert.equal(instance.pendingClipCommits, 0)
  checks.push(queuedBeforeClose ? 'already queued transform cannot interrupt crop commit' : 'UP then double-tap close preserves full child transform')
}
ensureOutDir()
await writeFile(join(outDir, 'crop-commit-order.json'), JSON.stringify({ passed: true, checks }, null, 2))
console.log(JSON.stringify({ passed: true, checks }, null, 2))
