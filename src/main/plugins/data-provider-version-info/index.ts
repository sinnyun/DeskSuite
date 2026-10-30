import { randomUUID } from 'node:crypto'
import type { Context, Plugin } from 'cordis'
import type { SQLOutputValue } from 'node:sqlite'
import { identity, normalize } from '../../services/paths'

export interface VersionEntity {
  entityId: string
  pathKey: string
  path: string
}

export interface VersionRecord {
  entityId: string
  versionId: string
  revisionNumber: number
  parentRevisionIds: string[]
  title: string
  createdAt: string
  sizeBytes: number
  contentType: string | null
  thumbnailPath: string | null
  isCurrent: boolean
}

export interface VersionBranchPoint {
  branchId: string
  revisionId: string
}

export interface VersionBranch {
  branchId: string
  name: string
  category: string
  headRevisionId: string | null
  isCurrent: boolean
  isArchived: boolean
  createdAtUnix: number
  stack: VersionBranchPoint[]
  revisions: VersionRecord[]
}

export interface PendingVersionMerge {
  sourceBranch: string
  targetBranch: string
  conflictFiles: string[]
  targetBaseRevisionId: string
}

export interface VersionGraph {
  branches: VersionBranch[]
  graphState: string
  pendingMerge: PendingVersionMerge | null
}

export interface VersionInfoService {
  entities(): VersionEntity[]
  snapshot(entityId: string): VersionSnapshot
  putSnapshot(entityId: string, snapshot: VersionSnapshot): void
  getOrCreateEntity(path: string): VersionEntity
  getEntityByPath(path: string): VersionEntity | null
  rebindPath(oldPath: string, newPath: string): VersionEntity | undefined
  list(entityId: string): VersionRecord[]
  save(record: VersionRecord): void
  setCurrent(entityId: string, versionId: string): void
  graph(entityId: string): VersionGraph
  putGraph(entityId: string, graph: VersionGraph): void
}

export interface VersionSnapshot {
  state: Record<string, unknown>
  fingerprints: Record<string, string>
  synchronizedAt: number | null
  operation: string | null
  error: string | null
}

declare module 'cordis' {
  interface Context {
    versionInfo: VersionInfoService
  }
}

type SqlValue = SQLOutputValue
interface EntityRow extends Record<string, SqlValue> {
  entity_id: string
  path_key: string
  path: string
}
interface VersionRow extends Record<string, SqlValue> {
  entity_id: string
  version_id: string
  revision_number: number
  parents_json: string
  title: string
  created_at: string
  size_bytes: number
  content_type: string | null
  thumbnail_path: string | null
  is_current: number
}
interface GraphRow extends Record<string, SqlValue> {
  graph_state: string
  branches_json: string
  pending_merge_json: string | null
}

const PLUGIN_ID = 'data-provider-version-info'
const MIGRATIONS = [{
  id: 'initial-schema',
  version: 1,
  sql: `
    CREATE TABLE version_entities (
      entity_id TEXT PRIMARY KEY,
      path_key TEXT NOT NULL UNIQUE,
      path TEXT NOT NULL,
      created_at INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );

    CREATE TABLE versions (
      entity_id TEXT NOT NULL REFERENCES version_entities(entity_id) ON DELETE CASCADE,
      version_id TEXT NOT NULL,
      revision_number INTEGER NOT NULL CHECK (revision_number >= 0),
      parents_json TEXT NOT NULL,
      title TEXT NOT NULL,
      created_at TEXT NOT NULL,
      size_bytes INTEGER NOT NULL CHECK (size_bytes >= 0),
      content_type TEXT,
      thumbnail_path TEXT,
      is_current INTEGER NOT NULL DEFAULT 0 CHECK (is_current IN (0, 1)),
      PRIMARY KEY (entity_id, version_id)
    ) WITHOUT ROWID;
    CREATE INDEX versions_entity_revision_idx
      ON versions(entity_id, revision_number DESC, created_at DESC);
    CREATE UNIQUE INDEX versions_one_current_idx
      ON versions(entity_id) WHERE is_current = 1;

    CREATE TABLE version_graph (
      entity_id TEXT PRIMARY KEY REFERENCES version_entities(entity_id) ON DELETE CASCADE,
      graph_state TEXT NOT NULL,
      branches_json TEXT NOT NULL,
      pending_merge_json TEXT,
      updated_at INTEGER NOT NULL
    ) WITHOUT ROWID;
  `
}, {
  id: 'durable-read-model', version: 2,
  sql: `CREATE TABLE version_snapshots (
    entity_id TEXT PRIMARY KEY REFERENCES version_entities(entity_id) ON DELETE CASCADE,
    snapshot_json TEXT NOT NULL,
    updated_at INTEGER NOT NULL
  ) WITHOUT ROWID;`
}]

