import type { PluginCatalogEntry, RendererPlugin, SlotContribution } from './types'
import { registerServices } from './services'
import { log } from './logs'

const modules = import.meta.glob<{ default: RendererPlugin }>('../plugins/*/index.tsx', {
  eager: true
})

export const rendererPlugins: RendererPlugin[] = Object.entries(modules)
  .map(([path, mod]) => {
    const folder = path.match(/\/([^/]+)\/index\.tsx$/)?.[1] ?? path
    const plugin = mod.default
    if (!plugin || plugin.id !== folder) {
      throw new Error(`渲染插件 id "${plugin?.id}" 必须与文件夹名 "${folder}" 一致`)
    }
    return plugin
  })
  .sort((a, b) => a.id.localeCompare(b.id))

const contributionKeys = new Set<string>()

export const slotContributions: SlotContribution[] = rendererPlugins.flatMap((plugin) =>
  (plugin.contributions ?? []).map((contribution) => {
    const key = `${contribution.slotId}:${contribution.id}`
    if (contributionKeys.has(key)) {
      throw new Error(`槽位贡献 id 重复：${key}`)
    }
    contributionKeys.add(key)
    return { ...contribution, pluginId: plugin.id }
  })
)

for (const plugin of rendererPlugins) {
  if (plugin.services) registerServices(plugin.id, plugin.services)
}

const STORAGE_KEY = 'desksuite.workbench.plugins'

const pluginById = new Map(rendererPlugins.map((plugin) => [plugin.id, plugin]))
const corePluginIds = new Set(
  rendererPlugins.filter((plugin) => plugin.core).map((plugin) => plugin.id)
)

function readDisabled(): Set<string> {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    const parsed = saved ? (JSON.parse(saved) as unknown) : []
    return new Set(
      Array.isArray(parsed)
        ? parsed.filter((id): id is string => typeof id === 'string' && !corePluginIds.has(id))
        : []
    )
  } catch {
    return new Set()
  }
}

const disabled = readDisabled()
const enabled = new Set(
  rendererPlugins.filter((plugin) => !disabled.has(plugin.id)).map((plugin) => plugin.id)
)

const listeners = new Set<() => void>()
const disposers = new Map<string, () => void>()
let booted = false

function buildCatalog(): PluginCatalogEntry[] {
  return rendererPlugins.map((plugin) => ({
    id: plugin.id,
    name: plugin.name,
    version: plugin.version,
    description: plugin.description,
    author: plugin.author ?? 'DeskSuite 内置',
    contributions: plugin.contributions?.length ?? 0,
    hasSetup: typeof plugin.setup === 'function',
    core: plugin.core === true,
    enabled: enabled.has(plugin.id)
  }))
}

let catalogSnapshot = buildCatalog()

function emit(): void {
  catalogSnapshot = buildCatalog()
  for (const listener of listeners) listener()
}

function persist(): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify([...disabled]))
  } catch {
    // 本地存储不可用时只在本次会话内生效
  }
}

function activate(plugin: RendererPlugin): void {
  if (!plugin.setup || disposers.has(plugin.id)) return
  try {
    const dispose = plugin.setup()
    if (typeof dispose === 'function') disposers.set(plugin.id, dispose)
  } catch (error) {
    log('error', 'PluginLoader', `插件初始化失败：${plugin.name}`, String(error))
  }
}

function deactivate(plugin: RendererPlugin): void {
  const dispose = disposers.get(plugin.id)
  if (!dispose) return
  disposers.delete(plugin.id)
  try {
    dispose()
  } catch (error) {
    log('error', 'PluginLoader', `插件卸载失败：${plugin.name}`, String(error))
  }
}

export const pluginRegistry = {
  list: (): PluginCatalogEntry[] => catalogSnapshot,
  getSnapshot: (): PluginCatalogEntry[] => catalogSnapshot,
  subscribe: (listener: () => void): (() => void) => {
    listeners.add(listener)
    return () => listeners.delete(listener)
  },
  isEnabled: (id: string): boolean => enabled.has(id),
  setEnabled: (id: string, next: boolean): void => {
    const plugin = pluginById.get(id)
    if (!plugin) throw new Error(`未知渲染插件：${id}`)
    if (plugin.core && !next) throw new Error(`核心插件不可停用：${plugin.name}`)
    if (enabled.has(id) === next) return

    if (next) {
      enabled.add(id)
      disabled.delete(id)
    } else {
      enabled.delete(id)
      disabled.add(id)
    }
    persist()
    if (booted) {
      if (next) activate(plugin)
      else deactivate(plugin)
    }
    emit()
    log('lifecycle', 'PluginLoader', `${next ? '启用' : '停用'}插件：${plugin.name}`, { pluginId: id })
  }
}

registerServices('workbench', {
  pluginCatalog: pluginRegistry
})

export function setupPlugins(): () => void {
  if (booted) return () => {}
  booted = true
  for (const plugin of rendererPlugins) {
    if (enabled.has(plugin.id)) activate(plugin)
  }
  return () => {
    for (const plugin of [...rendererPlugins].reverse()) deactivate(plugin)
    booted = false
  }
}
