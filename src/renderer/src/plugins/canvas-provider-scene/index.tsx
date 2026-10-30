import { call, definePlugin } from '../../workbench/sdk'
import { board } from './model'

export default definePlugin({
  id: 'canvas-provider-scene',
  name: '画板场景服务',
  version: '2.0.0',
  core: true,
  description: '独立场景格式、历史、串行自动保存与可扩展命令',
  author: 'DeskSuite 内置',
  services: { canvas: board },
  setup: () => window.bridge.onEvent((channel, payload) => {
    if (channel !== 'whiteboard:flush') return
    const { requestId } = payload as { requestId: string }
    void board.flush().then(
      () => call('whiteboard', 'complete', requestId, { value: true }),
      (error) => call('whiteboard', 'complete', requestId, { error: String(error) })
    ).catch((error) => board.report(error))
  })
})
