import { History } from 'lucide-react'
import { definePlugin } from '../../workbench/sdk'
import { FileVersionsPanel } from './FileVersionsPanel'

export default definePlugin({
  id: 'data-ops-explorer-versions',
  name: 'Lore 文件版本',
  version: '1.0.0',
  description: '为所选文件管理 Lore 历史版本、恢复和分支',
  contributions: [
    { id: 'versions', slotId: 'sidebar.right.tabs', order: 20, title: '版本历史', icon: <History className="h-3.5 w-3.5" /> },
    { id: 'versions', slotId: 'sidebar.right.content', order: 20, component: FileVersionsPanel }
  ]
})
