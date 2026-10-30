import type { ReactElement } from 'react'
import { SlotRenderer, useUiKit } from '../../../workbench/sdk'

export function CenterWorkspace(): ReactElement {
  const { ThemeWorkspacePanel } = useUiKit()

  return (
    <ThemeWorkspacePanel
      toolbar={
        <SlotRenderer
          slotId="workspace.toolbar"
          fallback={
            <div className="h-7 text-xs text-[var(--ds-text-subtle)] flex items-center">工作区工具栏槽位</div>
          }
        />
      }
    >
      <SlotRenderer
        slotId="workspace.views"
        fallback={
          <div className="flex flex-col items-center justify-center h-full p-8 text-[var(--ds-text-subtle)] text-xs">
            暂无挂载的工作区视图
          </div>
        }
      />
    </ThemeWorkspacePanel>
  )
}
