import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Command as Cmdk } from 'cmdk'
import { Command as CommandIcon, Search } from 'lucide-react'
import { call, definePlugin, logStore, useLayout, useTheme, useUiKit } from '../../workbench/sdk'

interface CommandItem {
  id: string
  title: string
  group: string
  description: string
  keybinding?: string
  mutating?: boolean
  impact?: 'low' | 'high'
  hasParameters?: boolean
  inputSchema?: { properties?: Record<string, ParameterSchema>; required?: string[] }
  source?: 'command' | 'mcp-tool'
}

interface ParameterSchema { title?: string; description?: string; type?: string; enum?: unknown[]; default?: unknown }

interface ApprovalRequest {
  planId: string
  command: CommandItem
  plan: unknown
}

export default definePlugin({
  id: 'system-basic-command-palette',
  name: '命令面板',
  version: '1.0.0',
  description: '通过 Ctrl+K 搜索并执行注册命令',
  author: 'DeskSuite 内置',
  core: true,
  contributions: [{ id: 'commands.palette', slotId: 'floating.panels', order: 95, component: CommandPalette }]
})

function CommandPalette(): ReactElement | null {
  const { ThemeFloatingPanel } = useUiKit()
  const {
    floatingPanelOpen, activeFloatingPanel, openFloatingPanel, closeFloatingPanel, toggleFloatingPanel,
    openLeftTab, openRightTab, openBottomTab, toggleLeftCollapsed, toggleRightCollapsed, toggleBottomCollapsed,
    toggleZenMode, resetLayout
  } = useLayout()
  const { toggleTheme } = useTheme()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'commands'
  const [commands, setCommands] = useState<CommandItem[]>([])
  const [query, setQuery] = useState('')
  const [uiApproval, setUiApproval] = useState<ApprovalRequest | null>(null)
  const [mcpApproval, setMcpApproval] = useState<ApprovalRequest | null>(null)
  const [parameterCommand, setParameterCommand] = useState<CommandItem | null>(null)
  const [parameterValues, setParameterValues] = useState<Record<string, unknown>>({})
  const [executionResult, setExecutionResult] = useState<{ command: CommandItem; result: unknown } | null>(null)
  const [error, setError] = useState('')
  const inputRef = useRef<HTMLInputElement>(null)
  const commandsRef = useRef(commands)
  commandsRef.current = commands

  async function reload(): Promise<void> {
    try { setCommands(await call<CommandItem[]>('commands', 'list')) }
    catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  useEffect(() => {
    if (isOpen) {
      void reload()
      window.setTimeout(() => inputRef.current?.focus(), 0)
    }
  }, [isOpen])

  useEffect(() => window.bridge.onEvent((channel, payload) => {
    if (channel === 'commands:approval') {
      const request = payload as ApprovalRequest
      setMcpApproval(request)
      openFloatingPanel('commands')
    } else if (channel === 'commands:action') {
      const event = payload as { action?: string }
      applyAction(event.action)
    }
  }), [
    openFloatingPanel, closeFloatingPanel, toggleFloatingPanel, openLeftTab, openRightTab, openBottomTab,
    toggleLeftCollapsed, toggleRightCollapsed, toggleBottomCollapsed, toggleZenMode, resetLayout, toggleTheme
  ])

  useEffect(() => {
    const handleKeyDown = (event: globalThis.KeyboardEvent): void => {
      const key = event.key.toLowerCase()
      if ((event.ctrlKey || event.metaKey) && key === 'k') {
        event.preventDefault()
        setQuery('')
        setError('')
        openFloatingPanel('commands')
        return
      }
      const target = event.target
      if (target instanceof HTMLElement && (target.isContentEditable || /^(INPUT|TEXTAREA|SELECT)$/.test(target.tagName))) return
      const found = commandsRef.current.find((item) => item.keybinding && matchKeybinding(event, item.keybinding))
      if (!found) return
      event.preventDefault()
      void runCommand(found)
    }
    window.addEventListener('keydown', handleKeyDown)
    return () => window.removeEventListener('keydown', handleKeyDown)
  }, [openFloatingPanel])

  async function runCommand(command: CommandItem): Promise<void> {
    setExecutionResult(null)
    if (command.hasParameters) {
      setParameterCommand(command)
      setParameterValues(Object.fromEntries(Object.entries(command.inputSchema?.properties ?? {}).map(([name, schema]) => [name, schema.default ?? (schema.type === 'array' ? [] : schema.type === 'boolean' ? false : '')])))
      openFloatingPanel('commands')
      return
    }
    await runCommandWithArgs(command, {})
  }

  async function runCommandWithArgs(command: CommandItem, args: Record<string, unknown>): Promise<void> {
    setError('')
    setExecutionResult(null)
    try {
      const result = await call<unknown>('commands', 'run', command.id, args)
      if (isUiPlan(result)) {
        setParameterCommand(null)
        setUiApproval({ planId: result.planId, command, plan: result.plan })
        openFloatingPanel('commands')
      } else {
        setParameterCommand(null)
        if (command.source === 'mcp-tool' && isMcpToolResult(result)) {
          setExecutionResult({ command, result })
          openFloatingPanel('commands')
          return
        }
        const action = typeof result === 'object' && result !== null && 'action' in result ? result.action : undefined
        if (typeof action === 'string') applyAction(action)
        else closeFloatingPanel()
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : String(cause))
    }
  }

  async function decideUiApproval(accepted: boolean): Promise<void> {
    if (!uiApproval) return
    const approvedCommand = uiApproval.command
    try {
      await call('commands', 'approve', uiApproval.planId, accepted)
      const result = accepted ? await call<unknown>('commands', 'execute', uiApproval.planId) : undefined
      setUiApproval(null)
      if (accepted && approvedCommand.source === 'mcp-tool' && isMcpToolResult(result)) setExecutionResult({ command: approvedCommand, result })
      else if (accepted) closeFloatingPanel()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  async function decideMcpApproval(accepted: boolean): Promise<void> {
    if (!mcpApproval) return
    try {
      await call('commands', 'approve', mcpApproval.planId, accepted)
      setMcpApproval(null)
      if (accepted) closeFloatingPanel()
    } catch (cause) { setError(cause instanceof Error ? cause.message : String(cause)) }
  }

  function dismiss(): void {
    if (mcpApproval) void decideMcpApproval(false)
    if (uiApproval) void decideUiApproval(false)
    closeFloatingPanel()
    setParameterCommand(null)
    setExecutionResult(null)
  }

  function applyAction(action: string | undefined): void {
    if (action?.startsWith('panel.open:')) openFloatingPanel(action.slice('panel.open:'.length))
    else if (action?.startsWith('panel.toggle:')) toggleFloatingPanel(action.slice('panel.toggle:'.length))
    else if (action === 'panel.close') closeFloatingPanel()
    else if (action?.startsWith('floating.toggle:')) toggleFloatingPanel(action.slice('floating.toggle:'.length))
    else if (action === 'floating.toggle') toggleFloatingPanel()
    else if (action?.startsWith('tab.open:')) {
      const [, region, id] = action.split(':')
      if (region === 'left') openLeftTab(id)
      else if (region === 'right') openRightTab(id)
      else if (region === 'bottom') openBottomTab(id)
    }
    else if (action === 'layout.sidebar.toggle:left') toggleLeftCollapsed()
    else if (action === 'layout.sidebar.toggle:right') toggleRightCollapsed()
    else if (action === 'layout.sidebar.toggle:bottom') toggleBottomCollapsed()
    else if (action === 'layout.zen.toggle') toggleZenMode()
    else if (action === 'layout.reset') resetLayout()
    else if (action === 'logs.clear') logStore.clear()
    else if (action === 'system.reload-renderer') window.location.reload()
    else if (action === 'settings.open') openFloatingPanel('settings')
    else if (action === 'launcher.open') openFloatingPanel('launcher')
    else if (action === 'clipboard.open') openFloatingPanel('clipboard')
    else if (action === 'theme.toggle') toggleTheme()
  }

  const approval = mcpApproval ?? uiApproval
  return (
    <ThemeFloatingPanel title="命令面板" icon={<CommandIcon className="h-3.5 w-3.5" />} badge="Ctrl+K" isOpen={isOpen} onClose={dismiss} initialX={260} initialY={120} initialWidth={640} initialHeight={480} minWidth={520} minHeight={360}>
      <div className="flex h-full min-h-0 flex-col gap-3">
        {approval ? <ApprovalView request={approval} isMcp={Boolean(mcpApproval)} onApprove={() => void (mcpApproval ? decideMcpApproval(true) : decideUiApproval(true))} onReject={() => void (mcpApproval ? decideMcpApproval(false) : decideUiApproval(false))} /> : executionResult ? <CommandResultView command={executionResult.command} result={executionResult.result} onClose={() => { setExecutionResult(null); closeFloatingPanel() }} /> : parameterCommand ? <ParameterView command={parameterCommand} values={parameterValues} onChange={(name, value) => setParameterValues((current) => ({ ...current, [name]: value }))} onCancel={() => setParameterCommand(null)} onRun={(values) => void runCommandWithArgs(parameterCommand, values ?? parameterValues)} /> : <>
          <Cmdk loop className="flex min-h-0 flex-1 flex-col gap-2">
          <div className="flex h-9 shrink-0 items-center gap-2 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-2.5 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]">
            <Search className="h-4 w-4 text-[var(--ds-text-subtle)]" />
            <Cmdk.Input ref={inputRef} value={query} onValueChange={setQuery} onKeyDown={(event) => { if (event.key === 'Escape') { event.preventDefault(); dismiss() } }} placeholder="搜索命令…" aria-label="搜索命令" className="min-w-0 flex-1 bg-transparent text-sm outline-none" />
            <kbd className="rounded border border-[var(--ds-border)] px-1.5 py-0.5 text-xs text-[var(--ds-text-muted)] dark:border-[var(--ds-border)]">Esc</kbd>
          </div>
          <Cmdk.List aria-label="命令列表" className="min-h-0 flex-1 overflow-auto rounded-lg border border-[var(--ds-border)] dark:border-[var(--ds-border)]">
            {commands.map((item) => <Cmdk.Item key={item.id} value={`${item.title} ${item.group} ${item.description} ${item.id}`} onSelect={() => void runCommand(item)} className="flex w-full cursor-pointer items-center gap-3 border-b border-[var(--ds-border)] px-3 py-2.5 text-left last:border-0 aria-selected:bg-[var(--ds-accent-soft)] dark:border-[var(--ds-border)] dark:aria-selected:bg-[var(--ds-accent-soft)]">
              <span className="min-w-0 flex-1"><span className="block truncate text-xs font-medium">{item.title}</span><span className="mt-0.5 block truncate text-xs text-[var(--ds-text-muted)]">{item.group} · {item.description}</span></span>
              {item.mutating && <span className="rounded bg-[var(--ds-status-warning-soft)] px-1.5 py-0.5 text-xs text-[var(--ds-status-warning)] dark:bg-[var(--ds-status-warning-soft)] dark:text-[var(--ds-status-warning)]">需批准</span>}
              <span className="rounded border border-[var(--ds-border)] px-1.5 py-0.5 text-xs text-[var(--ds-text-muted)] dark:border-[var(--ds-border)]">{item.source === 'mcp-tool' ? 'MCP 同步' : 'AI 可见'}</span>
              {item.keybinding && <kbd className="text-xs text-[var(--ds-text-subtle)]">{item.keybinding}</kbd>}
            </Cmdk.Item>)}
            <Cmdk.Empty className="p-6 text-center text-xs text-[var(--ds-text-muted)]">没有匹配的命令</Cmdk.Empty>
          </Cmdk.List>
          </Cmdk>
        </>}
        {error && <p role="alert" className="shrink-0 rounded bg-[var(--ds-status-danger-soft)] p-2 text-xs text-[var(--ds-status-danger)]">{error}</p>}
        {!approval && <p className="shrink-0 text-xs text-[var(--ds-text-subtle)]">↑↓ 选择　Enter 执行　Esc 关闭</p>}
      </div>
    </ThemeFloatingPanel>
  )
}

function ApprovalView({ request, isMcp, onApprove, onReject }: { request: ApprovalRequest; isMcp: boolean; onApprove: () => void; onReject: () => void }): ReactElement {
  const { DesktopButton } = useUiKit()
  return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div><h3 className="text-sm font-semibold">批准命令：{request.command.title}</h3><p className="mt-1 text-xs text-[var(--ds-text-muted)]">来源：{isMcp ? 'MCP 外部调用' : '命令面板'}；{request.command.impact === 'high' ? '高影响操作' : '低影响操作'}</p></div>
    <pre className="min-h-0 flex-1 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-[var(--ds-status-warning)]/35 bg-[var(--ds-status-warning-soft)] p-3 text-xs text-[var(--ds-text-secondary)] dark:border-[var(--ds-status-warning)]/35 dark:bg-[var(--ds-status-warning-soft)] dark:text-[var(--ds-text-primary)]">{JSON.stringify(request.plan, null, 2)}</pre>
    <div className="flex shrink-0 justify-end gap-2"><DesktopButton size="sm" onClick={onReject}>拒绝</DesktopButton><DesktopButton size="sm" variant="primary" onClick={onApprove}>批准{isMcp ? '请求' : '并执行'}</DesktopButton></div>
  </section>
}

function CommandResultView({ command, result, onClose }: { command: CommandItem; result: unknown; onClose: () => void }): ReactElement {
  const { DesktopButton } = useUiKit()
  const payload = result as { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> }
  return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div><h3 className="text-sm font-semibold">{command.title} · 已完成</h3><p className="mt-1 text-xs text-[var(--ds-text-muted)]">结果由 MCP 工具的同一处理器返回。</p></div>
    <div className="min-h-0 flex-1 space-y-2 overflow-auto rounded-lg border border-[var(--ds-border)] p-3 dark:border-[var(--ds-border)]">{payload.content.map((item, index) => item.type === 'image' && item.data ? <img key={index} src={`data:${item.mimeType ?? 'image/png'};base64,${item.data}`} alt="操作结果" className="max-w-full" /> : item.type === 'text' ? <pre key={index} className="whitespace-pre-wrap break-all text-xs">{item.text}</pre> : null)}</div>
    <div className="flex shrink-0 justify-end"><DesktopButton size="sm" variant="primary" onClick={onClose}>完成</DesktopButton></div>
  </section>
}

function ParameterView({ command, values, onChange, onCancel, onRun }: { command: CommandItem; values: Record<string, unknown>; onChange: (name: string, value: unknown) => void; onCancel: () => void; onRun: (values?: Record<string, unknown>) => void }): ReactElement {
  const { DesktopButton, DesktopInput, DesktopSelect, DesktopTextarea } = useUiKit()
  const fields = Object.entries(command.inputSchema?.properties ?? {})
  const required = new Set(command.inputSchema?.required ?? [])
  const [jsonText, setJsonText] = useState(() => JSON.stringify(values, null, 2))
  const [jsonError, setJsonError] = useState('')
  if (command.source === 'mcp-tool') return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div><h3 className="text-sm font-semibold">{command.title}</h3><p className="mt-1 text-xs text-[var(--ds-text-muted)]">{command.description}</p></div>
    <label className="flex min-h-0 flex-1 flex-col gap-1 text-xs"><span className="font-medium">JSON 参数</span><DesktopTextarea aria-label="JSON 参数" value={jsonText} onChange={(event) => { setJsonText(event.target.value); setJsonError('') }} spellCheck={false} className="min-h-0 flex-1 resize-none font-mono" /></label>
    {jsonError && <p role="alert" className="shrink-0 text-xs text-[var(--ds-status-danger)]">{jsonError}</p>}
    <div className="flex shrink-0 justify-end gap-2"><DesktopButton size="sm" onClick={onCancel}>返回</DesktopButton><DesktopButton size="sm" variant="primary" onClick={() => { try { const parsed: unknown = JSON.parse(jsonText); if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) throw new Error('参数必须是 JSON 对象'); onRun(parsed as Record<string, unknown>) } catch (cause) { setJsonError(cause instanceof Error ? cause.message : String(cause)) } }}>继续</DesktopButton></div>
  </section>
  return <section className="flex min-h-0 flex-1 flex-col gap-3">
    <div><h3 className="text-sm font-semibold">{command.title}</h3><p className="mt-1 text-xs text-[var(--ds-text-muted)]">{command.description}</p></div>
    <div className="min-h-0 flex-1 space-y-3 overflow-auto pr-1">{fields.map(([name, schema]) => <label key={name} className="block space-y-1 text-xs"><span className="font-medium">{schema.title ?? name}{required.has(name) ? ' *' : ''}</span>{schema.description && <span className="block text-xs text-[var(--ds-text-muted)]">{schema.description}</span>}{schema.enum ? <DesktopSelect value={String(values[name] ?? '')} onChange={(value) => onChange(name, value)} options={schema.enum.map((option) => ({ value: String(option), label: String(option) }))} className="w-full" /> : schema.type === 'boolean' ? <input type="checkbox" checked={values[name] === true} onChange={(event) => onChange(name, event.target.checked)} /> : schema.type === 'array' ? <DesktopTextarea value={Array.isArray(values[name]) ? (values[name] as unknown[]).join('\n') : ''} onChange={(event) => onChange(name, event.target.value.split(/\r?\n/).map((line) => line.trim()).filter(Boolean))} className="h-20 w-full font-mono" /> : <DesktopInput type={schema.type === 'number' || schema.type === 'integer' ? 'number' : 'text'} value={String(values[name] ?? '')} onChange={(event) => onChange(name, schema.type === 'number' || schema.type === 'integer' ? Number(event.target.value) : event.target.value)} className="w-full" />}</label>)}</div>
    <div className="flex shrink-0 justify-end gap-2"><DesktopButton size="sm" onClick={onCancel}>返回</DesktopButton><DesktopButton size="sm" variant="primary" onClick={() => onRun()}>继续</DesktopButton></div>
  </section>
}

function isUiPlan(value: unknown): value is { requiresApproval: true; planId: string; plan: unknown } {
  return typeof value === 'object' && value !== null && 'requiresApproval' in value && value.requiresApproval === true && 'planId' in value && typeof value.planId === 'string'
}

function isMcpToolResult(value: unknown): value is { content: Array<{ type: string; text?: string; data?: string; mimeType?: string }> } {
  return typeof value === 'object' && value !== null && 'content' in value && Array.isArray(value.content)
}

function matchKeybinding(event: globalThis.KeyboardEvent, binding: string): boolean {
  const pieces = binding.toLowerCase().replaceAll(' ', '').split('+')
  const key = pieces.pop() ?? ''
  const control = pieces.includes('ctrl') || pieces.includes('control')
  const meta = pieces.includes('cmd') || pieces.includes('meta')
  const shift = pieces.includes('shift')
  const alt = pieces.includes('alt')
  return event.key.toLowerCase() === key && (control ? event.ctrlKey : true) && (meta ? event.metaKey : true) && event.shiftKey === shift && event.altKey === alt
}
