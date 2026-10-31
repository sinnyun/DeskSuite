import { app } from 'electron'
import type { Context, Plugin } from 'cordis'
import { DatabaseSync } from 'node:sqlite'
import type { SQLInputValue, SQLOutputValue, StatementResultingChanges } from 'node:sqlite'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'

export interface CatalogMigration {
  /** Stable identifier unique within its plugin namespace. */
  id: string
  /** Positive schema version. PRAGMA user_version tracks the highest applied version. */
  version: number
  /** SQL statements executed atomically as one migration. */
  sql: string
}

export interface CatalogDatabase {
  query<T extends Record<string, SQLOutputValue> = Record<string, SQLOutputValue>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[]
  all<T extends Record<string, SQLOutputValue> = Record<string, SQLOutputValue>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T[]
  get<T extends Record<string, SQLOutputValue> = Record<string, SQLOutputValue>>(
    sql: string,
    ...params: SQLInputValue[]
  ): T | undefined
  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges
  tx<T>(work: (database: CatalogDatabase) => T): T
  migrate(owner: string, migrations: CatalogMigration[]): void
}

declare module 'cordis' {
  interface Context {
    db: CatalogDatabase
  }
}

const BASE_SCHEMA: CatalogMigration[] = [
  {
    id: 'initial-tables',
    version: 1,
    sql: `
      CREATE TABLE IF NOT EXISTS meta (
        path_key TEXT PRIMARY KEY,
        path TEXT NOT NULL,
        favorite INTEGER NOT NULL DEFAULT 0 CHECK (favorite IN (0, 1)),
        rating INTEGER NOT NULL DEFAULT 0 CHECK (rating BETWEEN 0 AND 5),
        note TEXT NOT NULL DEFAULT '',
        updated_at INTEGER NOT NULL
      );

      CREATE TABLE IF NOT EXISTS tags (
        id INTEGER PRIMARY KEY,
        name TEXT NOT NULL,
        parent_id INTEGER REFERENCES tags(id) ON DELETE SET NULL,
        color TEXT,
        sort INTEGER NOT NULL DEFAULT 0,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS tags_parent_sort_idx ON tags(parent_id, sort, id);

      CREATE TABLE IF NOT EXISTS file_tags (
        path_key TEXT NOT NULL,
        tag_id INTEGER NOT NULL REFERENCES tags(id) ON DELETE CASCADE,
        PRIMARY KEY (path_key, tag_id)
      ) WITHOUT ROWID;
      CREATE INDEX IF NOT EXISTS file_tags_tag_idx ON file_tags(tag_id, path_key);

      CREATE TABLE IF NOT EXISTS folders (
        path_key TEXT PRIMARY KEY,
        path TEXT NOT NULL UNIQUE,
        parent_key TEXT REFERENCES folders(path_key) ON UPDATE CASCADE ON DELETE CASCADE,
        name TEXT NOT NULL,
        mtime_ms REAL NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS folders_parent_name_idx ON folders(parent_key, name COLLATE NOCASE);

      CREATE TABLE IF NOT EXISTS files (
        id INTEGER PRIMARY KEY,
        path_key TEXT NOT NULL UNIQUE,
        path TEXT NOT NULL UNIQUE,
        parent_key TEXT REFERENCES folders(path_key) ON UPDATE CASCADE ON DELETE CASCADE,
        name TEXT NOT NULL,
        extension TEXT NOT NULL DEFAULT '',
        kind TEXT NOT NULL DEFAULT 'other',
        size INTEGER NOT NULL DEFAULT 0,
        mtime_ms REAL NOT NULL DEFAULT 0,
        indexed_at INTEGER NOT NULL DEFAULT 0
      );
      CREATE INDEX IF NOT EXISTS files_parent_name_idx ON files(parent_key, name COLLATE NOCASE);
      CREATE INDEX IF NOT EXISTS files_mtime_idx ON files(mtime_ms DESC);
    `
  }
]

const MIGRATION_OWNER_PATTERN = /^[a-z0-9][a-z0-9._-]*$/
const MIGRATION_ID_PATTERN = /^[a-z0-9][a-z0-9._-]*$/

class CatalogDatabaseService implements CatalogDatabase {
  private transactionDepth = 0
  private savepointSequence = 0
  private readonly api: CatalogDatabase

