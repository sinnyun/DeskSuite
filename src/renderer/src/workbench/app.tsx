import { useEffect, useMemo, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { LayoutProvider } from './layout'
import { ThemeProvider } from './theme'
import { SlotProvider, SlotRenderer } from './slot-context'
import { pluginRegistry, setupPlugins, slotContributions } from './registry'
import { useRuntimeBridge } from './runtime'

function EmptyWorkbench(): ReactElement {
  return (
    <div className="flex h-screen w-screen flex-col items-center justify-center gap-2 bg-[#f2f4f8] dark:bg-[var(--ds-workspace-dark)] text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">
      <span className="text-sm font-semibold text-[var(--ds-text-primary)] dark:text-[var(--ds-text-primary)]">未加载工作台外壳</span>
      <span className="text-xs">请确认 system-basic-shell 插件存在并已注册到 app.root 槽位</span>
    </div>
  )
}

export function WorkbenchApp(): ReactElement {
  useRuntimeBridge()
  useEffect(() => setupPlugins(), [])

  const catalog = useSyncExternalStore(pluginRegistry.subscribe, pluginRegistry.getSnapshot)
  const contributions = useMemo(() => {
    const active = new Set(catalog.filter((plugin) => plugin.enabled).map((plugin) => plugin.id))
    return slotContributions.filter(
      (contribution) => !contribution.pluginId || active.has(contribution.pluginId)
    )
  }, [catalog])

  return (
    <ThemeProvider>
      <LayoutProvider>
        <SlotProvider contributions={contributions}>
          <SlotRenderer slotId="app.root" fallback={<EmptyWorkbench />} />
        </SlotProvider>
      </LayoutProvider>
    </ThemeProvider>
  )
}
