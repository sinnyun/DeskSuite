import type { Context, Plugin } from 'cordis'
import { sep } from 'node:path'
import { z } from 'zod'
import { mcpErrorFrom, mcpText } from '../../services/mcp'
import { normalize } from '../../services/paths'

const searchSchema = z.object({
  query: z.string().trim().max(512).default(''),
  limit: z.number().int().min(1).max(200).default(50),
  offset: z.number().int().min(0).max(10_000_000).default(0),
  kind: z.string().max(32).optional(),
  tagId: z.number().int().positive().optional(),
  minRating: z.number().int().min(1).max(5).optional(),
  favorite: z.boolean().optional(),
  root: z.string().max(32768).optional()
})
type SqlOutputValue = null | number | bigint | string | NodeJS.NonSharedUint8Array
interface SearchRow extends Record<string, SqlOutputValue> {
  id: number; path: string; path_key: string; parent_key: string | null; name: string; extension: string; kind: string; size: number; mtime_ms: number;
  favorite: number | null; rating: number | null; note: string | null
}

function escapeLike(value: string): string { return value.replace(/[\\%_]/g, '\\$&') }

const plugin: Plugin = {
  name: 'data-ops-search',
  inject: ['db', 'ipc', 'mcp'],
  apply(ctx: Context): void {
    function query(value: unknown): { items: SearchRow[]; total: number; limit: number; offset: number } {
      const args = searchSchema.parse(value)
      const where: string[] = []
      const params: Array<string | number> = []
      const needle = escapeLike(args.query)
      if (needle) {
        where.push("(f.name LIKE ? ESCAPE '\\' OR f.path LIKE ? ESCAPE '\\')")
        params.push(`%${needle}%`, `%${needle}%`)
      }
      if (args.kind) { where.push('f.kind = ?'); params.push(args.kind) }
      if (args.minRating !== undefined) { where.push('COALESCE(m.rating, 0) >= ?'); params.push(args.minRating) }
      if (args.favorite !== undefined) { where.push('COALESCE(m.favorite, 0) = ?'); params.push(args.favorite ? 1 : 0) }
      if (args.root) {
        const root = normalize(args.root)
        const prefix = root.endsWith(sep) ? root : `${root}${sep}`
        where.push('(f.path = ? OR substr(f.path, 1, length(?)) = ?)')
        params.push(root, prefix, prefix)
      }
      if (args.tagId !== undefined) {
        where.push('EXISTS (SELECT 1 FROM file_tags ft WHERE ft.path_key = f.path_key AND ft.tag_id = ?)')
        params.push(args.tagId)
      }
      const condition = where.length ? `WHERE ${where.join(' AND ')}` : ''
      const total = Number(ctx.db.get<{ total: number }>(
        `SELECT COUNT(*) AS total FROM files f LEFT JOIN meta m ON m.path_key=f.path_key ${condition}`,
        ...params
      )?.total ?? 0)
      const items = ctx.db.all<SearchRow>(
        `SELECT f.id,f.path,f.path_key,f.parent_key,f.name,f.extension,f.kind,f.size,f.mtime_ms,
                m.favorite,m.rating,m.note
         FROM files f LEFT JOIN meta m ON m.path_key=f.path_key ${condition}
         ORDER BY CASE WHEN ? = '' THEN 0 ELSE instr(lower(f.name), lower(?)) END ASC, f.mtime_ms DESC, f.name COLLATE NOCASE ASC
         LIMIT ? OFFSET ?`,
        ...params, args.query, args.query, args.limit, args.offset
      )
      return { items, total, limit: args.limit, offset: args.offset }
    }
    ctx.ipc.handle('search', { query: (args: unknown) => query(args) }, {
      query: z.tuple([searchSchema])
    })
    ctx.mcp.registerTool('search_files', {
      description: '在已扫描的文件索引中按名称/路径搜索，可按类型、标签、评分、收藏和根目录过滤；最多返回 200 条',
      inputSchema: {
        query: z.string().max(512).optional(), limit: z.number().int().min(1).max(200).optional(), offset: z.number().int().min(0).optional(),
        kind: z.string().max(32).optional(), tagId: z.number().int().positive().optional(), minRating: z.number().int().min(1).max(5).optional(),
        favorite: z.boolean().optional(), root: z.string().max(32768).optional()
      },
      execute: async (args) => { try { return mcpText(JSON.stringify(query(args), null, 2)) } catch (error) { return mcpErrorFrom(error) } }
    })
  }
}
export default plugin
