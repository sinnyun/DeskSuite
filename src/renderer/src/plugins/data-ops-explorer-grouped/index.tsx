import { useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { Rows3 } from 'lucide-react'
import { definePlugin, getService, useUiKit } from '../../workbench/sdk'
import { groupedViewComponent } from './GroupedView'
import { groupOptionsStore, type GroupBy } from './group-state'

interface ExplorerState {
  groupingEnabled: boolean
}

interface ExplorerStore {
  getState(): ExplorerState
  subscribe(listener: () => void): () => void
  setGroupingEnabled(enabled: boolean): void
}

interface PaneService {
  getSnapshot(): unknown
  subscribe(listener: () => void): () => void
  getActiveStore(): ExplorerStore
}

const noopSubscribe = (): (() => void) => () => undefined
const emptyState: ExplorerState = { groupingEnabled: false }
const emptyPaneSnapshot = (): unknown => null

function GroupedToolbar(): ReactElement {
  const { DesktopButton, DesktopIconButton, DesktopSelect } = useUiKit()
  const panes = getService<PaneService>('panes')
  useSyncExternalStore(panes?.subscribe ?? noopSubscribe, panes?.getSnapshot ?? emptyPaneSnapshot)
  const store = panes?.getActiveStore()
  const explorer = useSyncExternalStore(store?.subscribe ?? noopSubscribe, store?.getState ?? (() => emptyState))
  const options = useSyncExternalStore(groupOptionsStore.subscribe, groupOptionsStore.getSnapshot)
  const active = explorer.groupingEnabled

  return <div data-grouped-toolbar className="flex shrink-0 items-center gap-1.5">
    <DesktopIconButton
      size="xs"
      active={active}
      icon={<Rows3 className="h-3.5 w-3.5" />}
      aria-pressed={active}
      tooltip={active ? '关闭区块分组' : '开启区块分组'}
      onClick={() => store?.setGroupingEnabled(!active)}
    />
    {active && <>
      <DesktopSelect
        className="w-[144px]"
        title="切换分组方式"
        value={options.groupBy}
        options={[
          { value: 'kind', label: '分组方式：类型分组' },
          { value: 'modifiedMinute', label: '分组方式：修改时间' },
          { value: 'rating', label: '分组方式：评分' },
          { value: 'folder', label: '分组方式：文件夹' }
        ]}
        onChange={(value) => groupOptionsStore.set({ groupBy: value as GroupBy })}
      />
      <DesktopButton
        size="xs"
        variant={options.includeChildren ? 'primary' : 'subtle'}
        className="explorer-scope-button"
        active={!options.includeChildren}
        title="显示所选目录下所有子文件夹中的条目"
        onClick={() => groupOptionsStore.set({ includeChildren: !options.includeChildren })}
      >
        {options.includeChildren ? '包含子文件夹' : '仅当前文件夹'}
      </DesktopButton>
    </>}
  </div>
}

export default definePlugin({
  id: 'data-ops-explorer-grouped',
  name: '文件分组视图',
  version: '1.0.0',
  description: '在文件资源管理器工具栏切换分组视图、类型/时间/评分/文件夹分组，并聚合显示子文件夹条目',
  author: 'DeskSuite 内置',
  services: { explorerGroupedView: { component: groupedViewComponent, toolbarComponent: GroupedToolbar, configure: groupOptionsStore.set, getOptions: groupOptionsStore.getSnapshot } }
})