function pathPair(rawPath: string): { path: string; pathKey: string } {
  if (!rawPath.trim()) throw new TypeError('版本路径不能为空')
  const path = normalize(rawPath)
  return { path, pathKey: identity(path) }
}

function toEntity(row: EntityRow): VersionEntity {
  return { entityId: row.entity_id, pathKey: row.path_key, path: row.path }
}

function toRecord(row: VersionRow): VersionRecord {
  const parentRevisionIds: unknown = JSON.parse(row.parents_json)
  if (!Array.isArray(parentRevisionIds) || parentRevisionIds.some((id) => typeof id !== 'string')) {
    throw new Error(`版本 ${row.version_id} 的父版本元数据无效`)
  }
  return {
    entityId: row.entity_id,
    versionId: row.version_id,
    revisionNumber: row.revision_number,
    parentRevisionIds,
    title: row.title,
    createdAt: row.created_at,
    sizeBytes: row.size_bytes,
    contentType: row.content_type,
    thumbnailPath: row.thumbnail_path,
    isCurrent: row.is_current === 1
  }
}

function requireEntity(db: Context['db'], entityId: string): void {
  if (!entityId.trim()) throw new TypeError('版本 entityId 不能为空')
  const row = db.get<{ entity_id: string }>(
    'SELECT entity_id FROM version_entities WHERE entity_id = ?', entityId
  )
  if (!row) throw new Error(`版本实体不存在：${entityId}`)
}

function validateRecord(record: VersionRecord): void {
  if (!record.entityId || !record.versionId || !record.title.trim()) {
    throw new TypeError('版本实体、版本 ID 和标题不能为空')
  }
  if (!Number.isSafeInteger(record.revisionNumber) || record.revisionNumber < 0) {
    throw new TypeError('版本序号必须是非负安全整数')
  }
  if (!Number.isSafeInteger(record.sizeBytes) || record.sizeBytes < 0) {
    throw new TypeError('版本文件大小必须是非负安全整数')
  }
  if (record.title.length > 240 || /[\u0000-\u001f\u007f]/u.test(record.title)) {
    throw new TypeError('版本标题最多 240 个字符且不能包含控制字符')
  }
  if (!Array.isArray(record.parentRevisionIds) || record.parentRevisionIds.some((id) => typeof id !== 'string')) {
    throw new TypeError('父版本列表格式无效')
  }
  if (!record.createdAt || !Number.isFinite(Date.parse(record.createdAt))) {
    throw new TypeError('版本创建时间必须是有效时间')
  }
}

function validateGraph(entityId: string, graph: VersionGraph): void {
  if (!graph || typeof graph.graphState !== 'string' || !Array.isArray(graph.branches)) {
    throw new TypeError('版本分支图格式无效')
  }
  for (const branch of graph.branches) {
    if (!branch.branchId || !branch.name || !Array.isArray(branch.stack) || !Array.isArray(branch.revisions)) {
      throw new TypeError('版本分支记录格式无效')
    }
    for (const record of branch.revisions) {
      if (record.entityId !== entityId) throw new TypeError('分支图不能包含其他文件的版本')
      validateRecord(record)
    }
  }
  const pending = graph.pendingMerge
  if (pending && (!pending.sourceBranch || !pending.targetBranch || !Array.isArray(pending.conflictFiles) || !pending.targetBaseRevisionId)) {
    throw new TypeError('待解决合并记录格式无效')
  }
}