  constructor(private readonly database: DatabaseSync) {
    this.api = Object.freeze({
      query: <T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]) => this.all<T>(sql, ...params),
      all: <T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]) => this.all<T>(sql, ...params),
      get: <T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]) => this.get<T>(sql, ...params),
      run: (sql: string, ...params: SQLInputValue[]) => this.run(sql, ...params),
      tx: <T>(work: (db: CatalogDatabase) => T) => this.tx(work),
      migrate: (owner: string, migrations: CatalogMigration[]) => this.migrate(owner, migrations)
    })
  }

  initialize(): void {
    this.database.exec('PRAGMA journal_mode = WAL; PRAGMA synchronous = NORMAL; PRAGMA foreign_keys = ON;')
    this.database.exec(`
      CREATE TABLE IF NOT EXISTS catalog_migrations (
        migration_key TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        applied_at INTEGER NOT NULL
      );
    `)
    this.migrate('catalog', BASE_SCHEMA)
  }

  query<T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.all<T>(sql, ...params)
  }

  all<T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]): T[] {
    return this.database.prepare(sql).all(...params) as T[]
  }

  get<T extends Record<string, SQLOutputValue>>(sql: string, ...params: SQLInputValue[]): T | undefined {
    return this.database.prepare(sql).get(...params) as T | undefined
  }

  run(sql: string, ...params: SQLInputValue[]): StatementResultingChanges {
    return this.database.prepare(sql).run(...params)
  }

  tx<T>(work: (database: CatalogDatabase) => T): T {
    const outermost = this.transactionDepth === 0
    const savepoint = `catalog_sp_${++this.savepointSequence}`
    this.database.exec(outermost ? 'BEGIN IMMEDIATE' : `SAVEPOINT ${savepoint}`)
    this.transactionDepth += 1
    try {
      const result = work(this.api)
      if (isPromiseLike(result)) throw new TypeError('db.tx 只接受同步回调')
      this.database.exec(outermost ? 'COMMIT' : `RELEASE SAVEPOINT ${savepoint}`)
      this.transactionDepth -= 1
      return result
    } catch (error) {
      this.transactionDepth -= 1
      try {
        this.database.exec(outermost ? 'ROLLBACK' : `ROLLBACK TO SAVEPOINT ${savepoint}; RELEASE SAVEPOINT ${savepoint}`)
      } catch {
        // Preserve the original statement or callback error.
      }
      throw error
    }
  }

  migrate(owner: string, migrations: CatalogMigration[]): void {
    if (!MIGRATION_OWNER_PATTERN.test(owner)) throw new TypeError(`非法的迁移 owner：${owner}`)
    const ordered = [...migrations].sort((a, b) => a.version - b.version || a.id.localeCompare(b.id))
    const seen = new Set<string>()
    for (const migration of ordered) {
      if (!MIGRATION_ID_PATTERN.test(migration.id)) throw new TypeError(`非法的迁移 id：${migration.id}`)
      if (!Number.isInteger(migration.version) || migration.version < 1) {
        throw new TypeError(`迁移版本必须是正整数：${migration.id}`)
      }
      if (!migration.sql.trim()) throw new TypeError(`迁移 SQL 不能为空：${migration.id}`)
      if (seen.has(migration.id)) throw new TypeError(`重复的迁移 id：${owner}/${migration.id}`)
      seen.add(migration.id)

      const migrationKey = `${owner}:${migration.id}`
      const applied = this.get<{ migration_key: string }>(
        'SELECT migration_key FROM catalog_migrations WHERE migration_key = ?',
        migrationKey
      )
      if (applied) continue

      this.tx(() => {
        this.database.exec(migration.sql)
        this.run(
          'INSERT INTO catalog_migrations (migration_key, version, applied_at) VALUES (?, ?, ?)',
          migrationKey,
          migration.version,
          Date.now()
        )
        const current = this.get<{ user_version: number }>('PRAGMA user_version')?.user_version ?? 0
        const next = Math.max(current, migration.version)
        this.database.exec(`PRAGMA user_version = ${next}`)
      })
    }
  }
}

function isPromiseLike<T>(value: T): value is T & PromiseLike<unknown> {
  return typeof value === 'object' && value !== null && 'then' in value && typeof value.then === 'function'
}

const catalogPlugin: Plugin = {
  name: 'data-provider-catalog',
  inject: ['storage'],
  apply: async (ctx: Context) => {
    const dataDirectory = join(app.getPath('userData'), 'data')
    await mkdir(dataDirectory, { recursive: true })
    ctx.storage.register('data-provider-catalog', {
      title: '数据目录数据库',
      entries: [{
        label: '共享 SQLite 数据库',
        description: '文件标注、搜索索引与版本元数据由多个插件共用此数据库',
        relativePath: 'data/desksuite.db'
      }]
    })
    const database = new DatabaseSync(join(dataDirectory, 'desksuite.db'))
    const service = new CatalogDatabaseService(database)
    service.initialize()
    const disposeProvider = ctx.reflect.provide('db', service)
    return async () => {
      await disposeProvider()
      database.close()
    }
  }
}

export default catalogPlugin
