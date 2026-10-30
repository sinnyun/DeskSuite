import { startBookmarkBridge } from './bookmarks'
import { Folder, Info } from 'lucide-react'
import { definePlugin, log } from '../../workbench/sdk'
import { ExplorerActivity } from './components/ExplorerActivity'
import { WorkspaceLayoutControls } from './components/WorkspaceToolbar'
import { ExplorerToolbar } from './components/ExplorerToolbar'
import { FileTree } from './components/FileTree'
import { FileWorkspace } from './components/FileWorkspace'
import { Inspector } from './components/Inspector'
import { StatusInfo } from './components/StatusInfo'
import { activeSelectionService } from './store'
import { metadataStore } from './metadata'
import { explorerPanes, panesRendererService } from './panes'

export default definePlugin({
  id: 'data-ops-explorer',
  name: '文件资源管理器',
  version: '1.0.0',
  description: '目录树、列表/卡片/画廊视图、属性检查器与状态信息，数据来自 data-ops-filesystem',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'explorer.layout', slotId: 'top.actions', order: 70, component: WorkspaceLayoutControls },
    {
      id: 'explorer.activity',
      slotId: 'sidebar.activity',
      order: 10,
      component: ExplorerActivity
    },
    {
      id: 'files',
      slotId: 'sidebar.left.tabs',
      order: 10,
      title: '资源管理',
      icon: <Folder className="w-3.5 h-3.5" />
    },
    {
      id: 'files',
      slotId: 'sidebar.left.content',
      order: 10,
      component: FileTree
    },
    {
      id: 'explorer.toolbar',
      slotId: 'workspace.toolbar',
      order: 10,
      component: ExplorerToolbar
    },
    {
      id: 'explorer.views',
      slotId: 'workspace.views',
      order: 10,
      component: FileWorkspace
    },
    {
      id: 'inspector',
      slotId: 'sidebar.right.tabs',
      order: 10,
      title: '属性信息',
      icon: <Info className="w-3.5 h-3.5" />
    },
    {
      id: 'inspector',
      slotId: 'sidebar.right.content',
      order: 10,
      component: Inspector
    },
    {
      id: 'explorer.status',
      slotId: 'statusbar.left',
      order: 10,
      component: StatusInfo
    }
  ],
  services: {
      selection: activeSelectionService,
      panes: panesRendererService
  },
  setup: () => {
      void explorerPanes.initialize()
      void metadataStore.start()
    log('lifecycle', 'Explorer', '文件浏览器插件已加载')
    return startBookmarkBridge()
  }
})
