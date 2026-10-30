import React from 'react';
import { PluginDefinition } from '../../types/workbench';
import { FileTree } from './components/FileTree';
import { ExplorerToolbar } from './components/ExplorerToolbar';
import { FileListView } from './components/FileListView';
import { FileGridView } from './components/FileGridView';
import { FileGalleryView } from './components/FileGalleryView';
import { FileInspector } from './components/FileInspector';
import { useExplorer } from './context/ExplorerContext';
import { FolderTree, Info, RefreshCw, FolderPlus } from 'lucide-react';
import { DesktopButton } from '../../theme/components';
import { formatBytes } from './data/mockFiles';

// Component rendering the dynamic active view for the workspace
const ExplorerViewDispatcher: React.FC = () => {
  const { viewMode } = useExplorer();

  if (viewMode === 'grid') {
    return <FileGridView />;
  }
  if (viewMode === 'gallery') {
    return <FileGalleryView />;
  }
  return <FileListView />;
};

// Component for top breadcrumbs
const ExplorerBreadcrumbs: React.FC = () => {
  const { currentPath } = useExplorer();
  return (
    <span className="font-mono text-neutral-700 dark:text-neutral-300 truncate font-medium">
      {currentPath || '/'}
    </span>
  );
};

// Component for status bar
const ExplorerStatusBar: React.FC = () => {
  const { currentFolderFiles, selectedFileIds, virtualizationEnabled, datasetMode } = useExplorer();
  const totalSize = currentFolderFiles.reduce((acc, f) => acc + f.size, 0);

  return (
    <div className="flex items-center gap-2 font-mono">
      <span>{currentFolderFiles.length} 个对象</span>
      <span className="text-neutral-400 dark:text-neutral-600">·</span>
      <span>已选 {selectedFileIds.length} 项</span>
      <span className="text-neutral-400 dark:text-neutral-600">·</span>
      <span>共计 {formatBytes(totalSize)}</span>
      {virtualizationEnabled && currentFolderFiles.length > 30 && (
        <>
          <span className="text-neutral-400 dark:text-neutral-600">·</span>
          <span className="text-amber-500 dark:text-amber-400 font-semibold flex items-center gap-0.5">
            ⚡ 虚拟表格引擎生效
          </span>
        </>
      )}
    </div>
  );
};

export const fileExplorerPlugin: PluginDefinition = {
  id: 'plugin-file-explorer',
  name: '基础文件浏览器',
  version: '1.0.0',
  description: '提供驱动器管理、文件夹折叠树、收藏夹、列表/卡片/画廊多视图，以及右侧详细属性检查器',
  author: 'Workbench Core',
  enabled: true,
  contributions: [
    // 1. Top Breadcrumbs Slot
    {
      id: 'fe-top-breadcrumbs',
      slotId: 'top.breadcrumbs',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <ExplorerBreadcrumbs />,
    },

    // 2. Left Sidebar Tab & Content Slots
    {
      id: 'fe-sidebar-tab',
      slotId: 'sidebar.left.tabs',
      pluginId: 'plugin-file-explorer',
      title: '资源管理',
      icon: <FolderTree className="w-3.5 h-3.5" />,
      order: 10,
      render: () => null,
    },
    {
      id: 'fe-sidebar-content',
      slotId: 'sidebar.left.content',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <FileTree />,
    },

    // 3. Workspace Toolbar & Views Slots
    {
      id: 'fe-workspace-toolbar',
      slotId: 'workspace.toolbar',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <ExplorerToolbar />,
    },
    {
      id: 'fe-workspace-views',
      slotId: 'workspace.views',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <ExplorerViewDispatcher />,
    },

    // 4. Right Sidebar Tab & Inspector Slot
    {
      id: 'fe-inspector-tab',
      slotId: 'sidebar.right.tabs',
      pluginId: 'plugin-file-explorer',
      title: '属性信息',
      icon: <Info className="w-3.5 h-3.5" />,
      order: 10,
      render: () => null,
    },
    {
      id: 'fe-inspector-content',
      slotId: 'sidebar.right.content',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <FileInspector />,
    },

    // 5. Status Bar Slot
    {
      id: 'fe-statusbar-left',
      slotId: 'statusbar.left',
      pluginId: 'plugin-file-explorer',
      order: 10,
      render: () => <ExplorerStatusBar />,
    },
  ],
};
