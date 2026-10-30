import type { Context, Plugin } from 'cordis'
import { app } from 'electron'
import { autoUpdater } from 'electron-updater'
import { z } from 'zod'

const settingsKey = 'updater.settings'
const settingsSchema = z.object({ feedUrl: z.string().max(2048).refine((value) => value === '' || /^https:\/\//i.test(value), '更新地址必须使用 HTTPS').default('') })

function configureFeed(feedUrl: string): void {
  if (!feedUrl) return
  const match = feedUrl.match(/^https:\/\/github\.com\/([^/]+)\/([^/]+?)(?:\/releases(?:\/.*)?)?\/?$/i)
  if (!match) throw new Error('请输入 GitHub 仓库地址或其 Releases 页面地址')
  autoUpdater.setFeedURL({ provider: 'github', owner: match[1], repo: match[2].replace(/\.git$/i, '') })
}

interface UpdateState {
  status: 'idle' | 'checking' | 'available' | 'unavailable' | 'downloading' | 'downloaded' | 'error'
  currentVersion: string
  availableVersion?: string
  percent?: number
  message?: string
  feedUrl: string
  packaged: boolean
}

const updaterPlugin: Plugin = {
  name: 'system-basic-updater',
  inject: ['ipc', 'store'],
  apply: async (ctx: Context) => {
    if (!ctx.store.has(settingsKey)) {
      ctx.store.register(settingsKey, { schema: settingsSchema, default: { feedUrl: '' }, version: 1 })
    }
    const settings = await ctx.store.read<z.infer<typeof settingsSchema>>(settingsKey)
    let state: UpdateState = {
      status: 'idle', currentVersion: app.getVersion(),
      feedUrl: settings.feedUrl, packaged: app.isPackaged
    }
    autoUpdater.autoDownload = false
    autoUpdater.autoInstallOnAppQuit = false
    autoUpdater.allowPrerelease = false

    const publish = (patch: Partial<UpdateState>): void => {
      state = { ...state, ...patch }
      ctx.ipc.broadcast('updater:state', state)
    }
    const setFeedUrl = async (value: unknown): Promise<UpdateState> => {
      const parsed = settingsSchema.parse({ feedUrl: value })
      if (parsed.feedUrl) {
        const url = new URL(parsed.feedUrl)
        if (url.protocol !== 'https:' || url.hostname !== 'github.com') throw new Error('更新源必须是 HTTPS GitHub 仓库或 Releases 地址')
        configureFeed(parsed.feedUrl)
      }
      await ctx.store.write(settingsKey, parsed)
      state = { ...state, feedUrl: parsed.feedUrl, status: 'idle', message: undefined }
      ctx.ipc.broadcast('updater:state', state)
      return state
    }
    const check = async (): Promise<UpdateState> => {
      if (!state.feedUrl) throw new Error('尚未配置 GitHub Releases 更新地址')
      if (!state.packaged) throw new Error('开发模式下不执行自动更新；请在打包版本中检查更新')
      configureFeed(state.feedUrl)
      publish({ status: 'checking', message: '正在检查更新…', percent: undefined })
      try {
        await autoUpdater.checkForUpdates()
      } catch (error) {
        publish({ status: 'error', message: error instanceof Error ? error.message : String(error) })
        throw error
      }
      return state
    }

    autoUpdater.on('checking-for-update', () => publish({ status: 'checking', message: '正在检查更新…' }))
    autoUpdater.on('update-available', (info) => publish({ status: 'available', availableVersion: info.version, message: `发现版本 ${info.version}` }))
    autoUpdater.on('update-not-available', () => publish({ status: 'unavailable', availableVersion: undefined, message: '当前已是最新版本' }))
    autoUpdater.on('download-progress', (progress) => publish({ status: 'downloading', percent: Math.round(progress.percent), message: `下载中 ${Math.round(progress.percent)}%` }))
    autoUpdater.on('update-downloaded', (info) => publish({ status: 'downloaded', availableVersion: info.version, percent: 100, message: `版本 ${info.version} 已下载，等待安装` }))
    autoUpdater.on('error', (error) => publish({ status: 'error', message: error.message }))

    ctx.ipc.handle('updater', {
      get: () => state,
      setFeedUrl,
      check,
      download: async () => {
        if (state.status !== 'available') throw new Error('当前没有可下载的更新')
        publish({ status: 'downloading', percent: 0, message: '准备下载更新…' })
        await autoUpdater.downloadUpdate()
        return state
      },
      install: () => {
        if (state.status !== 'downloaded') throw new Error('更新尚未下载完成')
        autoUpdater.quitAndInstall(false, true)
        return true
      }
    })

    if (settings.feedUrl) configureFeed(settings.feedUrl)
    return () => {
      autoUpdater.removeAllListeners('checking-for-update')
      autoUpdater.removeAllListeners('update-available')
      autoUpdater.removeAllListeners('update-not-available')
      autoUpdater.removeAllListeners('download-progress')
      autoUpdater.removeAllListeners('update-downloaded')
      autoUpdater.removeAllListeners('error')
    }
  }
}

export default updaterPlugin
