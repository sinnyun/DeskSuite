import { app, BrowserWindow } from 'electron'
import { createApp } from './app'

// All writers for a userData profile must share one process. In particular,
// Lore's per-entity queue and WorkCrate's canvas session are process-local.
const ownsProfile = app.requestSingleInstanceLock()

if (!ownsProfile) {
  app.quit()
} else {
  app.on('second-instance', () => {
    const window = BrowserWindow.getAllWindows()[0]
    if (!window) return
    if (window.isMinimized()) window.restore()
    window.show()
    window.focus()
  })

  app.whenReady().then(createApp).catch((err) => {
    console.error('[desksuite] 启动失败：', err)
    app.quit()
  })
}
