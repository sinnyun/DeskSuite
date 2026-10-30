import { app, BrowserWindow, desktopCapturer, screen } from 'electron'
import type { Context, Plugin } from 'cordis'
import { z } from 'zod'
import { mcpError, mcpText, type McpToolResult } from '../../services/mcp'

function mainWindow(): BrowserWindow | undefined {
  return BrowserWindow.getAllWindows()[0]
}

async function captureWindow(win: BrowserWindow): Promise<McpToolResult> {
  // 窗口被遮挡时 Chromium 停止出帧，capturePage 可能拿到上一帧：先强制重绘并等到下一次合成
  win.webContents.invalidate()
  await Promise.race([
    win.webContents.executeJavaScript(
      'new Promise((resolve) => requestAnimationFrame(() => requestAnimationFrame(() => resolve(true))))'
    ),
    new Promise((resolve) => setTimeout(resolve, 250))
  ])
  const image = await win.webContents.capturePage()
  return {
    content: [{ type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png' }]
  }
}

const builtinTools: Plugin = {
  inject: ['mcp'],
  apply(ctx: Context): void {
    ctx.mcp.registerTool('get_app_info', {
      description: '获取 DeskSuite 应用与运行时信息（版本、平台）',
      execute: async () =>
        mcpText(
          JSON.stringify(
            {
              name: 'DeskSuite',
              version: app.getVersion(),
              platform: process.platform,
              electron: process.versions.electron,
              node: process.versions.node,
              chrome: process.versions.chrome,
              hardwareAcceleration: app.isHardwareAccelerationEnabled(),
              gpuFeatures: app.getGPUFeatureStatus()
            },
            null,
            2
          )
        )
    })

    ctx.mcp.registerTool('list_windows', {
      description: '列出应用当前所有窗口（id、标题、地址、可见性）',
      execute: async () =>
        mcpText(
          JSON.stringify(
            BrowserWindow.getAllWindows().map((w) => ({
              id: w.id,
              title: w.getTitle(),
              url: w.webContents.getURL(),
              visible: w.isVisible()
            })),
            null,
            2
          )
        )
    })

    ctx.mcp.registerTool('control_window', {
      description: '控制应用窗口：focus 聚焦 / close 关闭 / reload 重新加载 / resize 设置内容尺寸。windowId 缺省时作用于主窗口',
      inputSchema: {
        action: z.enum(['focus', 'close', 'reload', 'resize']),
        width: z.number().int().min(960).max(7680).optional(),
        height: z.number().int().min(620).max(4320).optional(),
        windowId: z.number().optional()
      },
      execute: async (args) => {
        const win = args.windowId ? BrowserWindow.fromId(args.windowId as number) : mainWindow()
        if (!win) return mcpError('窗口不存在')
        const action = args.action as 'focus' | 'close' | 'reload' | 'resize'
        if (action === 'focus') win.focus()
        else if (action === 'close') win.close()
        else if (action === 'reload') win.reload()
        else {
          if (args.width === undefined || args.height === undefined) return mcpError('resize 需要 width 与 height')
          win.setContentSize(Number(args.width), Number(args.height))
        }
        return mcpText(`已执行：${action}`)
      }
    })

    ctx.mcp.registerTool('capture_window', {
      description: '截图应用窗口内部渲染画面，返回 PNG 图片。windowId 缺省时截图主窗口',
      inputSchema: {
        windowId: z.number().optional()
      },
      execute: async (args) => {
        const win = args.windowId ? BrowserWindow.fromId(args.windowId as number) : mainWindow()
        if (!win) return mcpError('窗口不存在')
        return captureWindow(win)
      }
    })

    ctx.mcp.registerTool('capture_screen', {
      description: '截取整个屏幕画面，返回 PNG 图片',
      inputSchema: {},
      execute: async () => {
        const { size } = screen.getPrimaryDisplay()
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width: size.width, height: size.height }
        })
        const image = sources[0]?.thumbnail
        if (!image || image.isEmpty()) return mcpError('屏幕截图失败')
        return {
          content: [
            { type: 'image', data: image.toPNG().toString('base64'), mimeType: 'image/png' }
          ]
        }
      }
    })
  }
}

export default builtinTools
