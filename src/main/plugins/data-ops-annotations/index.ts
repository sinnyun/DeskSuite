import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { identity, normalize } from '../../services/paths'
import { mcpErrorFrom, mcpText } from '../../services/mcp'
import {
  annotationPathsSchema,
  annotationTagListSchema,
  annotationTagSchema,
  annotationsChangedSchema,
  changedCountSchema,
  entriesByPathSchema,
  favoriteResultSchema,
  importLegacyResultSchema,
  noteResultSchema,
  ratingResultSchema,
  tagCountsSchema
} from './schemas'

const PLUGIN_ID = 'data-ops-annotations'
type SqlOutputValue = null | number | bigint | string | NodeJS.NonSharedUint8Array

interface TagRow extends Record<string, SqlOutputValue> {
  id: number
  name: string
  parent_id: number | null
  path: string
  color: string | null
  sort: number
  created_at: number
}

interface MetaRow extends Record<string, SqlOutputValue> {
  path_key: string
  path: string
  favorite: number
  rating: number
  note: string
  updated_at: number
}

interface TagDto {
  id: number
  name: string
  parentId: number | null
  path: string
  color: string | null
  sort: number
  children: TagDto[]
}

interface EntryAnnotation {
  path: string
  favorite: boolean
  rating: number
  note: string
  tags: Array<Pick<TagDto, 'id' | 'name' | 'parentId' | 'path' | 'color'>>
}

const tagInput = z.object({
  name: z.string().trim().min(1).max(128),
  parentId: z.number().int().positive().nullable().optional(),
  color: z.string().trim().max(32).nullable().optional()
})
const renameInput = z.object({ tagId: z.number().int().positive(), name: z.string().trim().min(1).max(128) })
const mergeInput = z.object({ sourceId: z.number().int().positive(), targetId: z.number().int().positive() })
const pathsInput = z.array(z.string().min(1).max(32768)).min(1).max(1000)
const rateInput = z.object({ path: z.string().min(1), rating: z.number().int().min(0).max(5) })
const favoriteInput = z.object({ path: z.string().min(1), favorite: z.boolean() })
const noteInput = z.object({ path: z.string().min(1), note: z.string().max(20_000) })
const tagAssignmentInput = z.object({ paths: pathsInput, tagId: z.number().int().positive() })
const legacyValueSchema = z.object({
  favorite: z.boolean().optional(),
  rating: z.number().int().min(0).max(5).optional(),
  tags: z.array(z.string().max(128)).max(100).optional()
})
const legacyImportInputSchema = z.record(z.string().min(1).max(32768), z.unknown()).superRefine((value, ctx) => {
  if (Object.keys(value).length > 10_000) ctx.addIssue({ code: 'custom', message: '旧元数据条目超过 10,000 条上限' })
})

function pathPair(path: string): { path: string; pathKey: string } {
  const normalized = normalize(path)
  return { path: normalized, pathKey: identity(normalized) }
}

function rowToTag(row: TagRow): TagDto {
  return annotationTagSchema.parse({
    id: row.id,
    name: row.name,
    parentId: row.parent_id,
    path: row.path,
    color: row.color,
    sort: row.sort,
    children: []
  })
}

