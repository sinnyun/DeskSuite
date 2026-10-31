import { useEffect, useMemo, useState } from 'react'
import type { ReactElement } from 'react'
import { FolderOpen, Settings } from 'lucide-react'
import { call, useLayout, useTheme, useUiKit } from '../../workbench/sdk'
import { AdminSettings, type AdminSettingsSection } from './AdminSettings'

interface SettingsDescriptor {
  namespace: string
  title: string
  description?: string
  category: 'program' | 'plugin'
  group?: string
  schema: { properties?: Record<string, FieldSchema>; required?: string[] }
  value: Record<string, unknown>
}

interface FieldSchema {
  title?: string
  description?: string
  type?: string
  enum?: unknown[]
  default?: unknown
  minimum?: number
  maximum?: number
  format?: string
}

export function SettingsActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayout()
  const active = floatingPanelOpen && activeFloatingPanel === 'settings'
  return <ActivityButton icon={<Settings className="w-4 h-4" />} label="设置" active={active} tooltip="程序与插件设置" onClick={() => active ? closeFloatingPanel() : openFloatingPanel('settings')} />
}

export function SettingsPanel(): ReactElement | null {
  const { ThemeFloatingPanel, DesktopButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, openFloatingPanel, closeFloatingPanel } = useLayout()
  const { setMode } = useTheme()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'settings'
  const [entries, setEntries] = useState<SettingsDescriptor[]>([])
  const [active, setActive] = useState('mcp')
  const [category, setCategory] = useState<'program' | 'plugin'>('program')
  const [drafts, setDrafts] = useState<Record<string, Record<string, unknown>>>({})
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')
  const [saved, setSaved] = useState('')

  const activeEntry = entries.find((entry) => entry.namespace === active)
  const categoryEntries = entries.filter((entry) => entry.category === category)
  const adminSections: { id: string; title: string; section: AdminSettingsSection }[] = category === 'program'
    ? [{ id: 'admin:runtime', title: '运行环境', section: 'runtime' }, { id: 'admin:storage', title: '存储', section: 'storage' }, { id: 'admin:mcp', title: 'MCP 工具', section: 'mcp' }]
    : [{ id: 'admin:plugins', title: '插件注册表', section: 'plugins' }]
  const activeAdmin = adminSections.find((item) => item.id === active)
  const properties = useMemo(() => Object.entries(activeEntry?.schema.properties ?? {}), [activeEntry])
  const draft = drafts[active] ?? activeEntry?.value ?? {}

  async function reload(): Promise<void> {
    try {
      const next = await call<SettingsDescriptor[]>('settings', 'list')
      setEntries(next)
      setDrafts(Object.fromEntries(next.map((entry) => [entry.namespace, { ...entry.value }])))
      if (!active.startsWith('admin:') && !next.some((entry) => entry.namespace === active)) setActive(next.find((entry) => entry.category === category)?.namespace ?? next[0]?.namespace ?? '')
      const appearance = next.find((entry) => entry.namespace === 'appearance')
      const mode = appearance?.value.theme
      if (mode === 'light' || mode === 'dark' || mode === 'system') setMode(mode)
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  useEffect(() => {
    if (isOpen) void reload()
  }, [isOpen])

  useEffect(() => window.bridge.onEvent((channel, payload) => {
    if (channel === 'settings:open') {
      const page = (payload as { page?: string } | undefined)?.page
      if (page === 'plugins') {
        setCategory('plugin')
        setActive('admin:plugins')
      } else if (page === 'runtime' || page === 'storage' || page === 'mcp') {
        setCategory('program')
        setActive(`admin:${page}`)
      }
      openFloatingPanel('settings')
    }
    if (channel === 'settings:changed') {
      const event = payload as { namespace?: string }
      if (event.namespace === 'appearance' || event.namespace === 'mcp') void reload()
    }
  }), [openFloatingPanel])

  function update(field: string, value: unknown): void {
    setDrafts((current) => ({ ...current, [active]: { ...(current[active] ?? draft), [field]: value } }))
    setSaved('')
  }

  async function save(): Promise<void> {
    if (!activeEntry) return
    setSaving(true)
    setError('')
    try {
      const value = await call<Record<string, unknown>>('settings', 'set', active, draft)
      setDrafts((current) => ({ ...current, [active]: value }))
      if (active === 'appearance') {
        const mode = value.theme
        if (mode === 'light' || mode === 'dark' || mode === 'system') setMode(mode)
      }
      setSaved('已保存')
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    } finally {
      setSaving(false)
    }
  }

  return (
    <ThemeFloatingPanel title="设置" icon={<Settings className="h-3.5 w-3.5" />} badge={activeEntry?.title ?? activeAdmin?.title} isOpen={isOpen} onClose={closeFloatingPanel} initialX={180} initialY={90} initialWidth={640} initialHeight={500} minWidth={520} minHeight={380}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        <div className="flex shrink-0 items-center gap-2 border-b border-[var(--ds-border)] pb-3 dark:border-[var(--ds-border)]">
          {(['program', 'plugin'] as const).map((item) => <DesktopButton key={item} type="button" size="sm" variant="ghost" active={category === item} onClick={() => { setCategory(item); const first = entries.find((entry) => entry.category === item); setActive(first?.namespace ?? (item === 'program' ? 'admin:runtime' : 'admin:plugins')); setError(''); setSaved('') }}>{item === 'program' ? '程序设置' : '插件设置'}<span className="ml-2 text-xs text-[var(--ds-text-muted)]">{entries.filter((entry) => entry.category === item).length + (item === 'program' ? 3 : 1)}</span></DesktopButton>)}
        </div>
        <div className="flex min-h-0 flex-1 gap-3">
          <nav className="w-40 shrink-0 space-y-1 overflow-auto border-r border-[var(--ds-border)] pr-2 dark:border-[var(--ds-border)]">
            {categoryEntries.map((entry) => <DesktopButton key={entry.namespace} type="button" size="sm" variant="ghost" active={active === entry.namespace} onClick={() => { setActive(entry.namespace); setError(''); setSaved('') }} className="w-full justify-start text-left"><span className="block font-medium">{entry.title}</span>{entry.group && <span className="mt-0.5 block text-xs text-[var(--ds-text-muted)]">{entry.group}</span>}</DesktopButton>)}
            {adminSections.map((item) => <DesktopButton key={item.id} type="button" size="sm" variant="ghost" active={active === item.id} onClick={() => { setActive(item.id); setError(''); setSaved('') }} className="w-full justify-start text-left">{item.title}</DesktopButton>)}
            {categoryEntries.length === 0 && <p className="p-2 text-xs text-[var(--ds-text-muted)]">当前没有可配置项</p>}
          </nav>
          <section className="flex min-w-0 flex-1 flex-col">
            <div className="min-h-0 flex-1 overflow-auto pr-1">
              {activeAdmin && <AdminSettings section={activeAdmin.section} />}
              {activeEntry && <div className="rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-4 shadow-sm dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
                <div className="mb-4 border-b border-[var(--ds-border)] pb-3 dark:border-[var(--ds-border)]"><h3 data-ds-type="section-title" className="ds-type-section-title">{activeEntry.title}</h3>{activeEntry.description && <p data-ds-type="body" className="ds-type-body mt-1">{activeEntry.description}</p>}</div>
                <div className="divide-y divide-[var(--ds-border)]">{properties.map(([key, field]) => <div key={`${active}:${key}`} className="py-3 first:pt-0 last:pb-0"><SettingField name={key} namespace={active} schema={field} value={draft[key] ?? field.default} onChange={(value) => update(key, value)} /></div>)}</div>
              </div>}
            </div>
          {activeEntry && error && <p role="alert" className="mt-2 rounded bg-[var(--ds-status-danger-soft)] p-2 text-xs text-[var(--ds-status-danger)]">{error}</p>}
          {activeEntry && <div className="mt-3 flex shrink-0 items-center justify-end gap-2 border-t border-[var(--ds-border)] pt-3 dark:border-[var(--ds-border)]">
            {saved && <span className="text-xs text-[var(--ds-status-success)]">{saved}</span>}
            <DesktopButton size="sm" variant="primary" disabled={saving || !activeEntry} onClick={() => void save()}>{saving ? '保存中…' : '保存设置'}</DesktopButton>
          </div>}
          </section>
        </div>
      </div>
    </ThemeFloatingPanel>
  )
}

const FIELD_TITLES: Record<string, string> = {
  'appearance.theme': '界面主题',
  'mcp.access': 'AI 工具访问级别',
  'mcp.writeRoots': '允许访问的目录',
  'indexing.roots': '索引目录',
  'indexing.ignore': '忽略规则',
  'watch.debounceMs': '变更合并延迟',
  'thumbnails.cacheMiB': '缓存空间上限',
  'vectorcraft.cliExecutable': 'VectorCraft CLI 程序',
  'vectorcraft.guiExecutable': 'VectorCraft 图形程序',
  'vectorcraft.defaultImageFormat': '默认图片格式',
  'vectorcraft.port': '控制端口'
}

function SettingField({ name, namespace, schema, value, onChange }: { name: string; namespace: string; schema: FieldSchema; value: unknown; onChange: (value: unknown) => void }): ReactElement {
  const { DesktopSelect, DesktopInput, DesktopTextarea } = useUiKit()
  const label = schema.title ?? FIELD_TITLES[`${namespace}.${name}`] ?? name
  if (schema.enum?.length) {
    return <label className="block space-y-1.5 text-xs"><span className="font-medium">{label}</span>{schema.description && <span className="block text-xs text-[var(--ds-text-muted)]">{schema.description}</span>}<DesktopSelect value={String(value ?? '')} options={schema.enum.map((item) => ({ value: String(item), label: String(item) }))} onChange={(next) => onChange(next)} /></label>
  }
  if (schema.type === 'boolean') {
    return <label className="flex items-start gap-2 rounded-lg border border-[var(--ds-border)] p-3 text-xs dark:border-[var(--ds-border)]"><input type="checkbox" checked={value === true} onChange={(event) => onChange(event.target.checked)} /><span><span className="font-medium">{label}</span>{schema.description && <span className="mt-1 block text-xs text-[var(--ds-text-muted)]">{schema.description}</span>}</span></label>
  }
  if (schema.type === 'array') {
    const items = Array.isArray(value) ? value.map(String) : []
    return <div className="space-y-1.5"><label className="text-xs font-medium">{label}</label>{schema.description && <p className="text-xs text-[var(--ds-text-muted)]">{schema.description}</p>}<DesktopTextarea value={items.join('\n')} onChange={(event) => onChange(event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))} className="h-24 w-full resize-none font-mono" placeholder="每行一个路径或规则" />{(name === 'writeRoots' || name === 'roots') && <ChooseDirectory onChoose={(path) => onChange([...new Set([...items, path])])} />}</div>
  }
  const isNumber = schema.type === 'number' || schema.type === 'integer'
  return <label className="block space-y-1.5 text-xs"><span className="font-medium">{label}</span>{schema.description && <span className="block text-xs text-[var(--ds-text-muted)]">{schema.description}</span>}<DesktopInput type={isNumber ? 'number' : 'text'} value={String(value ?? '')} min={schema.minimum} max={schema.maximum} onChange={(event) => onChange(isNumber ? Number(event.target.value) : event.target.value)} className="w-full" /></label>
}

function ChooseDirectory({ onChoose }: { onChoose: (path: string) => void }): ReactElement {
  const { DesktopButton } = useUiKit()
  return <DesktopButton size="xs" variant="subtle" icon={<FolderOpen className="h-3 w-3" />} onClick={() => void call<string | null>('filesystem', 'pickDirectory').then((path) => { if (path) onChoose(path) })}>添加目录</DesktopButton>
}
