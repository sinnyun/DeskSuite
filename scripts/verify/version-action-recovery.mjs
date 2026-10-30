import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import { createHash } from 'node:crypto'
import ts from 'typescript'
import vm from 'node:vm'
import { mcpCall, mcpHandshake, mcpText, outDir, connectCdp } from './common.mjs'

const path = resolve('artifacts/verify/samples/version-action-recovery/Shot 007.png')
if (process.argv.includes('--prepare')) {
  mkdirSync(resolve(path, '..'), { recursive: true })
  cpSync('D:\\桌面文件夹\\测试\\Shot 007.png', path)
  cpSync(path, resolve(path, '../baseline.png'))
  cpSync('D:\\桌面文件夹\\测试\\Shot 006.png', resolve(path, '../second.png'))
  process.exit(0)
}
if (process.argv.includes('--edit-two') || process.argv.includes('--edit-one')) {
  cpSync(resolve(path, process.argv.includes('--edit-two') ? '../second.png' : '../baseline.png'), path)
  process.exit(0)
}
// Exercise the production UI adapter's command-plan protocol without synthesizing DOM events.
const source = readFileSync('src/renderer/src/plugins/data-ops-explorer-versions/version-actions.ts', 'utf8').replace(/^import .*$/m, '')
const js = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS } }).outputText
const steps = []
const module = { exports: {} }
vm.runInNewContext(js, { exports: module.exports, window: { confirm: () => true }, call: async (...args) => {
  steps.push(args)
  if (args[0] === 'versions') return { requiresApproval: true, planId: 'planned-save' }
  if (args[1] === 'execute') return { jobId: 'real-job' }
  return true
} })
assert.equal((await module.exports.mutateVersion('create', [path, ''], '保存？')).jobId, 'real-job')
assert.deepEqual(steps.map(step => step.slice(0, 2)), [['versions', 'create'], ['commands', 'approve'], ['commands', 'execute']])

await mcpHandshake()
const report = []
async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  report.push({ name, args, result })
  writeFileSync(join(outDir, 'version-action-recovery.json'), JSON.stringify(report, null, 2))
  if (result.isError) throw new Error(mcpText(result))
  return JSON.parse(mcpText(result))
}
async function job(name, args) {
  const { jobId } = await call(name, args)
  for (let i = 0; i < 200; i++) {
    const status = await call('get_job_status', { jobId })
    if (status.state !== 'running') return status
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('Timed out')
}
if (process.argv.includes('--seed-one') || process.argv.includes('--seed-two')) {
  const seeded = await job('versions_create', { path, title: process.argv.includes('--seed-one') ? '01' : '02', confirm: true })
  assert.equal(seeded.state, 'done', seeded.error)
  process.exit(0)
}
const originalHash = createHash('sha256').update(readFileSync(path)).digest('hex')
await call('versions_reconcile', { path, confirm: true })
assert.equal((await call('versions_state', { path })).status, 'matches_saved_version')
const versions = await call('versions_list', { path })
const rejected = await job('versions_restore', { path, versionId: versions.find(v => v.title === '01').versionId, confirm: true })
assert.equal(rejected.state, 'failed'); assert.match(rejected.error, /未保存修改/)
assert.equal((await call('versions_state', { path })).synchronizationError, null)
const saved = await job('versions_create', { path, title: '', confirm: true })
assert.equal(saved.state, 'done', saved.error)
const state = await call('versions_state', { path })
assert.equal(state.status, 'saved'); assert.equal(state.synchronizationError, null); assert.match(state.currentTitle, /^版本 \d+$/)
assert.equal(createHash('sha256').update(readFileSync(path)).digest('hex'), originalHash)
await call('quick_bookmarks_explorer', { action: 'navigate', path: resolve(path, '..') })
await call('quick_bookmarks_explorer', { action: 'select', paths: [path] })
await call('command_run', { id: 'ui.open-tab', params: { region: 'right', id: 'versions' } })
const cdp = await connectCdp()
try {
  let ui
  for (let i = 0; i < 40; i++) {
    ui = await cdp.evaluate(`({ saveEnabled: [...document.querySelectorAll('button')].some(b => b.textContent.includes('保存版本') && !b.disabled), syncFailure: document.body.innerText.includes('版本信息同步失败') })`)
    if (ui.saveEnabled && !ui.syncFailure) break
    await new Promise(r => setTimeout(r, 150))
  }
  assert.equal(ui.saveEnabled, true); assert.equal(ui.syncFailure, false)
} finally { cdp.close() }
console.log(JSON.stringify({ ok: true, state, uiPlanSteps: steps.length }))
