import { useEffect, useState } from 'react'
import type { ReactElement, ReactNode } from 'react'
import {
  ChevronDown,
  ChevronRight,
  Download,
  FileText,
  HardDrive,
  Home,
  Image as ImageIcon,
  Monitor,
  Network,
  RefreshCw
} from 'lucide-react'
import { call, callValidated, errorText, useUiKit } from '../../../workbench/sdk'
import { explorerStore, useExplorerShallow, type DriveInfo, type QuickItem } from '../store'
import { drivePreferencesSchema } from '../drive-preferences-schema'
import { QuickBookmarks } from './QuickBookmarks'
import { formatBytes } from '../format'

const QUICK_ICONS: Record<string, ReactNode> = {
  home: <Home className="w-3.5 h-3.5 text-[var(--ds-status-warning)]" />,
  desktop: <Monitor className="w-3.5 h-3.5 text-[var(--ds-accent)]" />,
  documents: <FileText className="w-3.5 h-3.5 text-[var(--ds-accent)]" />,
  downloads: <Download className="w-3.5 h-3.5 text-[var(--ds-status-info)]" />,
  pictures: <ImageIcon className="w-3.5 h-3.5 text-[var(--ds-status-success)]" />
}

function Section({
  title,
  action,
  children,
  defaultOpen = true
}: {
  title: string
  action?: ReactNode
  children: ReactNode
  defaultOpen?: boolean
}): ReactElement {
  const { DesktopButton } = useUiKit()
  const [open, setOpen] = useState(defaultOpen)
  return (
    <div className="flex flex-col">
      <div className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)]">
        <DesktopButton
          size="xs"
          variant="ghost"
          onClick={() => setOpen((prev) => !prev)}
          className="!h-auto !px-0 !py-0 !bg-transparent !border-0 !shadow-none !rounded-none justify-start gap-1 text-[var(--ds-text-secondary)] hover:text-[var(--ds-text-primary)]"
        >
          {open ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          <span>{title}</span>
        </DesktopButton>
        {action}
      </div>
      {open && <div className="flex flex-col gap-0.5 mt-0.5">{children}</div>}
    </div>
  )
}

export function FileTree(): ReactElement {
  const { DesktopButton, DesktopCardButton, DesktopIconButton } = useUiKit()
  const state = useExplorerShallow((s) => ({ quick: s.quick, drives: s.drives, path: s.path, truncated: s.truncated }))
  const [showNetworkDrives, setShowNetworkDrives] = useState(true)
  const [preferencesReady, setPreferencesReady] = useState(false)
  const [saving, setSaving] = useState(false)
  const [driveError, setDriveError] = useState('')
  useEffect(() => {
    let alive = true
    let receivedEvent = false
    const stop = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'filesystem:drivePreferences') return
      const parsed = drivePreferencesSchema.safeParse(payload)
      if (!parsed.success) return
      const preferences = parsed.data
      receivedEvent = true
      setShowNetworkDrives(preferences.showNetworkDrives)
      setPreferencesReady(true)
    })
    void callValidated(drivePreferencesSchema, 'filesystem', 'getDrivePreferences').then((preferences) => {
      if (alive && !receivedEvent) { setShowNetworkDrives(preferences.showNetworkDrives); setPreferencesReady(true) }
    }).catch((error) => { if (alive) setDriveError(errorText(error, '无法读取驱动器偏好')) })
    return () => { alive = false; stop() }
  }, [])
  const toggleNetworkDrives = async (): Promise<void> => {
    setSaving(true)
    setDriveError('')
    try {
      await call('filesystem', 'setDrivePreferences', { showNetworkDrives: !showNetworkDrives })
    } catch (error) { setDriveError(errorText(error, '无法保存驱动器偏好')) }
    finally { setSaving(false) }
  }
  return (
    <div className="flex flex-col gap-2.5 p-2 text-xs">
      <Section
        title="快速访问"
        action={
          <DesktopIconButton
            size="xs"
            icon={<RefreshCw className="w-3 h-3" />}
            tooltip="刷新驱动器与快捷入口"
            onClick={() => void explorerStore.init()}
          />
        }
      >
        {state.quick.map((item: QuickItem) => (
          <DesktopButton
            key={item.id}
            size="sm"
            variant="ghost"
            active={state.path?.toLowerCase() === item.path.toLowerCase()}
            onClick={() => explorerStore.navigate(item.path)}
            className="!h-auto !w-full !justify-start !rounded-md !px-2 !py-1.5 !border-0 !shadow-none gap-2 text-left"
          >
            {QUICK_ICONS[item.id] ?? <Home className="w-3.5 h-3.5" />}
            <span className="truncate">{item.label}</span>
          </DesktopButton>
        ))}
        {state.quick.length === 0 && <span className="px-2 py-1 text-xs text-[var(--ds-text-subtle)]">加载中…</span>}
      </Section>

      <div className="h-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)]" />

      <Section title="驱动器与卷" action={
        <DesktopIconButton
          size="xs" icon={<Network className="w-3.5 h-3.5" />}
          active={showNetworkDrives} aria-pressed={showNetworkDrives}
          aria-label="显示网络驱动盘" data-network-drive-toggle
          disabled={!preferencesReady || saving}
          tooltip={showNetworkDrives ? '隐藏网络驱动盘' : '显示网络驱动盘'}
          onClick={() => void toggleNetworkDrives()}
        />
      }>
        {driveError && <span role="alert" className="px-2 text-xs text-[var(--ds-status-danger)] break-all">{driveError}</span>}
        {state.drives.filter((drive) => showNetworkDrives || !drive.isNetwork).map((drive: DriveInfo) => {
          const used = drive.total > 0 ? drive.total - drive.free : 0
          const percent = drive.total > 0 ? Math.min(100, Math.round((used / drive.total) * 100)) : 0
          return (
            <DesktopCardButton
              key={drive.path}
              selected={state.path?.toLowerCase() === drive.path.toLowerCase()}
              data-drive-path={drive.path}
              data-network-drive={drive.isNetwork}
              onClick={() => explorerStore.navigate(drive.path)}
              className="flex flex-col gap-1.5 my-0.5 w-full px-2.5 py-2"
            >
              <div className="flex items-center gap-2 w-full">
                {drive.isNetwork ? <Network className="w-3.5 h-3.5 text-[var(--ds-text-muted)] shrink-0" /> : <HardDrive className="w-3.5 h-3.5 text-[var(--ds-text-muted)] shrink-0" />}
                <span className="font-medium text-[var(--ds-text-primary)]">{drive.name}</span>
                <span className="ml-auto font-mono text-xs text-[var(--ds-text-subtle)] tabular-nums">
                  {drive.total > 0 ? `${formatBytes(drive.free)} 可用` : '—'}
                </span>
              </div>
              {drive.total > 0 && (
                <div className="h-1 w-full rounded-full bg-[var(--ds-border)] dark:bg-[var(--ds-border)] overflow-hidden">
                  <div className="h-full rounded-full" style={{ width: `${percent}%`, backgroundColor: percent > 85 ? 'var(--ds-status-warning)' : percent < 35 ? 'var(--ds-status-success)' : 'var(--ds-accent)' }} />
                </div>
              )}
            </DesktopCardButton>
          )
        })}
        {state.drives.length === 0 && <span className="px-2 py-1 text-xs text-[var(--ds-text-subtle)]">加载中…</span>}
      </Section>

      <div className="h-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)]" />

      <QuickBookmarks />

      {state.truncated && (
        <span className="px-2 text-xs text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]">
            目录分批加载，可在工作区底部继续加载
        </span>
      )}
    </div>
  )
}