const versionInfoPlugin: Plugin = {
  name: PLUGIN_ID,
  inject: ['db'],
  apply(context: Context): void {
    context.db.migrate(PLUGIN_ID, MIGRATIONS)

    const entityByPath = (path: string): VersionEntity | null => {
      const pair = pathPair(path)
      const row = context.db.get<EntityRow>(
        'SELECT entity_id, path_key, path FROM version_entities WHERE path_key = ?', pair.pathKey
      )
      return row ? toEntity(row) : null
    }

    const service: VersionInfoService = {
      entities: () => context.db.all<EntityRow>('SELECT entity_id, path_key, path FROM version_entities').map(toEntity),
      snapshot(entityId) {
        requireEntity(context.db, entityId)
        const row = context.db.get<{ snapshot_json: string }>('SELECT snapshot_json FROM version_snapshots WHERE entity_id = ?', entityId)
        return row ? JSON.parse(row.snapshot_json) as VersionSnapshot : {
          state: { status: 'unknown' }, fingerprints: {}, synchronizedAt: null, operation: null, error: null
        }
      },
      putSnapshot(entityId, snapshot) {
        requireEntity(context.db, entityId)
        context.db.run(`INSERT INTO version_snapshots(entity_id, snapshot_json, updated_at) VALUES (?, ?, ?)
          ON CONFLICT(entity_id) DO UPDATE SET snapshot_json=excluded.snapshot_json, updated_at=excluded.updated_at`,
        entityId, JSON.stringify(snapshot), Date.now())
      },
      getOrCreateEntity(path) {
        const pair = pathPair(path)
        return context.db.tx(() => {
          const found = context.db.get<EntityRow>(
            'SELECT entity_id, path_key, path FROM version_entities WHERE path_key = ?', pair.pathKey
          )
          if (found) {
            if (found.path !== pair.path) {
              context.db.run('UPDATE version_entities SET path = ?, updated_at = ? WHERE entity_id = ?', pair.path, Date.now(), found.entity_id)
              return { entityId: found.entity_id, pathKey: pair.pathKey, path: pair.path }
            }
            return toEntity(found)
          }
          const entity: VersionEntity = { entityId: randomUUID(), pathKey: pair.pathKey, path: pair.path }
          const now = Date.now()
          context.db.run(
            'INSERT INTO version_entities(entity_id, path_key, path, created_at, updated_at) VALUES (?, ?, ?, ?, ?)',
            entity.entityId, entity.pathKey, entity.path, now, now
          )
          return entity
        })
      },

      getEntityByPath: entityByPath,

      rebindPath(oldPath, newPath) {
        const oldPair = pathPair(oldPath)
        const nextPair = pathPair(newPath)
        if (oldPair.pathKey === nextPair.pathKey) {
          return entityByPath(oldPair.path)
            ? service.getOrCreateEntity(nextPair.path)
            : undefined
        }
        return context.db.tx(() => {
          const existing = context.db.get<EntityRow>(
            'SELECT entity_id, path_key, path FROM version_entities WHERE path_key = ?', oldPair.pathKey
          )
          if (!existing) return undefined
          const target = context.db.get<{ entity_id: string }>(
            'SELECT entity_id FROM version_entities WHERE path_key = ?', nextPair.pathKey
          )
          if (target && target.entity_id !== existing.entity_id) {
            throw new Error('目标路径已有独立版本历史，拒绝合并两个历史实体')
          }
          context.db.run(
            'UPDATE version_entities SET path_key = ?, path = ?, updated_at = ? WHERE entity_id = ?',
            nextPair.pathKey, nextPair.path, Date.now(), existing.entity_id
          )
          return { entityId: existing.entity_id, pathKey: nextPair.pathKey, path: nextPair.path }
        })
      },

      list(entityId) {
        requireEntity(context.db, entityId)
        return context.db.all<VersionRow>(
          `SELECT entity_id, version_id, revision_number, parents_json, title, created_at,
                  size_bytes, content_type, thumbnail_path, is_current
             FROM versions WHERE entity_id = ?
             ORDER BY revision_number DESC, created_at DESC, version_id`,
          entityId
        ).map(toRecord)
      },

      save(record) {
        validateRecord(record)
        context.db.tx(() => {
          requireEntity(context.db, record.entityId)
          if (record.isCurrent) {
            context.db.run('UPDATE versions SET is_current = 0 WHERE entity_id = ?', record.entityId)
          }
          context.db.run(
            `INSERT INTO versions(entity_id, version_id, revision_number, parents_json, title, created_at,
                                  size_bytes, content_type, thumbnail_path, is_current)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(entity_id, version_id) DO UPDATE SET
               revision_number = excluded.revision_number,
               parents_json = excluded.parents_json,
               title = excluded.title,
               created_at = excluded.created_at,
               size_bytes = excluded.size_bytes,
               content_type = excluded.content_type,
               thumbnail_path = excluded.thumbnail_path,
               is_current = excluded.is_current`,
            record.entityId,
            record.versionId,
            record.revisionNumber,
            JSON.stringify(record.parentRevisionIds),
            record.title,
            record.createdAt,
            record.sizeBytes,
            record.contentType,
            record.thumbnailPath,
            record.isCurrent ? 1 : 0
          )
        })
      },

      setCurrent(entityId, versionId) {
        context.db.tx(() => {
          requireEntity(context.db, entityId)
          const version = context.db.get<{ version_id: string }>(
            'SELECT version_id FROM versions WHERE entity_id = ? AND version_id = ?', entityId, versionId
          )
          if (!version) throw new Error(`版本不存在：${versionId}`)
          context.db.run('UPDATE versions SET is_current = 0 WHERE entity_id = ?', entityId)
          context.db.run('UPDATE versions SET is_current = 1 WHERE entity_id = ? AND version_id = ?', entityId, versionId)
        })
      },

      graph(entityId) {
        requireEntity(context.db, entityId)
        const row = context.db.get<GraphRow>(
          'SELECT graph_state, branches_json, pending_merge_json FROM version_graph WHERE entity_id = ?', entityId
        )
        if (!row) return { branches: [], graphState: 'empty', pendingMerge: null }
        const branches: unknown = JSON.parse(row.branches_json)
        const pendingMerge: unknown = row.pending_merge_json === null ? null : JSON.parse(row.pending_merge_json)
        if (!Array.isArray(branches)) throw new Error(`文件 ${entityId} 的版本分支图损坏`)
        return { branches: branches as VersionBranch[], graphState: row.graph_state, pendingMerge: pendingMerge as PendingVersionMerge | null }
      },

      putGraph(entityId, graph) {
        validateGraph(entityId, graph)
        requireEntity(context.db, entityId)
        context.db.run(
          `INSERT INTO version_graph(entity_id, graph_state, branches_json, pending_merge_json, updated_at)
           VALUES (?, ?, ?, ?, ?)
           ON CONFLICT(entity_id) DO UPDATE SET graph_state = excluded.graph_state,
             branches_json = excluded.branches_json, pending_merge_json = excluded.pending_merge_json,
             updated_at = excluded.updated_at`,
          entityId,
          graph.graphState,
          JSON.stringify(graph.branches),
          graph.pendingMerge === null ? null : JSON.stringify(graph.pendingMerge),
          Date.now()
        )
      }
    }

    context.reflect.provide('versionInfo', service)
  }
}

export default versionInfoPlugin
