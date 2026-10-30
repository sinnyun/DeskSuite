import { join } from 'node:path'
import { app } from 'electron'
import type { Plugin } from 'cordis'
import { Context } from 'cordis'
import { AuditService } from './services/audit'
import { ConfigService } from './services/config'
import { CommandsService } from './services/commands'
import { IpcService } from './services/ipc'
import { JobsService } from './services/jobs'
import { McpService } from './services/mcp'
import { StoreService } from './services/store'
import { WindowService } from './services/window'

// 插件自动发现：src/main/plugins/<名称>/ 下新建插件文件夹（入口 index.ts）即自动加载，无需修改本文件
const plugins = Object.entries(
  import.meta.glob<{ default: Plugin }>('./plugins/*/index.ts', { eager: true })
)
  .sort(([a], [b]) => a.localeCompare(b))
  .map(([, mod]) => mod.default)

export async function createApp(): Promise<Context> {
  const ctx = new Context()

  const config = new ConfigService(ctx)
  await config.start()

  const ipc = new IpcService(ctx)
  ipc.start()

  // 持久化数据统一放 userData/data：可写、不进 asar、便于备份与清理
  const dataDir = join(app.getPath('userData'), 'data')

  const store = new StoreService(ctx, dataDir)
  await store.start()

  new JobsService(ctx)

  const audit = new AuditService(ctx, dataDir)
  await audit.start()

  const mcp = new McpService(ctx)
  new CommandsService(ctx)
  await mcp.start()

  const window = new WindowService(ctx)
  await window.start()

  // Start all plugins before awaiting them so providers can satisfy injected dependencies;
  // createApp resolves only after every plugin has activated or an activation error is surfaced.
  await Promise.all(plugins.map((plugin) => ctx.plugin(plugin)))
  return ctx
}
