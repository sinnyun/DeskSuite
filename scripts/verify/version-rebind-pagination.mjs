import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { join, sep } from 'node:path'
import { DatabaseSync } from 'node:sqlite'
import { ensureOutDir, outDir, projectRoot } from './common.mjs'
import { identity, isInside, normalize, samePath } from '../../src/main/services/paths.ts'
import {
  rebindVersionEntityPaths, VERSION_REBIND_PAGE_SIZE
} from '../../src/main/plugins/data-ops-file-operations/version-rebind.ts'

const ENTITY_COUNT = 1_205
const source = join(projectRoot, 'artifacts', 'verify', 'samples', 'version-rebind-memory', 'source')
const destination = join(projectRoot, 'artifacts', 'verify', 'samples', 'version-rebind-memory', 'destination')
const collidingIndexes = Array.from({ length: 10 }, (_, index) => 428 + index)
const movedPaths = []
const db = new DatabaseSync(':memory:')
const pageStats = { calls: 0, maxRows: 0 }

try {
  db.exec('CREATE TABLE version_entities (entity_id TEXT PRIMARY KEY, path_key TEXT NOT NULL UNIQUE, path TEXT NOT NULL)')
  const insert = db.prepare('INSERT INTO version_entities(entity_id,path_key,path) VALUES(?,?,?)')
  const sourcePaths = [source]
  for (let index = 0; index < ENTITY_COUNT; index += 1) {
    sourcePaths.push(join(source, `folder-${String(index).padStart(4, '0')}`, `file-${index}.txt`))
  }
  const siblingPath = `${source}-sibling${sep}outside.txt`
  const unrelatedPath = join(projectRoot, 'artifacts', 'verify', 'samples', 'version-rebind-memory', 'other-root.txt')
  sourcePaths.forEach((path, index) => insert.run(`source-${index}`, identity(path), path))
  insert.run('sibling', identity(siblingPath), siblingPath)
  insert.run('unrelated', identity(unrelatedPath), unrelatedPath)
  for (const index of collidingIndexes) {
    const target = join(destination, `folder-${String(index).padStart(4, '0')}`, `file-${index}.txt`)
    insert.run(`destination-collision-${index}`, identity(target), target)
  }

  const reader = {
    all(sql, ...params) {
      const rows = db.prepare(sql).all(...params)
      pageStats.calls += 1
      pageStats.maxRows = Math.max(pageStats.maxRows, rows.length)
      assert.match(sql, /ORDER BY path_key DESC LIMIT \?/)
      return rows
    }
  }
  const rebind = (oldPath, newPath) => {
    const oldKey = identity(oldPath)
    const newKey = identity(newPath)
    const current = db.prepare('SELECT entity_id FROM version_entities WHERE path_key=?').get(oldKey)
    if (!current) return undefined
    const target = db.prepare('SELECT entity_id FROM version_entities WHERE path_key=?').get(newKey)
    if (target && target.entity_id !== current.entity_id) throw new Error('目标路径已有独立版本历史，拒绝合并两个历史实体')
    db.prepare('UPDATE version_entities SET path_key=?,path=? WHERE entity_id=?').run(newKey, newPath, current.entity_id)
    movedPaths.push(newPath)
    return { entityId: current.entity_id, pathKey: newKey, path: newPath }
  }

  const result = rebindVersionEntityPaths(
    reader,
    source,
    destination,
    true,
    rebind,
    (error) => error instanceof Error ? error.message : String(error),
    { isInside, normalize, samePath }
  )

  assert.equal(result.attempted, ENTITY_COUNT + 1, 'source root and every descendant should be considered')
  assert.equal(result.failed, collidingIndexes.length, 'target paths with distinct entities must remain per-path warnings')
  assert.equal(result.warningSamples.length, 8, 'warning details must be capped at eight samples')
  assert.equal(movedPaths.length, result.attempted - result.failed, 'all non-colliding source entities should be rebound')
  assert.match(result.warningSamples[0], /拒绝合并两个历史实体/)
  assert.ok(pageStats.calls >= Math.ceil((ENTITY_COUNT + 3 + collidingIndexes.length) / VERSION_REBIND_PAGE_SIZE), 'query must traverse multiple keyset pages')
  assert.ok(pageStats.maxRows <= VERSION_REBIND_PAGE_SIZE, `page materialized ${pageStats.maxRows} rows`)
  assert.equal(db.prepare('SELECT COUNT(*) AS count FROM version_entities').get().count, ENTITY_COUNT + 3 + collidingIndexes.length)
  for (const index of collidingIndexes) {
    assert.equal(db.prepare('SELECT path FROM version_entities WHERE entity_id=?').get(`source-${index + 1}`).path,
      sourcePaths[index + 1], `failed target collision ${index} must leave its entity at its original path`)
  }
  assert.equal(db.prepare('SELECT path FROM version_entities WHERE entity_id=?').get('sibling').path, siblingPath,
    'similarly prefixed sibling must remain out of the moved directory')
  assert.equal(db.prepare('SELECT path FROM version_entities WHERE entity_id=?').get('unrelated').path, unrelatedPath,
    'unrelated root must remain untouched')
  assert.equal(db.prepare('SELECT path FROM version_entities WHERE entity_id=?').get('source-0').path, destination,
    'exact source entity must bind to exact destination')
  assert.ok(movedPaths.every((path) => path === destination || isInside(destination, path)))

  const reportPath = join(ensureOutDir(), 'version-rebind-pagination.json')
  const report = {
    status: 'passed', mode: 'in-memory SQLite production-helper verification',
    sourceRows: ENTITY_COUNT + 1, pageSize: VERSION_REBIND_PAGE_SIZE,
    pageQueries: pageStats.calls, maxRowsPerQuery: pageStats.maxRows,
    attempted: result.attempted, rebound: movedPaths.length, failed: result.failed, preservedSibling: siblingPath,
    preservedUnrelated: unrelatedPath, collisionWarningSamples: result.warningSamples,
    createdAt: new Date().toISOString(),
    note: 'This does not verify the MCP approval dialog or the application-level file_move flow.'
  }
  await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8')
  console.log(`version rebind pagination helper OK; report: ${reportPath}`)
} finally {
  db.close()
}
