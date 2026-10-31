import { useEffect, useState } from 'react'
import type { FormEvent, ReactElement } from 'react'
import { Download, RefreshCw, Settings2, Upload } from 'lucide-react'
import { callValidated, definePlugin, errorText, useLayoutShallow, useUiKit } from '../../workbench/sdk'
import { updateOperationResultSchema, updateStateSchema, type UpdateState } from './schemas'

export default definePlugin({
  id: 'system-basic-updater',
  name: '软件更新',
  version: '1.0.0',
  description: '检查 GitHub Releases 更新并由用户决定下载和安装',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'updater.open', slotId: 'top.actions', order: 80, component: UpdateButton },
    { id: 'updater.panel', slotId: 'floating.panels', order: 90, component: UpdatePanel }
  ]
})

function UpdateButton(): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const { openFloatingPanel } = useLayoutShallow((state) => ({ openFloatingPanel: state.openFloatingPanel }))
  return <DesktopIconButton size="sm" icon={<Download className="h-3.5 w-3.5" />} tooltip="软件更新" onClick={() => openFloatingPanel('updater')} />
}
function UpdatePanel(): ReactElement {
  const { ThemeFloatingPanel, DesktopButton, DesktopInput } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'updater'
  const [state, setState] = useState<UpdateState | null>(null)
  const [feedUrl, setFeedUrl] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')

  useEffect(() => {
    if (!isOpen) return
    let alive = true
    void callValidated(updateStateSchema, 'updater', 'get').then((value) => {
      if (alive) { setState(value); setFeedUrl(value.feedUrl) }
    }).catch((cause) => { if (alive) setError(errorText(cause, '无法读取更新状态')) })
    const unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'updater:state') return
      const parsed = updateStateSchema.safeParse(payload)
      if (parsed.success) setState(parsed.data)
      else if (alive) setError('更新状态数据格式无效，已忽略异常消息')
    })
    return () => { alive = false; unsubscribe() }
  }, [isOpen])

  async function perform(method: 'check' | 'download' | 'install'): Promise<void> {
    setBusy(true); setError('')
    try {
      const result = await callValidated(updateOperationResultSchema, 'updater', method)
      if (result !== true) setState(result)
    } catch (cause) { setError(errorText(cause, '更新操作失败')) }
    finally { setBusy(false) }
  }

  async function saveFeed(event: FormEvent): Promise<void> {
    event.preventDefault(); setBusy(true); setError('')
    try { setState(await callValidated(updateStateSchema, 'updater', 'setFeedUrl', feedUrl.trim())) }
    catch (cause) { setError(errorText(cause, '更新源保存失败')) }
    finally { setBusy(false) }
  }

  const canCheck = Boolean(state?.feedUrl) && state?.packaged && !busy
  return <ThemeFloatingPanel title="软件更新" icon={<Download className="h-3.5 w-3.5" />} badge={state?.currentVersion ? `v${state.currentVersion}` : undefined}
    isOpen={isOpen} onClose={closeFloatingPanel} initialX={260} initialY={110} initialWidth={500} initialHeight={380} minWidth={440} minHeight={320}>
    <div className="flex h-full flex-col gap-4 text-xs">
      <section className="rounded-lg border border-[var(--ds-border)] p-3 dark:border-[var(--ds-border)]">
        <div className="flex items-center gap-2 font-medium"><Settings2 className="h-4 w-4" /> GitHub Releases 源</div>
        <p className="mt-1 text-xs text-[var(--ds-text-muted)]">填写 GitHub 仓库地址或 Releases 页面地址。留空会关闭更新检查。</p>
        <form className="mt-3 flex gap-2" onSubmit={(event) => void saveFeed(event)}>
          <div className="min-w-0 flex-1"><DesktopInput value={feedUrl} onChange={(event) => setFeedUrl(event.target.value)} placeholder="https://github.com/owner/repo/releases" /></div>
          <DesktopButton type="submit" size="xs" variant="subtle" disabled={busy}>保存</DesktopButton>
        </form>
      </section>
      <section className="flex-1 rounded-lg border border-[var(--ds-border)] p-3 dark:border-[var(--ds-border)]">
        <div className="flex items-center justify-between"><strong>当前版本</strong><span className="font-mono">{state?.currentVersion ?? '读取中…'}</span></div>
        <p className="mt-3 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">{state?.message ?? (state?.packaged ? '尚未检查更新' : '开发模式下不可执行更新')}</p>
        {state?.status === 'downloading' && <div className="mt-3 h-1.5 overflow-hidden rounded bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)]"><div className="h-full bg-[var(--ds-accent)]" style={{ width: `${state.percent ?? 0}%` }} /></div>}
        {error && <p role="alert" className="mt-3 text-[var(--ds-status-danger)]">{error}</p>}
      </section>
      <div className="flex justify-end gap-2">
        <DesktopButton size="xs" variant="subtle" icon={<RefreshCw className="h-3 w-3" />} disabled={!canCheck} onClick={() => void perform('check')}>检查更新</DesktopButton>
        {state?.status === 'available' && <DesktopButton size="xs" variant="primary" disabled={busy} onClick={() => void perform('download')}>下载</DesktopButton>}
        {state?.status === 'downloaded' && <DesktopButton size="xs" variant="primary" icon={<Upload className="h-3 w-3" />} onClick={() => void perform('install')}>退出并安装</DesktopButton>}
      </div>
    </div>
  </ThemeFloatingPanel>
}
