import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpErrorFrom, mcpText } from '../../services/mcp'

const PROFILE_PATTERN = /^[a-zA-Z0-9-]{1,32}$/
const MAX_ROWS = 200_000
const BATCH_SIZE = 500
const PATH_KEY_PREFIX = 'devlab:'
const JOB_BY_PROFILE = new Map<string, string>()

const profileSchema = z.string().regex(PROFILE_PATTERN).default('default')
const countSchema = z.number().int().min(1).max(MAX_ROWS)

interface LabStatus {
  profile: string
  rows: number
  runningJobId: string | null
  maxRows: number
}

function prefixFor(profile: string): string {
  return `${PATH_KEY_PREFIX}${profile}:`
}

function parseProfile(value: unknown): string {
  return profileSchema.parse(value ?? 'default')
}

function nextTurn(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve))
}

const devLabPlugin: Plugin = {
  name: 'system-basic-dev-lab',
  inject: ['db', 'ipc', 'mcp', 'jobs', 'audit'],
  apply(ctx: Context): void {
    function status(profileValue?: unknown): LabStatus {
      const profile = parseProfile(profileValue)
      const prefix = prefixFor(profile)
      const row = ctx.db.get<{ count: number }>(
        'SELECT COUNT(*) AS count FROM files WHERE substr(path_key, 1, ?) = ?',
        prefix.length,
        prefix
      )
      return {
        profile,
        rows: Number(row?.count ?? 0),
        runningJobId: JOB_BY_PROFILE.get(profile) ?? null,
        maxRows: MAX_ROWS
      }
    }

    function startJob(
      kind: 'inject' | 'clear',
      profile: string,
      total: number,
      run: (job: ReturnType<typeof ctx.jobs.create>) => Promise<Record<string, unknown>>
    ): { jobId: string } {
      const existing = JOB_BY_PROFILE.get(profile)
      if (existing) throw new Error(`配置 ${profile} 已有运行中的开发数据任务：${existing}`)
      const job = ctx.jobs.create({
        label: kind === 'inject' ? `注入 ${total} 条虚拟文件` : `清理 ${profile} 虚拟文件`,
        total,
        cancelable: true
      })
      JOB_BY_PROFILE.set(profile, job.id)
      void run(job)
        .then((summary) => {
          job.finish(summary)
          ctx.audit.record({ origin: 'ui', tool: `devLab.${kind}`, allowed: true, planId: job.id, items: total })
        })
        .catch((error) => {
          job.fail(error)
          ctx.audit.record({
            origin: 'ui',
            tool: `devLab.${kind}`,
            allowed: false,
            planId: job.id,
            error: error instanceof Error ? error.message : String(error)
          })
        })
        .finally(() => {
          if (JOB_BY_PROFILE.get(profile) === job.id) JOB_BY_PROFILE.delete(profile)
        })
      return { jobId: job.id }
    }

    function inject(countValue: unknown, profileValue?: unknown): { jobId: string; count: number; profile: string } {
      const count = countSchema.parse(countValue)
      const profile = parseProfile(profileValue)
      const prefix = prefixFor(profile)
      const job = startJob('inject', profile, count, async (handle) => {
        let completed = 0
        while (completed < count && !handle.signal.aborted) {
          const batchEnd = Math.min(completed + BATCH_SIZE, count)
          ctx.db.tx((db) => {
            for (let index = completed; index < batchEnd; index += 1) {
              const rowPathKey = `${prefix}${index.toString().padStart(8, '0')}`
              const path = `devlab://synthetic/${profile}/${index.toString().padStart(8, '0')}.png`
              const name = `synthetic-${index.toString().padStart(8, '0')}.png`
              db.run(
                `INSERT INTO files (path_key, path, parent_key, name, extension, kind, size, mtime_ms, indexed_at)
                 VALUES (?, ?, NULL, ?, '.png', 'image', 262144, ?, ?)
                 ON CONFLICT(path_key) DO UPDATE SET
                   path = excluded.path,
                   parent_key = NULL,
                   name = excluded.name,
                   extension = excluded.extension,
                   kind = excluded.kind,
                   size = excluded.size,
                   mtime_ms = excluded.mtime_ms,
                   indexed_at = excluded.indexed_at`,
                rowPathKey,
                path,
                name,
                Date.now() - (index % 86_400) * 1000,
                Date.now()
              )
            }
          })
          completed = batchEnd
          handle.progress(completed, `已写入 ${completed}/${count} 条（${profile}）`)
          await nextTurn()
        }
        return { requested: count, completed, profile, canceled: handle.signal.aborted }
      })
      return { ...job, count, profile }
    }

    function clear(profileValue?: unknown): { jobId: string; profile: string } {
      const profile = parseProfile(profileValue)
      const prefix = prefixFor(profile)
      const currentCount = status(profile).rows
      const job = startJob('clear', profile, currentCount, async (handle) => {
        let removed = 0
        while (!handle.signal.aborted) {
          const batch = ctx.db.all<{ path_key: string }>(
            'SELECT path_key FROM files WHERE substr(path_key, 1, ?) = ? LIMIT ?',
            prefix.length,
            prefix,
            BATCH_SIZE
          )
          if (batch.length === 0) break
          ctx.db.tx((db) => {
            for (const row of batch) db.run('DELETE FROM files WHERE path_key = ?', row.path_key)
          })
          removed += batch.length
          handle.progress(removed, `已清理 ${removed} 条（${profile}）`)
          await nextTurn()
        }
        return { removed, profile, canceled: handle.signal.aborted }
      })
      return { ...job, profile }
    }

    ctx.ipc.handle('devLab', { inject, clear, status }, {
      inject: z.tuple([countSchema, profileSchema.optional()]),
      clear: z.tuple([profileSchema.optional()]),
      status: z.tuple([profileSchema.optional()])
    })

    ctx.mcp.registerTool('dev_inject_data', {
      description: `向 catalog 注入 1 至 ${MAX_ROWS} 条仅用于性能测试的虚拟文件记录`,
      inputSchema: {
        count: countSchema,
        profile: profileSchema.optional()
      },
      mutating: true,
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify(inject(args.count, args.profile)))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })

    ctx.mcp.registerTool('dev_clear_data', {
      description: '仅清理 system-basic-dev-lab 创建的虚拟文件记录',
      inputSchema: { profile: profileSchema.optional() },
      mutating: true,
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify(clear(args.profile)))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })

    ctx.mcp.registerTool('dev_status', {
      description: '读取指定隔离配置中的开发虚拟文件记录数与运行任务',
      inputSchema: { profile: profileSchema.optional() },
      execute: async (args) => {
        try {
          return mcpText(JSON.stringify(status(args.profile)))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })

    ctx.mcp.registerTool('dev_open_context_menu', {
      description: '开发验收：在渲染层打开指定右键菜单区域以便截图检查；zoneId 为界面元素 data-context-zone 属性值（如 explorer.workspace），selector 可指定菜单目标元素（如 [data-entry-path]）模拟在卡片上右键，未命中时回退系统兜底菜单',
      inputSchema: {
        zoneId: z.string().min(1).max(128),
        x: z.number().int().min(0).optional(),
        y: z.number().int().min(0).optional(),
        selector: z.string().min(1).max(256).optional()
      },
      execute: async (args) => {
        try {
          ctx.ipc.broadcast('dev:context-menu', { zoneId: args.zoneId, x: args.x, y: args.y, selector: args.selector })
          return mcpText(JSON.stringify({ opened: args.zoneId }))
        } catch (error) {
          return mcpErrorFrom(error)
        }
      }
    })
  }
}

export default devLabPlugin
