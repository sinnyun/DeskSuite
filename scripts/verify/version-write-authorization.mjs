import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { rolldown } from 'rolldown'
import { ensureOutDir, outDir, projectRoot } from './common.mjs'

const work = mkdtempSync(join(ensureOutDir(), 'version-write-auth-'))
const bundleFile = join(work, 'write-access.mjs')
const build = await rolldown({
  input: join(projectRoot, 'src/main/plugins/data-ops-versions/write-access.ts'),
  platform: 'node'
})
await build.write({ file: bundleFile, format: 'esm' })
await build.close()
const { assertUiWritable } = await import(pathToFileURL(bundleFile).href)
const rootA = join(work, 'root-a')
const rootB = join(work, 'root-b')
const userData = join(work, 'user-data')
for (const directory of [rootA, rootB, userData]) mkdirSync(directory, { recursive: true })
for (const directory of [rootA, rootB]) {
  const target = join(directory, 'photo.jpg')
  writeFileSync(target, 'x')
  await assertUiWritable(target, [userData])
}
const forbiddenTarget = join(userData, 'journal.bin')
writeFileSync(forbiddenTarget, 'x')
await assert.rejects(assertUiWritable(forbiddenTarget, [userData]), error => error.code === 'forbidden-path')
rmSync(work, { recursive: true, force: true })
console.log('PASS: local writes use target scope without MCP roots; userData remains forbidden')

// Verify real renderer cancellation protocol without browser state mutations.
const ts = (await import('typescript')).default
const vm = await import('node:vm')
const adapter = readFileSync(join(projectRoot, 'src/renderer/src/plugins/data-ops-explorer-versions/version-actions.ts'), 'utf8').replace(/^import .*$/m, '')
const adapterModule = { exports: {} }
const calls = []
vm.runInNewContext(ts.transpileModule(adapter, { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 } }).outputText, {
  exports: adapterModule.exports,
  window: { confirm: () => false },
  call: async (...args) => {
    calls.push(args)
    return args[0] === 'versions' ? { requiresApproval: true, planId: 'cancel-test' } : true
  }
})
await assert.rejects(adapterModule.exports.mutateVersion('branchAction', [], 'confirm'),
  error => error instanceof adapterModule.exports.VersionActionCancelled)
assert.deepEqual(calls, [['versions', 'branchAction'], ['commands', 'approve', 'cancel-test', false]])
console.log('PASS: cancel rejects the plan without executing it and has a distinct cancellation type')

if (process.argv.includes('--live')) {
  const { mcpCall, mcpText, mcpHandshake } = await import('./common.mjs')
  await mcpHandshake()
  const report = []
  async function call(name, args = {}, reject = false) {
    const result = await mcpCall(name, args)
    report.push({ name, args, result })
    writeFileSync(join(outDir, 'version-write-authorization.json'), JSON.stringify(report, null, 2))
    if (!reject) assert.ok(!result.isError, mcpText(result))
    return reject ? result : JSON.parse(mcpText(result))
  }
  async function job(name, args) {
    const { jobId } = await call(name, args)
    for (let i = 0; i < 200; i++) {
      const status = await call('get_job_status', { jobId })
      if (status.state !== 'running') { assert.equal(status.state, 'done', status.error); return }
      await new Promise(r => setTimeout(r, 150))
    }
    throw new Error('Job timeout')
  }
  const sample = join(projectRoot, `artifacts/verify/samples/version-write-authorization-${Date.now()}`)
  mkdirSync(sample, { recursive: true })
  const target = join(sample, 'local.txt')
  writeFileSync(target, 'version one')
  await job('versions_create', { path: target, title: 'one', confirm: true })
  const [version] = await call('versions_list', { path: target })
  writeFileSync(target, 'version two')
  await job('versions_create', { path: target, title: 'two', confirm: true })
  await job('versions_restore', { path: target, versionId: version.versionId, confirm: true })
  assert.equal(readFileSync(target, 'utf8'), 'version one')
  await job('versions_branch_action', { path: target, action: 'create', name: 'test', confirm: true })
  await job('versions_branch_action', { path: target, action: 'switch', name: 'main', confirm: true })
  // Fixture outside the only permitted MCP write root, still inside verify artifacts.
  const outside = join(work, 'outside.txt')
  mkdirSync(work, { recursive: true })
  writeFileSync(outside, 'outside root')
  for (const [id, args] of [
    ['ipc.versions.restore', [outside, 'missing-version', true]],
    ['ipc.versions.branch.action', [outside, { action: 'switch', name: 'main' }, true]]
  ]) {
    const result = await call('command_run', { id, params: { args } }, true)
    assert.equal(result.isError, true)
    assert.match(mcpText(result), /可写根目录/)
  }
  await call('quick_bookmarks_explorer', { action: 'navigate', path: sample })
  await call('quick_bookmarks_explorer', { action: 'select', paths: [target] })
  await call('command_run', { id: 'ui.open-tab', params: { region: 'right', id: 'versions' } })
  rmSync(work, { recursive: true, force: true })
  console.log('PASS: live restore, branch switch and MCP IPC root enforcement')
}
