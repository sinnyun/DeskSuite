import { useEffect, useState, useSyncExternalStore } from 'react'
import type { ReactElement, ReactNode } from 'react'
import { Copy, Lock, RefreshCw } from 'lucide-react'
import {
  call,
  getService,
  listServiceNames,
  log,
  useUiKit,
  type McpAccess,
  type McpToolInfo,
  type PluginCatalogEntry,
  type PluginCatalogService,
  type RuntimeInfo
} from '../../workbench/sdk'

export type AdminSettingsSection = 'plugins' | 'runtime' | 'mcp'

const NOOP_SUBSCRIBE = (): (() => void) => () => {}
const EMPTY_CATALOG: PluginCatalogEntry[] = []
const getEmptyCatalog = (): PluginCatalogEntry[] => EMPTY_CATALOG
const ACCESS_LABELS: Record<McpAccess, string> = { off: '关闭', read: '只读', standard: '常规控制', full: '完全控制' }

function Card({ title, children }: { title: string; children: ReactNode }): ReactElement {
  return <section className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"><h3 className="mb-2 text-xs font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{title}</h3>{children}</section>
}

function Field({ label, value }: { label: string; value: string }): ReactElement {
  return <div className="flex items-start justify-between gap-3 border-b border-[var(--ds-border)] py-1.5 last:border-0 dark:border-[var(--ds-border)]"><span className="shrink-0 text-xs text-[var(--ds-text-muted)]">{label}</span><span className="break-all text-right font-mono text-xs text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{value}</span></div>
}

function Chips({ items }: { items: string[] }): ReactElement {
  return <div className="flex flex-wrap gap-1.5">{items.map((item) => <span key={item} className="rounded-full border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-2 py-0.5 font-mono text-xs text-[var(--ds-text-secondary)] dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-muted)] dark:text-[var(--ds-text-secondary)]">{item}</span>)}</div>
}

