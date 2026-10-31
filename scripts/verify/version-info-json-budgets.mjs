import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ensureOutDir } from './common.mjs'
import {
  assertVersionListBudget, parseGraphJson, parseParentsJson, parseSnapshotJson, serializeGraph,
  serializeParentsJson, serializeSnapshot, VERSION_JSON_LIMITS
} from '../../src/main/plugins/data-provider-version-info/codec.ts'

const entityId = 'entity-001'
const baseSnapshot = { state: { status: 'ok' }, fingerprints: {}, synchronizedAt: null, operation: null, error: null }
const baseGraph = { branches: [], graphState: 'empty', pendingMerge: null }
const checks = []
function check(name, run) { run(); checks.push(name) }

check('snapshot JSON round-trip and schema validation', () => {
  const encoded = serializeSnapshot(baseSnapshot)
  assert.deepEqual(parseSnapshotJson(encoded), baseSnapshot)
  assert.throws(() => serializeSnapshot({ ...baseSnapshot, extra: true }))
})

check('snapshot write/read byte and entry budgets', () => {
  const largeSnapshot = { ...baseSnapshot, state: { detail: '界'.repeat(Math.ceil(VERSION_JSON_LIMITS.snapshotBytes / 3)) } }
  assert.throws(() => serializeSnapshot(largeSnapshot), /8388608/)
  const manyState = Object.fromEntries(Array.from({ length: VERSION_JSON_LIMITS.snapshotStateEntries + 1 }, (_, i) => [`k${i}`, null]))
  assert.throws(() => serializeSnapshot({ ...baseSnapshot, state: manyState }), /条目超限/)
})

check('parent revision JSON byte budget', () => {
  const validParents = ['rev-a', 'rev-b']
  assert.deepEqual(parseParentsJson(serializeParentsJson(validParents)), validParents)
  const oversizedParents = Array.from({ length: 600 }, (_, i) => `${i}-${'x'.repeat(505)}`)
  assert.ok(oversizedParents.every((value) => value.length <= 512))
  assert.throws(() => serializeParentsJson(oversizedParents), /262144/)
})

check('graph cumulative revision and stack counts', () => {
  const record = {
    entityId, versionId: 'v', revisionNumber: 1, parentRevisionIds: [], title: 'v',
    createdAt: '2026-01-01T00:00:00.000Z', sizeBytes: 1, contentType: null, thumbnailPath: null, isCurrent: false
  }
  const branches = Array.from({ length: 6 }, (_, branch) => ({
    branchId: `b${branch}`, name: `Branch ${branch}`, category: '', headRevisionId: null,
    isCurrent: false, isArchived: false, createdAtUnix: 1, stack: [],
    revisions: Array.from({ length: 8_500 }, () => record)
  }))
  assert.throws(() => serializeGraph({ branches, graphState: 'ready', pendingMerge: null }), /版本总数超限/)
  const stackBranches = Array.from({ length: 2 }, (_, branch) => ({
    branchId: `b${branch}`, name: `Branch ${branch}`, category: '', headRevisionId: null,
    isCurrent: false, isArchived: false, createdAtUnix: 1,
    stack: Array.from({ length: 10_000 }, (_, i) => ({ branchId: 'x'.repeat(512), revisionId: `${i}-${'y'.repeat(506)}` })),
    revisions: []
  }))
  assert.throws(() => serializeGraph({ branches: stackBranches, graphState: 'ready', pendingMerge: null }), /堆栈点总数超限|16 MiB/)
})

check('graph read JSON byte budget and decoder', () => {
  const empty = serializeGraph(baseGraph)
  assert.deepEqual(parseGraphJson(empty.graphState, empty.branchesJson, empty.pendingMergeJson), baseGraph)
  assert.throws(() => parseGraphJson('ready', `[${' '.repeat(VERSION_JSON_LIMITS.graphBytes)}]`, null), /16 MiB/)
  assert.throws(() => parseGraphJson('ready', '[]', JSON.stringify({
    sourceBranch: 's', targetBranch: 't', targetBaseRevisionId: 'r', conflictFiles: ['x'.repeat(VERSION_JSON_LIMITS.pendingMergeBytes)]
  })), /2 MiB/)
})

check('list preflight SQL totals every variable text column before detail materialization', () => {
  const db = new DatabaseSync(':memory:')
  try {
    db.exec(`CREATE TABLE versions (
      entity_id TEXT, version_id TEXT, parents_json TEXT, title TEXT, created_at TEXT,
      content_type TEXT, thumbnail_path TEXT
    )`)
    db.prepare('INSERT INTO versions VALUES (?, ?, ?, ?, ?, ?, ?)').run(entityId, '版本-1', '["父"]', '标题', '2026-01-01T00:00:00.000Z', null, 'C:/缩略图.png')
    const budget = db.prepare(`SELECT COUNT(*) AS version_count,
      COALESCE(SUM(
        length(CAST(entity_id AS BLOB)) + length(CAST(version_id AS BLOB)) +
        length(CAST(parents_json AS BLOB)) + length(CAST(title AS BLOB)) +
        length(CAST(created_at AS BLOB)) + COALESCE(length(CAST(content_type AS BLOB)), 0) +
        COALESCE(length(CAST(thumbnail_path AS BLOB)), 0)
      ), 0) AS text_bytes FROM versions WHERE entity_id = ?`).get(entityId)
    const expectedBytes = ['entity-001', '版本-1', '["父"]', '标题', '2026-01-01T00:00:00.000Z', 'C:/缩略图.png']
      .reduce((sum, value) => sum + Buffer.byteLength(value, 'utf8'), 0)
    assert.equal(budget.version_count, 1)
    assert.equal(budget.text_bytes, expectedBytes)
    assertVersionListBudget(budget.version_count, budget.text_bytes, entityId)
  } finally { db.close() }
})

check('full list row and aggregate text budgets fail closed', () => {
  assertVersionListBudget(VERSION_JSON_LIMITS.versionsPerEntity, VERSION_JSON_LIMITS.versionListTextBytes, entityId)
  assert.throws(() => assertVersionListBudget(VERSION_JSON_LIMITS.versionsPerEntity + 1, 0, entityId), /50000 条记录/)
  assert.throws(() => assertVersionListBudget(1, VERSION_JSON_LIMITS.versionListTextBytes + 1, entityId), /64 MiB 总量上限/)
})

const output = join(ensureOutDir(), 'version-info-json-budgets.json')
writeFileSync(output, `${JSON.stringify({ status: 'passed', checks, capturedAt: new Date().toISOString() }, null, 2)}\n`)
console.log('Version info SQLite JSON budgets OK')
console.log(`Report: ${output}`)
