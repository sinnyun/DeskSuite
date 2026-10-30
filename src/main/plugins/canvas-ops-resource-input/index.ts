import { app, clipboard } from 'electron'
import { createHash } from 'node:crypto'
import { mkdir, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import type { Context } from 'cordis'
import { mcpError, mcpText } from '../../services/mcp'

export default {
  inject: ['resources', 'ipc', 'mcp'],
  apply(ctx: Context) {
    const clipboardImage = async () => {
      const image = clipboard.readImage()
      if (image.isEmpty()) throw new Error('剪贴板中没有图片')
      const png = image.toPNG()
      if (png.length > 32 * 1024 * 1024) throw new Error('剪贴板图片超过 32MB')
      const folder = join(app.getPath('userData'), 'data', 'canvas-paste')
      await mkdir(folder, { recursive: true })
      const path = join(folder, createHash('sha256').update(png).digest('hex') + '.png')
      // Clipboard pixels have no original file. Keep an immutable, content-addressed source.
      await writeFile(path, png, { flag: 'wx' }).catch((error) => {
        if (error.code !== 'EEXIST') throw error
      })
      return ctx.resources.register(path)
    }
    ctx.ipc.handle('canvasInput', { clipboardImage })
    ctx.mcp.registerTool('canvas_paste_image', {
      description: 'Persist current system clipboard pixels as an immutable resource and return its stable URI.',
      inputSchema: {},
      mutating: true,
      execute: async () => {
        try {
          return mcpText(JSON.stringify(await clipboardImage()))
        } catch (error) {
          return mcpError(String(error))
        }
      }
    })
  }
}
