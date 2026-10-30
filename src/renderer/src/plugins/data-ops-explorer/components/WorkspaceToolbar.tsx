import { useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { Plus } from 'lucide-react'
import { useUiKit } from '../../../workbench/sdk'
import { explorerPanes } from '../panes'

export function WorkspaceLayoutControls(): ReactElement {
  const { DesktopSelect } = useUiKit()
  const snapshot = useSyncExternalStore(explorerPanes.subscribe, explorerPanes.getSnapshot)
  return <div data-workspace-layout className="app-no-drag">
    <DesktopSelect className="w-[74px]" title="窗格布局" value={String(snapshot.layout)}
      options={[{ value: '1', label: '单栏' }, { value: '2', label: '双栏' }, { value: '4', label: '四栏' }]}
      onChange={(value) => void explorerPanes.setLayout(Number(value) as 1 | 2 | 4)} />
  </div>
}

export function WorkspaceToolbar(): ReactElement {
  const { DesktopButton, DesktopSelect } = useUiKit()
  const snapshot = useSyncExternalStore(explorerPanes.subscribe, explorerPanes.getSnapshot)
  return <div data-workspace-tools className="flex shrink-0 items-center gap-1.5">
    <DesktopSelect className="w-[146px]" title="切换工作区" value={snapshot.workspaceId}
      options={(snapshot.workspaces.some(workspace => workspace.id === snapshot.workspaceId) ? snapshot.workspaces : [{ id: snapshot.workspaceId, name: snapshot.workspaceName || '默认工作区' }, ...snapshot.workspaces]).map((workspace) => ({ value: workspace.id, label: `工作区：${workspace.name}` }))}
      onChange={(id) => void explorerPanes.activateWorkspace(id)} />
    <div data-workspace-create className="flex items-center overflow-hidden rounded border border-blue-600 bg-blue-600">
      <DesktopButton size="xs" variant="primary" icon={<Plus className="h-3.5 w-3.5" />}
        title="新建工作区"
        onClick={() => {
          const name = window.prompt('请输入工作区名称')?.trim()
          if (name) void explorerPanes.createWorkspace(name)
        }}>新建</DesktopButton>
      <DesktopSelect className="w-11" title="切换活动窗格" value={snapshot.activePaneId}
        options={snapshot.panes.map((pane, index) => ({ value: pane.id, label: String(index + 1) }))}
        onChange={(id) => explorerPanes.setActivePane(id)} />
    </div>
  </div>
}
