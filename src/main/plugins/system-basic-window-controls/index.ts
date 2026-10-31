import type { Context, Plugin } from 'cordis'
import { z } from 'zod'

interface WindowState {
  maximized: boolean
  fullscreen: boolean
  focused: boolean
}

const windowControlsPlugin: Plugin = {
  inject: ['ipc', 'window'],
  apply(ctx: Context): void {
    const readState = (): WindowState => {
      const win = ctx.window.getMainWindow()
      return {
        maximized: win?.isMaximized() ?? false,
        fullscreen: win?.isFullScreen() ?? false,
        focused: win?.isFocused() ?? false
      }
    }

    const broadcast = (): void => {
      ctx.ipc.broadcast('window:state', readState())
    }

    ctx.ipc.handle('windowControl', {
      minimize: () => {
        ctx.window.getMainWindow()?.minimize()
        return true
      },
      toggleMaximize: () => {
        const win = ctx.window.getMainWindow()
        if (!win) return false
        if (win.isMaximized()) win.unmaximize()
        else win.maximize()
        broadcast()
        return win.isMaximized()
      },
      close: () => {
        ctx.window.getMainWindow()?.close()
        return true
      },
      reload: () => {
        ctx.window.getMainWindow()?.reload()
        return true
      },
      state: () => readState()
    }, {
      minimize: z.tuple([]),
      toggleMaximize: z.tuple([]),
      close: z.tuple([]),
      reload: z.tuple([]),
      state: z.tuple([])
    })

    ctx.effect(() => {
      const win = ctx.window.getMainWindow()
      if (!win) return () => {}
      const handler = (): void => broadcast()
      win.on('maximize', handler)
      win.on('unmaximize', handler)
      win.on('enter-full-screen', handler)
      win.on('leave-full-screen', handler)
      win.on('focus', handler)
      win.on('blur', handler)
      broadcast()
      return () => {
        win.off('maximize', handler)
        win.off('unmaximize', handler)
        win.off('enter-full-screen', handler)
        win.off('leave-full-screen', handler)
        win.off('focus', handler)
        win.off('blur', handler)
      }
    })
  }
}

export default windowControlsPlugin
