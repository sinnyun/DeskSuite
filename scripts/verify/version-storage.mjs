import assert from 'node:assert/strict'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { DatabaseSync, backup } from 'node:sqlite'
import { createHash } from 'node:crypto'
import { resolve, join, dirname } from 'node:path'
import { mcpCall, mcpHandshake, mcpText, mcpRpc, outDir } from './common.mjs'

const path = resolve('artifacts/verify/samples/version-storage/Shot 007.png')
const fixture = resolve('artifacts/verify/samples/version-storage/new.txt')
const expectedFile = join(outDir, 'version-storage-expected.json')
const reportFile = join(outDir, process.argv.includes('--check-restart') ? 'version-storage-restart.json'
  : process.argv.includes('--reconcile-existing') ? 'version-storage-migration.json' : 'version-storage.json')
const report = []
if (process.argv.includes('--prepare')) {
  mkdirSync(dirname(fixture), { recursive: true })
  writeFileSync(fixture, 'Persistent version metadata fixture\n')
  const source = join(process.env.APPDATA, 'desksuite/data')
  const destination = resolve('artifacts/verify/profiles/version-storage/data')
  mkdirSync(destination, { recursive: true })
  const entityId = 'a9115e0b-e7ab-4341-8e7d-4495d403570c'
  const db = new DatabaseSync(join(source, 'desksuite.db'), { readOnly: true })
  await backup(db, join(destination, 'desksuite.db')); db.close()
  cpSync(join(source, 'versions'), join(destination, 'versions'), { recursive: true })
  // Lore records an absolute shared-store location. A copied profile must point
  // at its copied store, otherwise verification would still use the source repository.
  const clonedDb = new DatabaseSync(join(destination, 'desksuite.db'), { readOnly: true })
  const clonedEntities = clonedDb.prepare('SELECT entity_id FROM version_entities').all(); clonedDb.close()
  for (const entry of clonedEntities) {
    const config = join(destination, 'versions/worktrees', entry.entity_id, '.lore/config.toml')
    const copiedStore = join(destination, 'versions/stores', entry.entity_id, 'shared-store').replaceAll('\\', '/')
    writeFileSync(config, readFileSync(config, 'utf8').replace(/^shared_store_path\s*=.*$/m, `shared_store_path = "${copiedStore}"`))
  }
  cpSync(join(source, 'versions/worktrees', entityId, 'content'), path)
  const copied = new DatabaseSync(join(destination, 'desksuite.db'))
  copied.prepare('UPDATE version_entities SET path=?,path_key=? WHERE entity_id=?').run(path, path.toLowerCase(), entityId)
  copied.close()
  process.exit(0)
}
await mcpHandshake()
async function call(name, args = {}) {
  const started = performance.now()
  const result = await mcpCall(name, args)
  report.push({ name, args, elapsedMs: performance.now() - started, result })
  writeFileSync(reportFile, JSON.stringify(report, null, 2))
  if (result.isError) throw new Error(mcpText(result))
  return JSON.parse(mcpText(result))
}
async function job(name, args) {
  const { jobId } = await call(name, args)
  for (let i = 0; i < 240; i++) {
    const status = await call('get_job_status', { jobId })
    if (status.state !== 'running') { assert.equal(status.state, 'done', status.error); return }
    await new Promise(r => setTimeout(r, 150))
  }
  throw new Error('Job timed out')
}
async function projection() {
  return {
    versions: await call('versions_list', { path }),
    graph: await call('versions_branch_graph', { path, includeArchived: true }),
    state: await call('versions_state', { path })
  }
}
async function pureReads() {
  const before = await call('versions_storage_info', { path })
  const projectionBefore = await projection()
  for (let i = 0; i < 12; i++) {
    assert.deepEqual(await projection(), projectionBefore)
  }
  const after = await call('versions_storage_info', { path })
  assert.equal(after.bridgeLaunches, before.bridgeLaunches, 'Read queries must never start Lore')
  return projectionBefore
}
if (process.argv.includes('--reconcile-existing')) {
  const db = new DatabaseSync(join(process.env.APPDATA, 'desksuite/data/desksuite.db'), { readOnly: true })
  const entities = db.prepare('SELECT path FROM version_entities').all(); db.close()
  for (const entity of entities) {
    let before
    try { before = createHash('sha256').update(readFileSync(entity.path)).digest('hex') }
    catch { continue }
    await call('versions_reconcile', { path: entity.path, confirm: true })
    assert.equal(createHash('sha256').update(readFileSync(entity.path)).digest('hex'), before)
  }
  console.log(JSON.stringify({ reconciled: entities.length, reportFile }))
  process.exit(0)
}
if (process.argv.includes('--check-restart')) {
  const info = await call('versions_storage_info', { path })
  assert.equal(info.bridgeLaunches, 0, 'Startup must not query Lore')
  assert.deepEqual(await pureReads(), JSON.parse(readFileSync(expectedFile, 'utf8')))
  console.log('PASS: restart persistence and zero Lore launches')
  process.exit(0)
}
// Reading legacy entries does not implicitly query or migrate Lore.
await pureReads()
await call('versions_reconcile', { path, confirm: true })
if ((await call('versions_state', { path })).status !== 'saved') {
  await job('versions_create', { path, title: '隔离验证起点', confirm: true })
}
let versions = await call('versions_list', { path })
assert.ok(versions.length >= 3)
assert.equal((await call('versions_storage_info', { path })).fingerprintCount, versions.length)
for (const title of ['01', '03', '02']) {
  const version = versions.find(v => v.title === title)
  await job('versions_restore', { path, versionId: version.versionId, confirm: true })
  const result = await pureReads()
  assert.equal(result.state.status, 'saved')
  assert.equal(result.state.currentTitle, title)
  assert.deepEqual(result.versions.filter(v => v.isCurrent).map(v => v.versionId), [version.versionId])
  assert.deepEqual([...new Set(result.graph.branches.flatMap(b => b.revisions.filter(v => v.isCurrent).map(v => v.versionId)))], [version.versionId])
}
if (!(await call('versions_list', { path: fixture })).length) await job('versions_create', { path: fixture, title: '数据库新版本', confirm: true })
assert.equal((await call('versions_state', { path: fixture })).status, 'saved')
const branchName = `metadata-${Date.now()}`
await job('versions_branch_action', { path: fixture, action: 'create', name: branchName, confirm: true })
assert.ok((await call('versions_branch_graph', { path: fixture, includeArchived: true })).branches.some(b => b.name === branchName))
await job('versions_branch_action', { path: fixture, action: 'switch', name: 'main', confirm: true })
const saved = await pureReads()
writeFileSync(expectedFile, JSON.stringify(saved, null, 2))
// Select via DeskSuite MCP so the persisted read model is also rendered.
await call('quick_bookmarks_explorer', { action: 'navigate', path: dirname(path) })
await call('quick_bookmarks_explorer', { action: 'select', paths: [path] })
const tools = await mcpRpc('tools/list', {})
console.log(JSON.stringify({ ok: true, versions: saved.versions.length, state: saved.state, reportFile,
  tabTools: tools.tools.filter(t => /open_tab|open.tab/.test(t.name)).map(t => ({ name: t.name, inputSchema: t.inputSchema })) }, null, 2))
