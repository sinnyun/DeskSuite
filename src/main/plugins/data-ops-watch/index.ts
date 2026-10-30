import { dirname, isAbsolute, normalize, resolve } from 'node:path'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'

interface PendingChange {
  paths: Set<string>
  timer: NodeJS.Timeout | null
  invalidate: boolean
}

const MAX_WATCHED_DIRECTORIES = 16
const MAX_CHANGED_PATHS = 200
const DEFAULT_DEBOUNCE_MS = 500
function normalizeDirectory(value: unknown): string {
  if (typeof value !== 'string' || !isAbsolute(value)) throw new Error('监听路径必须是绝对路径')
  return resolve(normalize(value))
}

const watchPlugin: Plugin = {
  name: 'data-ops-watch',
  inject: ['ipc', 'settings'],
  apply: async (ctx: Context) => {
    const settingsSchema = z.object({ debounceMs: z.number().int().min(100).max(5000).default(500).describe('文件变更合并延迟（毫秒）') })
    ctx.settings.register('watch', settingsSchema, { debounceMs: DEFAULT_DEBOUNCE_MS }, { title: '目录监视', description: '合并连续的目录变化事件', group: '文件管理' })
    let debounceMs = DEFAULT_DEBOUNCE_MS
    void ctx.settings.get('watch').then((value) => { debounceMs = Number(value.debounceMs) })
    ctx.settings.subscribe((namespace, value) => {
      if (namespace === 'watch') debounceMs = Number(value.debounceMs)
    })
    const { watch } = await import('chokidar')
    const panes = new Map<string, string[]>()
    const pending = new Map<string, PendingChange>()
    // Track only the directories this plugin adds itself. chokidar also watches
    // parent and child directories internally, and unwatching those tears down
    // the whole subtree (verified with chokidar 6), which silently killed events.
    const watched = new Set<string>()
    const watcher = watch([], {
      ignoreInitial: true,
      persistent: true,
      depth: 0,
      atomic: 250,
      awaitWriteFinish: { stabilityThreshold: 200, pollInterval: 100 },
      usePolling: false
    })

    const emit = (dir: string, change: PendingChange): void => {
      ctx.ipc.broadcast('fs:changed', {
        paths: change.invalidate ? [] : [...change.paths],
        dirs: [dir],
        invalidate: change.invalidate
      })
    }

    const schedule = (event: string, eventPath: string): void => {
      const normalizedPath = resolve(eventPath)
      const dir = dirname(normalizedPath)
      let change = pending.get(dir)
      if (!change) {
        change = { paths: new Set(), timer: null, invalidate: false }
        pending.set(dir, change)
      }
      if (!change.invalidate) {
        change.paths.add(normalizedPath)
        if (change.paths.size > MAX_CHANGED_PATHS) {
          change.paths.clear()
          change.invalidate = true
        }
      }
      if (change.timer) clearTimeout(change.timer)
      change.timer = setTimeout(() => {
        pending.delete(dir)
        emit(dir, change!)
      }, debounceMs)
    }

    const reconcile = async (): Promise<string[]> => {
      const unique = [...new Set([...panes.values()].flat())].slice(0, MAX_WATCHED_DIRECTORIES)
      const wanted = new Set(unique.map((dir) => resolve(dir)))
      const remove = [...watched].filter((dir) => !wanted.has(dir))
      const add = [...wanted].filter((dir) => !watched.has(dir))
      for (const dir of remove) watched.delete(dir)
      for (const dir of add) watched.add(dir)
      if (remove.length) await watcher.unwatch(remove)
      if (add.length) await watcher.add(add)
      return unique
    }

    let reconciliation: Promise<unknown> = Promise.resolve()
    const updateWatchSet = (): Promise<string[]> => {
      const run = reconciliation.then(reconcile, reconcile)
      reconciliation = run.catch(() => {})
      return run
    }

    watcher.on('all', schedule)
    watcher.on('error', (error) => {
      ctx.ipc.broadcast('fs:watch:error', { message: error instanceof Error ? error.message : String(error) })
    })
    ctx.ipc.handle('watch', {
      setPaneDirectories: async (paneId: string, directories: string[]) => {
        if (typeof paneId !== 'string' || paneId.length > 100) throw new Error('窗格标识无效')
        if (!Array.isArray(directories)) throw new Error('监听目录列表无效')
        const normalized = [...new Set(directories.slice(0, MAX_WATCHED_DIRECTORIES).map(normalizeDirectory))]
        panes.set(paneId, normalized)
        return updateWatchSet()
      },
      clearPane: async (paneId: string) => {
        panes.delete(paneId)
        return updateWatchSet()
      },
      getDirectories: async () => updateWatchSet()
    })

    return async () => {
      for (const change of pending.values()) if (change.timer) clearTimeout(change.timer)
      pending.clear()
      panes.clear()
      await watcher.close()
    }
  }
}

export default watchPlugin