export function AdminSettings({ section }: { section: AdminSettingsSection }): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopTagPill } = useUiKit()
  const [info, setInfo] = useState<RuntimeInfo | null>(null)
  const [access, setAccess] = useState<McpAccess | null>(null)
  const [loading, setLoading] = useState(false)
  const catalog = getService<PluginCatalogService>('pluginCatalog')
  const plugins = useSyncExternalStore(catalog?.subscribe ?? NOOP_SUBSCRIBE, catalog?.getSnapshot ?? getEmptyCatalog)
  const services = listServiceNames()

  const refresh = async (): Promise<void> => {
    setLoading(true)
    try {
      const [runtimeInfo, currentAccess] = await Promise.all([call<RuntimeInfo>('runtime', 'info'), call<McpAccess>('mcp', 'getAccess')])
      setInfo(runtimeInfo)
      setAccess(currentAccess)
    } catch (error) {
      log('error', 'Settings', '读取运行环境信息失败', String(error))
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { void refresh() }, [])

  const copyText = async (value: string, message: string): Promise<void> => {
    try { await call('clipboard', 'writeText', value); log('event', 'Settings', message) }
    catch (error) { log('error', 'Settings', '复制失败', String(error)) }
  }
  const togglePlugin = (plugin: PluginCatalogEntry): void => {
    if (!catalog) return
    try { catalog.setEnabled(plugin.id, !plugin.enabled) }
    catch (error) { log('error', 'Settings', String(error)) }
  }
  const mcpUrl = info ? `http://127.0.0.1:${info.mcpPort}/mcp` : '—'

  return <div className="space-y-3">
    <div className="flex items-center justify-between"><p className="text-xs text-[var(--ds-text-muted)]">{section === 'plugins' ? `${plugins.filter((plugin) => plugin.enabled).length}/${plugins.length} 个插件已启用` : '应用状态与工具目录'}</p><DesktopIconButton size="xs" icon={<RefreshCw className={`h-3.5 w-3.5 ${loading ? 'animate-spin' : ''}`} />} tooltip="刷新信息" onClick={() => void refresh()} /></div>

    {section === 'plugins' && <>
      {plugins.map((plugin) => <div key={plugin.id} className={`rounded-xl border bg-[var(--ds-surface)] px-3 py-2 dark:bg-[var(--ds-surface)] ${plugin.enabled ? 'border-[var(--ds-border)] dark:border-[var(--ds-border)]' : 'border-dashed border-[var(--ds-border)] opacity-60 dark:border-[var(--ds-border)]'}`}>
        <div className="flex flex-wrap items-center gap-2"><span className="text-xs font-semibold text-[var(--ds-text-primary)] dark:text-white">{plugin.name}</span><DesktopTagPill label={`v${plugin.version}`} variant="neutral" />{plugin.core && <DesktopTagPill label="核心" variant="amber" />}{plugin.enabled ? <DesktopTagPill label="已启用" variant="emerald" /> : <DesktopTagPill label="已停用" variant="neutral" />}<span className="ml-auto font-mono text-xs text-[var(--ds-text-subtle)]">{plugin.contributions} 槽位</span>{plugin.core ? <span title="核心插件不可停用" className="p-1 text-[var(--ds-text-subtle)]"><Lock className="h-3.5 w-3.5" /></span> : <DesktopButton size="xs" variant={plugin.enabled ? 'subtle' : 'primary'} onClick={() => togglePlugin(plugin)}>{plugin.enabled ? '停用' : '启用'}</DesktopButton>}</div>
        <div className="mt-0.5 font-mono text-xs text-[var(--ds-text-subtle)]">{plugin.id} · {plugin.author}</div><p className="mt-1 text-xs text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">{plugin.description}</p>
      </div>)}
      <p className="text-xs leading-relaxed text-[var(--ds-text-subtle)]">停用插件会移除其槽位界面并执行卸载逻辑；已注册的渲染层服务仍可供其他插件使用。</p>
    </>}

    {section === 'runtime' && (info ? <>
      <Card title="应用"><Field label="名称" value={info.appName} /><Field label="版本" value={info.appVersion} /><Field label="平台" value={`${info.platform} ${info.arch}`} /></Card>
      <Card title="运行时"><Field label="Electron" value={info.electron} /><Field label="Chromium" value={info.chrome} /><Field label="Node" value={info.node} /></Card>
      <Card title={`主进程服务（${info.services.length}）`}><Chips items={info.services} /></Card>
      <Card title={`渲染层服务（${services.length}）`}><Chips items={services} /></Card>
      <DesktopButton size="xs" variant="subtle" icon={<Copy className="h-3 w-3" />} onClick={() => void copyText(JSON.stringify(info, null, 2), '已复制运行环境信息')}>复制环境信息</DesktopButton>
    </> : <p className="text-xs text-[var(--ds-text-subtle)]">正在读取运行环境…</p>)}

    {section === 'mcp' && <>
      <Card title="MCP 访问与服务器"><Field label="当前级别" value={access ? ACCESS_LABELS[access] : '读取中…'} /><Field label="地址" value={mcpUrl} /><Field label="端口" value={String(info?.mcpPort ?? '—')} /><Field label="协议" value="Streamable HTTP（无状态，仅监听 127.0.0.1）" /><p className="mt-2 text-xs leading-relaxed text-[var(--ds-text-subtle)]">修改访问级别与可写目录请使用上方的「AI 工具与文件权限」设置。</p></Card>
      <div className="flex items-center gap-2"><DesktopButton size="xs" variant="subtle" icon={<Copy className="h-3 w-3" />} disabled={!info} onClick={() => void copyText(mcpUrl, '已复制 MCP 地址')}>复制地址</DesktopButton><span className="text-xs text-[var(--ds-text-subtle)]">外部 AI 可通过该地址调用下列工具</span></div>
      <Card title={`可用工具（${info?.mcpTools.length ?? 0}）`}><div className="flex flex-col gap-1">{(info?.mcpTools ?? []).map((tool: McpToolInfo) => <div key={tool.name} className="flex items-center gap-2 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] px-2.5 py-1 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-muted)]"><span className="font-mono text-xs text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-primary)]">{tool.name}</span><span className="ml-auto">{!tool.mutating ? <DesktopTagPill label="只读" variant="neutral" /> : tool.impact === 'high' ? <DesktopTagPill label="写（高）" variant="rose" /> : <DesktopTagPill label="写（低）" variant="amber" />}</span></div>)}{info && info.mcpTools.length === 0 && <span className="text-xs text-[var(--ds-text-subtle)]">尚无已注册的 MCP 工具</span>}</div></Card>
    </>}
  </div>
}