const annotationsPlugin: Plugin = {
  name: PLUGIN_ID,
  inject: ['db', 'ipc', 'mcp'],
  apply(ctx: Context): void {
    ctx.db.migrate(PLUGIN_ID, [{
      id: 'tag-materialized-path',
      version: 2,
      sql: `
        ALTER TABLE tags ADD COLUMN path TEXT NOT NULL DEFAULT '';
        UPDATE tags SET path = CAST(id AS TEXT) WHERE path = '';
        CREATE INDEX IF NOT EXISTS tags_path_idx ON tags(path);
      `
    }])

    function tagRow(id: number): TagRow {
      const row = ctx.db.get<TagRow>(
        'SELECT id, name, parent_id, path, color, sort, created_at FROM tags WHERE id = ?',
        id
      )
      if (!row) throw new Error(`标签不存在：${id}`)
      return row
    }

    function upsertMetaPath(path: string): { path: string; pathKey: string } {
      const pair = pathPair(path)
      ctx.db.run(
        `INSERT INTO meta(path_key, path, updated_at) VALUES (?, ?, ?)
         ON CONFLICT(path_key) DO UPDATE SET path = excluded.path, updated_at = excluded.updated_at`,
        pair.pathKey,
        pair.path,
        Date.now()
      )
      return pair
    }

    function updatePathPrefix(oldPrefix: string, newPrefix: string): void {
      ctx.db.run(
        `UPDATE tags SET path = ? || substr(path, length(?) + 1)
         WHERE path = ? OR path LIKE ?`,
        newPrefix,
        oldPrefix,
        oldPrefix,
        `${oldPrefix}/%`
      )
    }

    function hasTagInSubtree(rootId: number, targetId: number): boolean {
      const row = ctx.db.get<{ found: number }>(
        `WITH RECURSIVE descendants(id, visited) AS (
           SELECT id, printf(',%d,', id) FROM tags WHERE id = ?
           UNION ALL
           SELECT child.id, descendants.visited || printf('%d,', child.id)
           FROM tags AS child JOIN descendants ON child.parent_id = descendants.id
           WHERE instr(descendants.visited, printf(',%d,', child.id)) = 0
         )
         SELECT EXISTS(SELECT 1 FROM descendants WHERE id = ?) AS found`,
        rootId,
        targetId
      )
      return row?.found === 1
    }

    function createTag(inputValue: unknown): TagDto {
      const input = tagInput.parse(inputValue)
      const created = ctx.db.tx(() => {
        const parentId = input.parentId ?? null
        const parent = parentId === null ? null : tagRow(parentId)
        const duplicate = ctx.db.get<{ id: number }>(
          `SELECT id FROM tags WHERE name = ? AND parent_id IS ? LIMIT 1`,
          input.name,
          parentId
        )
        if (duplicate) throw new Error(`同级标签已存在：${input.name}`)
        const sort = ctx.db.get<{ value: number }>(
          'SELECT COALESCE(MAX(sort), -1) + 1 AS value FROM tags WHERE parent_id IS ?',
          parentId
        )?.value ?? 0
        const result = ctx.db.run(
          'INSERT INTO tags(name, parent_id, path, color, sort, created_at) VALUES (?, ?, ?, ?, ?, ?)',
          input.name,
          parentId,
          '',
          input.color ?? null,
          sort,
          Date.now()
        )
        const id = Number(result.lastInsertRowid)
        const path = parent ? `${parent.path}/${id}` : String(id)
        ctx.db.run('UPDATE tags SET path = ? WHERE id = ?', path, id)
        return rowToTag(tagRow(id))
      })
      emitChanged('tree')
      return created
    }

    function tree(): TagDto[] {
      const rows = ctx.db.all<TagRow>(
        `WITH RECURSIVE ordered(id, parent_id, name, path, color, sort, created_at, depth, visited, order_key) AS (
           SELECT id, parent_id, name, path, color, sort, created_at, 0,
                  printf(',%d,', id), printf('%010d:%010d', sort, id)
           FROM tags WHERE parent_id IS NULL
           UNION ALL
           SELECT child.id, child.parent_id, child.name, child.path, child.color, child.sort, child.created_at,
                  ordered.depth + 1,
                  ordered.visited || printf('%d,', child.id),
                  ordered.order_key || '/' || printf('%010d:%010d', child.sort, child.id)
           FROM tags AS child JOIN ordered ON child.parent_id = ordered.id
           WHERE ordered.depth < 100 AND instr(ordered.visited, printf(',%d,', child.id)) = 0
         )
         SELECT id, parent_id, name, path, color, sort, created_at FROM ordered ORDER BY order_key`
      )
      const nodes = new Map<number, TagDto>()
      for (const row of rows) nodes.set(row.id, rowToTag(row))
      const roots: TagDto[] = []
      for (const node of nodes.values()) {
        const parent = node.parentId === null ? undefined : nodes.get(node.parentId)
        if (parent && parent.id !== node.id) parent.children.push(node)
        else roots.push(node)
      }
      return annotationTagListSchema.parse(roots)
    }

    function emitChanged(kind: 'tree' | 'metadata', paths?: string[]): void {
      ctx.ipc.broadcast('annotations:changed', annotationsChangedSchema.parse({ kind, paths, at: Date.now() }))
    }

    function forPaths(pathsValue: unknown): Record<string, EntryAnnotation> {
      const paths = pathsInput.parse(pathsValue)
      const pairs = paths.map(pathPair)
      const placeholders = pairs.map(() => '?').join(', ')
      const records = new Map<string, EntryAnnotation>()
      const rows = ctx.db.all<MetaRow & {
        tag_id: number | null
        tag_name: string | null
        tag_parent_id: number | null
        tag_path: string | null
        tag_color: string | null
      }>(
        `SELECT m.path_key, m.path, m.favorite, m.rating, m.note, m.updated_at,
                t.id AS tag_id, t.name AS tag_name, t.parent_id AS tag_parent_id,
                t.path AS tag_path, t.color AS tag_color
         FROM meta AS m
         LEFT JOIN file_tags AS ft ON ft.path_key = m.path_key
         LEFT JOIN tags AS t ON t.id = ft.tag_id
         WHERE m.path_key IN (${placeholders})
         ORDER BY m.path_key, t.sort, t.id`,
        ...pairs.map((pair) => pair.pathKey)
      )
      for (const pair of pairs) {
        records.set(pair.pathKey, {
          path: pair.path,
          favorite: false,
          rating: 0,
          note: '',
          tags: []
        })
      }
      for (const row of rows) {
        const entry = records.get(row.path_key)
        if (!entry) continue
        entry.path = row.path
        entry.favorite = row.favorite === 1
        entry.rating = row.rating
        entry.note = row.note
        if (row.tag_id !== null) {
          entry.tags.push({
            id: row.tag_id,
            name: row.tag_name ?? '',
            parentId: row.tag_parent_id,
            path: row.tag_path ?? '',
            color: row.tag_color
          })
        }
      }
      return entriesByPathSchema.parse(Object.fromEntries(pairs.map((pair, index) => [paths[index], records.get(pair.pathKey)!])))
    }

    function descendantTagIds(tagId: number): number[] {
      const rows = ctx.db.all<{ id: number }>(
        `WITH RECURSIVE descendants(id) AS (
           SELECT id FROM tags WHERE id = ?
           UNION ALL
           SELECT child.id FROM tags AS child JOIN descendants ON child.parent_id = descendants.id
         )
         SELECT id FROM descendants`,
        tagId
      )
      return rows.map((row) => row.id)
    }

    function pathsForTag(tagIdValue: unknown): string[] {
      const tagId = z.number().int().positive().parse(tagIdValue)
      tagRow(tagId)
      const ids = descendantTagIds(tagId)
      if (ids.length === 0) return []
      const placeholders = ids.map(() => '?').join(', ')
      const rows = ctx.db.all<{ path: string }>(
        `SELECT DISTINCT m.path FROM file_tags AS ft
         JOIN meta AS m ON m.path_key = ft.path_key
         WHERE ft.tag_id IN (${placeholders})
         ORDER BY m.path`,
        ...ids
      )
      return annotationPathsSchema.parse(rows.map((row) => row.path))
    }

    function tagCounts(): Record<string, number> {
      const rows = ctx.db.all<{ tag_id: number; count: number }>(
        'SELECT tag_id, COUNT(*) AS count FROM file_tags GROUP BY tag_id'
      )
      return tagCountsSchema.parse(Object.fromEntries(rows.map((row) => [String(row.tag_id), row.count])))
    }

    function setFavorite(inputValue: unknown): boolean {
      const input = favoriteInput.parse(inputValue)
      const pair = ctx.db.tx(() => {
        const value = upsertMetaPath(input.path)
        ctx.db.run('UPDATE meta SET favorite = ?, updated_at = ? WHERE path_key = ?', Number(input.favorite), Date.now(), value.pathKey)
        return value
      })
      emitChanged('metadata', [pair.path])
      return favoriteResultSchema.parse(input.favorite)
    }

    function setRating(inputValue: unknown): number {
      const input = rateInput.parse(inputValue)
      const pair = ctx.db.tx(() => {
        const value = upsertMetaPath(input.path)
        ctx.db.run('UPDATE meta SET rating = ?, updated_at = ? WHERE path_key = ?', input.rating, Date.now(), value.pathKey)
        return value
      })
      emitChanged('metadata', [pair.path])
      return ratingResultSchema.parse(input.rating)
    }

    function setNote(inputValue: unknown): string {
      const input = noteInput.parse(inputValue)
      const pair = ctx.db.tx(() => {
        const value = upsertMetaPath(input.path)
        ctx.db.run('UPDATE meta SET note = ?, updated_at = ? WHERE path_key = ?', input.note, Date.now(), value.pathKey)
        return value
      })
      emitChanged('metadata', [pair.path])
      return noteResultSchema.parse(input.note)
    }

    function assignTag(inputValue: unknown): number {
      const input = tagAssignmentInput.parse(inputValue)
      tagRow(input.tagId)
      let pairs: Array<{ path: string; pathKey: string }> = []
      ctx.db.tx((db) => {
        pairs = input.paths.map(upsertMetaPath)
        for (const pair of pairs) {
          db.run('INSERT OR IGNORE INTO file_tags(path_key, tag_id) VALUES (?, ?)', pair.pathKey, input.tagId)
        }
      })
      emitChanged('metadata', pairs.map((pair) => pair.path))
      return changedCountSchema.parse(pairs.length)
    }

    function unassignTag(inputValue: unknown): number {
      const input = tagAssignmentInput.parse(inputValue)
      tagRow(input.tagId)
      const pairs = input.paths.map(pathPair)
      let count = 0
      ctx.db.tx((db) => {
        for (const pair of pairs) {
          count += Number(db.run('DELETE FROM file_tags WHERE path_key = ? AND tag_id = ?', pair.pathKey, input.tagId).changes)
        }
      })
      emitChanged('metadata', pairs.map((pair) => pair.path))
      return changedCountSchema.parse(count)
    }

    function renameTag(inputValue: unknown): TagDto {
      const input = renameInput.parse(inputValue)
      const current = tagRow(input.tagId)
      const duplicate = ctx.db.get<{ id: number }>(
        'SELECT id FROM tags WHERE name = ? AND parent_id IS ? AND id <> ? LIMIT 1',
        input.name,
        current.parent_id,
        input.tagId
      )
      if (duplicate) throw new Error(`同级标签已存在：${input.name}`)
      ctx.db.tx(() => ctx.db.run('UPDATE tags SET name = ? WHERE id = ?', input.name, input.tagId))
      emitChanged('tree')
      return rowToTag(tagRow(input.tagId))
    }

    function mergeTags(inputValue: unknown): TagDto {
      const input = mergeInput.parse(inputValue)
      if (input.sourceId === input.targetId) throw new Error('不能将标签合并到自身')
      const source = tagRow(input.sourceId)
      const target = tagRow(input.targetId)
      if (hasTagInSubtree(source.id, target.id)) throw new Error('不能将标签合并到自己的子标签')
      ctx.db.tx((db) => {
        db.run(
          `INSERT OR IGNORE INTO file_tags(path_key, tag_id)
           SELECT path_key, ? FROM file_tags WHERE tag_id = ?`,
          target.id,
          source.id
        )
        db.run('DELETE FROM file_tags WHERE tag_id = ?', source.id)
        const children = db.all<TagRow>(
          'SELECT id, name, parent_id, path, color, sort, created_at FROM tags WHERE parent_id = ?',
          source.id
        )
        for (const child of children) {
          db.run('UPDATE tags SET parent_id = ? WHERE id = ?', target.id, child.id)
          updatePathPrefix(child.path, `${target.path}/${child.id}`)
        }
        db.run('DELETE FROM tags WHERE id = ?', source.id)
      })
      emitChanged('tree')
      return rowToTag(tagRow(target.id))
    }

    function removeTag(tagIdValue: unknown): boolean {
      const tagId = z.number().int().positive().parse(tagIdValue)
      const current = tagRow(tagId)
      const parentPath = current.parent_id === null ? '' : tagRow(current.parent_id).path
      const children = ctx.db.all<TagRow>(
        'SELECT id, name, parent_id, path, color, sort, created_at FROM tags WHERE parent_id = ?',
        tagId
      )
      ctx.db.tx((db) => {
        for (const child of children) {
          db.run('UPDATE tags SET parent_id = ? WHERE id = ?', current.parent_id, child.id)
          updatePathPrefix(child.path, parentPath ? `${parentPath}/${child.id}` : String(child.id))
        }
        db.run('DELETE FROM tags WHERE id = ?', tagId)
      })
      emitChanged('tree')
      return favoriteResultSchema.parse(true)
    }

    function importLegacy(inputValue: unknown): { imported: number; skipped: number } {
      const legacy = legacyImportInputSchema.parse(inputValue)
      let imported = 0
      let skipped = 0
      ctx.db.tx(() => {
        for (const [path, raw] of Object.entries(legacy)) {
          const parsed = legacyValueSchema.safeParse(raw)
          if (!parsed.success) {
            skipped += 1
            continue
          }
          const pair = upsertMetaPath(path)
          ctx.db.run(
            'UPDATE meta SET favorite = ?, rating = ?, updated_at = ? WHERE path_key = ?',
            Number(parsed.data.favorite ?? false),
            parsed.data.rating ?? 0,
            Date.now(),
            pair.pathKey
          )
          for (const name of new Set((parsed.data.tags ?? []).map((tag) => tag.trim()).filter(Boolean))) {
            let tag = ctx.db.get<{ id: number }>(
              'SELECT id FROM tags WHERE name = ? AND parent_id IS NULL LIMIT 1',
              name
            )
            if (!tag) tag = { id: createTag({ name }).id }
            ctx.db.run('INSERT OR IGNORE INTO file_tags(path_key, tag_id) VALUES (?, ?)', pair.pathKey, tag.id)
          }
          imported += 1
        }
      })
      emitChanged('metadata')
      return importLegacyResultSchema.parse({ imported, skipped })
    }

    ctx.ipc.handle('annotations', {
      forPaths,
      pathsForTag,
      counts: tagCounts,
      setFavorite,
      setRating,
      setNote,
      assignTag,
      unassignTag,
      tree,
      create: createTag,
      rename: renameTag,
      merge: mergeTags,
      remove: removeTag,
      importLegacy
    }, {
      forPaths: z.tuple([pathsInput]),
      pathsForTag: z.tuple([z.number().int().positive()]),
      counts: z.tuple([]),
      setFavorite: z.tuple([favoriteInput]),
      setRating: z.tuple([rateInput]),
      setNote: z.tuple([noteInput]),
      assignTag: z.tuple([tagAssignmentInput]),
      unassignTag: z.tuple([tagAssignmentInput]),
      tree: z.tuple([]),
      create: z.tuple([tagInput]),
      rename: z.tuple([renameInput]),
      merge: z.tuple([mergeInput]),
      remove: z.tuple([z.number().int().positive()]),
      importLegacy: z.tuple([legacyImportInputSchema])
    })

    const pathParam = z.string().min(1)
    ctx.mcp.registerTool('tag_list', {
      description: '列出标签树及其层级路径',
      inputSchema: {},
      execute: async () => mcpText(JSON.stringify(tree()))
    })
    ctx.mcp.registerTool('tag_create', {
      description: '创建一个标签，可指定父标签',
      inputSchema: { name: z.string().trim().min(1).max(128), parentId: z.number().int().positive().optional() },
      mutating: true,
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify(createTag(args)))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
    ctx.mcp.registerTool('tag_assign', {
      description: '为一个或多个路径添加或移除标签',
      inputSchema: { paths: pathsInput, tagId: z.number().int().positive(), assigned: z.boolean().optional() },
      mutating: true,
      execute: async (args) => {
        try {
          const input = z.object({ paths: pathsInput, tagId: z.number().int().positive(), assigned: z.boolean().optional() }).parse(args)
          const count = input.assigned === false
            ? unassignTag({ paths: input.paths, tagId: input.tagId })
            : assignTag({ paths: input.paths, tagId: input.tagId })
          return mcpText(JSON.stringify({ changed: count }))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
    ctx.mcp.registerTool('tag_files', {
      description: '列出一个标签（含其子孙标签）分配到的全部文件路径',
      inputSchema: { tagId: z.number().int().positive() },
      execute: async (args) => {
        try {
          const input = z.object({ tagId: z.number().int().positive() }).parse(args)
          return mcpText(JSON.stringify(pathsForTag(input.tagId)))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
    ctx.mcp.registerTool('meta_rate', {
      description: '设置文件评分（0 到 5 星）',
      inputSchema: { path: pathParam, rating: z.number().int().min(0).max(5) },
      mutating: true,
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify({ rating: setRating(args) }))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
    ctx.mcp.registerTool('meta_favorite', {
      description: '设置或取消路径收藏',
      inputSchema: { path: pathParam, favorite: z.boolean() },
      mutating: true,
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify({ favorite: setFavorite(args) }))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
  }
}

export default annotationsPlugin
