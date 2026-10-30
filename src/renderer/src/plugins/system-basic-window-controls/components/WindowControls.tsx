import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Copy, Minus, Square, X } from 'lucide-react'
import { call, useBridge, useUiKit } from '../../../workbench/sdk'

interface WindowState {
  maximized: boolean
  fullscreen: boolean
  focused: boolean
}

function ControlButton({
  title,
  onClick,
  danger = false,
  children
}: {
  title: string
  onClick: () => void
  danger?: boolean
  children: ReactElement
}): ReactElement {
  const { DesktopIconButton } = useUiKit()
  return (
    <DesktopIconButton
      size="md"
      variant={danger ? 'danger' : 'default'}
      icon={children}
      tooltip={title}
      title={title}
      onClick={onClick}
      className="!w-10 !h-8 !rounded-lg"
    />
  )
}

export function WindowControls(): ReactElement {
  const bridge = useBridge()
  const [state, setState] = useState<WindowState>({ maximized: false, fullscreen: false, focused: true })

  useEffect(() => {
    void call<WindowState>('windowControl', 'state')
      .then(setState)
      .catch(() => {})
    const off = bridge.onEvent((channel, payload) => {
      if (channel === 'window:state') setState(payload as WindowState)
    })
    return off
  }, [bridge])

  useEffect(() => {
    const handleDoubleClick = (event: MouseEvent): void => {
      const target = event.target as HTMLElement | null
      if (!target || !target.closest('.app-drag') || target.closest('.app-no-drag')) return
      void call('windowControl', 'toggleMaximize').catch(() => {})
    }
    window.addEventListener('dblclick', handleDoubleClick)
    return () => window.removeEventListener('dblclick', handleDoubleClick)
  }, [])

  return (
    <div className="flex items-center gap-0.5 app-no-drag">
      <ControlButton title="最小化" onClick={() => void call('windowControl', 'minimize')}>
        <Minus className="w-3.5 h-3.5" />
      </ControlButton>
      <ControlButton
        title={state.maximized ? '还原窗口' : '最大化'}
        onClick={() => void call('windowControl', 'toggleMaximize')}
      >
        {state.maximized ? <Copy className="w-3 h-3 -scale-x-100" /> : <Square className="w-3 h-3" />}
      </ControlButton>
      <ControlButton title="关闭窗口" danger onClick={() => void call('windowControl', 'close')}>
        <X className="w-3.5 h-3.5" />
      </ControlButton>
    </div>
  )
}
