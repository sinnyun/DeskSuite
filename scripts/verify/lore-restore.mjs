import { DatabaseSync, backup } from 'node:sqlite'
import { cpSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { resolve, join } from 'node:path'
import assert from 'node:assert/strict'
import { mcpHandshake, mcpCall, mcpText, outDir } from './common.mjs'

const original = 'D:\\桌面文件夹\\测试\\Shot 007.png'
const entity = 'a9115e0b-e7ab-4341-8e7d-4495d403570c'
const profile = resolve('artifacts/verify/profiles/lore-restore')
const sample = resolve('artifacts/verify/samples/lore-restore/Shot 007.png')
if (process.argv.includes('--prepare')) {
  mkdirSync(join(profile, 'data'), { recursive: true })
  mkdirSync(resolve(sample, '..'), { recursive: true })
  cpSync(original, sample)
  const source = join(process.env.APPDATA, 'desksuite/data')
  const db = new DatabaseSync(join(source, 'desksuite.db'), { readOnly: true })
  await backup(db, join(profile, 'data/desksuite.db')); db.close()
  cpSync(join(source, 'versions'), join(profile, 'data/versions'), { recursive: true })
  const fixture = new DatabaseSync(join(profile, 'data/desksuite.db'))
  for (const row of fixture.prepare('SELECT entity_id FROM version_entities').all()) {
    const config = join(profile, 'data/versions/worktrees', row.entity_id, '.lore/config.toml')
    const store = join(profile, 'data/versions/stores', row.entity_id, 'shared-store').replaceAll('\\', '/')
    writeFileSync(config, readFileSync(config, 'utf8').replace(/^shared_store_path\s*=.*$/m, `shared_store_path = "${store}"`))
  }
  fixture.prepare('UPDATE version_entities SET path=?,path_key=? WHERE entity_id=?').run(sample, sample.toLowerCase(), entity)
  fixture.close()
  const journal = join(profile, 'data/versions/restore-journals', `${entity}.json`)
  const record = JSON.parse(readFileSync(journal, 'utf8')); record.sourcePath = sample
  writeFileSync(journal, JSON.stringify(record))
  console.log({ profile, sample }); process.exit(0)
}
await mcpHandshake()
const report = []
async function call(name, args = {}) {
  const result = await mcpCall(name, args)
  const text = mcpText(result)
  report.push({ name, args, result })
  writeFileSync(join(outDir, 'lore-restore.json'), JSON.stringify(report, null, 2))
  if (result.isError) throw new Error(text)
  return JSON.parse(text)
}
const path = process.argv.includes('--original') ? original : sample
const before = await call('versions_state', { path })
const versions = await call('versions_list', { path })
async function restore(versionId) {
  const { jobId } = await call('versions_restore', { path, versionId, confirm: true })
  for (let i = 0; i < 120; i++) {
    const job = await call('get_job_status', { jobId })
    if (job.state !== 'running') { assert.equal(job.state, 'done', job.error); return }
    await new Promise(r => setTimeout(r, 250))
  }
  throw new Error('restore timed out')
}
await restore(before.pendingRestore?.versionId ?? versions.find(v => v.title === '02').versionId)
let after = await call('versions_state', { path })
assert.equal(after.status, 'saved'); assert.equal(after.pendingRestore?.pending ?? false, false)
if (!process.argv.includes('--original')) {
  for (const title of ['01', '03', '02']) {
    await restore(versions.find(v => v.title === title).versionId)
    after = await call('versions_state', { path }); assert.equal(after.status, 'saved'); assert.equal(after.currentTitle, title)
    const graph = await call('versions_branch_graph', { path, includeArchived: true })
    const currentIds = [...new Set(graph.branches.flatMap(b => b.revisions.filter(r => r.isCurrent).map(r => r.versionId)))]
    assert.deepEqual(currentIds, [after.currentVersionId])
    assert.equal((await call('versions_list', { path })).filter(v => v.isCurrent)[0].versionId, after.currentVersionId)
  }
  const { jobId } = await call('versions_restore', { path, versionId: 'missing-revision', confirm: true })
  let failed
  for (let i = 0; i < 120; i++) {
    failed = await call('get_job_status', { jobId })
    if (failed.state !== 'running') break
    await new Promise(r => setTimeout(r, 250))
  }
  assert.equal(failed.state, 'failed'); assert.ok(failed.error)
  const audit = await call('get_audit_logs', { limit: 100 })
  assert.ok(audit.some(entry => entry.planId === jobId && entry.error === failed.error))
}
console.log(JSON.stringify({ before, after, report: join(outDir, 'lore-restore.json') }, null, 2))
