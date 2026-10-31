import { app, BrowserWindow, screen, shell } from 'electron'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { Service } from 'cordis'

declare module 'cordis' {
  interface Context {
    window: WindowService
  }
}

export class WindowService extends Service {
  private saveTimer: ReturnType<typeof setTimeout> | null = null
  private saveQueue: Promise<void> = Promise.resolve()
  private quitting = false

  constructor(ctx: Context) {
    super(ctx, 'window')
  }

  async start(): Promise<void> {
    this.createMainWindow()
    app.on('activate', () => {
      if (BrowserWindow.getAllWindows().length === 0) this.createMainWindow()
    })
    app.on('window-all-closed', () => {
      if (process.platform !== 'darwin') app.quit()
    })
    app.on('before-quit', (event) => {
      if (this.quitting) return
      event.preventDefault()
      this.quitting = true
      void this.persistWindowState().finally(() => app.quit())
    })
  }

  private createMainWindow(): BrowserWindow {
    const saved = this.ctx.config.get('window')
    const hasSavedPosition = Number.isFinite(saved.x) && Number.isFinite(saved.y)
    const savedBoundsVisible = hasSavedPosition && screen.getAllDisplays().some(({ workArea }) => {
      const visibleWidth = Math.min((saved.x as number) + saved.width, workArea.x + workArea.width) - Math.max(saved.x as number, workArea.x)
      const visibleHeight = Math.min((saved.y as number) + saved.height, workArea.y + workArea.height) - Math.max(saved.y as number, workArea.y)
      return visibleWidth >= Math.min(160, saved.width) && visibleHeight >= Math.min(100, saved.height)
    })
    const display = savedBoundsVisible
      ? screen.getDisplayMatching({ x: saved.x as number, y: saved.y as number, width: saved.width, height: saved.height })
      : screen.getPrimaryDisplay()
    const width = Math.min(saved.width, display.workAreaSize.width)
    const height = Math.min(saved.height, display.workAreaSize.height)
    const win = new BrowserWindow({
      width,
      height,
      ...(savedBoundsVisible ? { x: saved.x, y: saved.y } : {}),
      minWidth: 960,
      minHeight: 620,
      center: !savedBoundsVisible,
      frame: false,
      show: false,
      backgroundColor: '#f2f4f8',
      webPreferences: {
        preload: join(import.meta.dirname, '../preload/index.cjs'),
        contextIsolation: true,
        nodeIntegration: false
      }
    })

    if (saved.maximized) win.maximize()
    win.once('ready-to-show', () => win.show())
    const scheduleSave = (): void => {
      if (this.saveTimer !== null) clearTimeout(this.saveTimer)
      this.saveTimer = setTimeout(() => { this.saveTimer = null; this.persistWindowState(win) }, 350)
    }
    win.on('resize', scheduleSave)
    win.on('move', scheduleSave)
    win.on('maximize', scheduleSave)
    win.on('unmaximize', scheduleSave)
    win.on('close', () => this.persistWindowState(win))

    win.webContents.setWindowOpenHandler(({ url }) => {
      shell.openExternal(url)
      return { action: 'deny' }
    })

    if (process.env['ELECTRON_RENDERER_URL']) {
      win.loadURL(process.env['ELECTRON_RENDERER_URL'])
    } else {
      win.loadFile(join(import.meta.dirname, '../renderer/index.html'))
    }
    return win
  }

  private persistWindowState(win = this.getMainWindow()): Promise<void> {
    if (!this.ctx.config.canPersistWindowState()) return Promise.resolve()
    if (!win || win.isDestroyed()) return Promise.resolve()
    if (this.saveTimer !== null) { clearTimeout(this.saveTimer); this.saveTimer = null }
    const bounds = win.getNormalBounds()
    const current = this.ctx.config.get('window')
    this.saveQueue = this.saveQueue
      .then(() => this.ctx.config.set('window', {
        ...current,
        x: bounds.x,
        y: bounds.y,
        width: bounds.width,
        height: bounds.height,
        maximized: win.isMaximized()
      }))
      .catch((error: unknown) => console.error('[window] failed to save window bounds', error))
    return this.saveQueue
  }

  getMainWindow(): BrowserWindow | null {
    return BrowserWindow.getAllWindows()[0] ?? null
  }
}
