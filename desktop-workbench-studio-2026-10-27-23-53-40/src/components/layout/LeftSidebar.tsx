import React, { useState } from 'react';
import { useLayout } from '../../core/LayoutContext';
import { useSlotRegistry, SlotRenderer } from '../../core/SlotRegistry';
import { ThemeActivityRail, ThemeSidebarPanel, ActivityRailItem } from '../../theme/panels';
import {
  Folder,
  Tag,
  FolderTree,
  Puzzle,
  Terminal,
  Clipboard,
  Camera,
  Archive,
  BarChart3,
  Database,
  Sliders,
  Settings,
  Sparkles,
  Cloud,
} from 'lucide-react';

export const LeftSidebar: React.FC = () => {
  const {
    leftWidth,
    leftCollapsed,
    setLeftCollapsed,
    toggleLeftCollapsed,
    activeLeftTab,
    setActiveLeftTab,
    openFloatingPanel,
    toggleFloatingPanel,
  } = useLayout();

  const { getSlotContributions } = useSlotRegistry();
  const tabContributions = getSlotContributions('sidebar.left.tabs');

  // Currently active activity in the permanent slim rail
  const [activeActivity, setActiveActivity] = useState<string>('files');

  // Activity click handler: either opens/toggles the secondary drawer, or launches the floating panel!
  const handleActivityClick = (id: string) => {
    setActiveActivity(id);

    if (id === 'files' || id === 'tags' || id === 'tree') {
      // If clicking drawer-associated plugins:
      if (leftCollapsed) {
        setLeftCollapsed(false);
      } else if (activeActivity === id) {
        // Clicking same open activity toggles drawer collapse
        toggleLeftCollapsed();
      }
      setActiveLeftTab(id);
    } else if (id === 'clipboard') {
      openFloatingPanel('clipboard');
    } else if (id === 'basket') {
      openFloatingPanel('basket');
    } else if (id === 'analytics') {
      openFloatingPanel('analytics');
    } else if (id === 'plugins') {
      openFloatingPanel('marketplace');
    } else if (id === 'database') {
      openFloatingPanel('database');
    } else if (id === 'screenshot') {
      openFloatingPanel('clipboard');
    } else if (id === 'scripts') {
      openFloatingPanel('marketplace');
    }
  };

  // Full rich stream of plugin icons simulating future plugin registrations
  const activityItems: ActivityRailItem[] = [
    {
      id: 'files',
      label: '文件',
      icon: <Folder className="w-4 h-4" />,
      active: activeActivity === 'files' && !leftCollapsed,
      tooltip: '文件浏览器 (展开/折叠侧栏)',
      onClick: () => handleActivityClick('files'),
    },
    {
      id: 'tags',
      label: '标签',
      icon: <Tag className="w-4 h-4" />,
      active: activeActivity === 'tags' && !leftCollapsed,
      tooltip: '多维标签分类器',
      onClick: () => handleActivityClick('tags'),
    },
    {
      id: 'tree',
      label: '项目树',
      icon: <FolderTree className="w-4 h-4" />,
      active: activeActivity === 'tree' && !leftCollapsed,
      tooltip: '工程层级目录树',
      onClick: () => handleActivityClick('tree'),
    },
    {
      id: 'plugins',
      label: '扩展',
      icon: <Puzzle className="w-4 h-4" />,
      badge: '3',
      tooltip: '插件扩展中心 (打开通用悬浮面板)',
      onClick: () => handleActivityClick('plugins'),
    },
    {
      id: 'scripts',
      label: '脚本',
      icon: <Terminal className="w-4 h-4" />,
      tooltip: '自动化执行脚本',
      onClick: () => handleActivityClick('scripts'),
    },
    {
      id: 'clipboard',
      label: '剪贴板',
      icon: <Clipboard className="w-4 h-4" />,
      tooltip: '剪贴板工作台 (打开通用悬浮面板)',
      onClick: () => handleActivityClick('clipboard'),
    },
    {
      id: 'screenshot',
      label: '截图',
      icon: <Camera className="w-4 h-4" />,
      tooltip: '截图标注与资产捕获',
      onClick: () => handleActivityClick('screenshot'),
    },
    {
      id: 'basket',
      label: '暂存篮',
      icon: <Archive className="w-4 h-4" />,
      badge: '3',
      tooltip: '文件暂存篮 (打开通用悬浮面板)',
      onClick: () => handleActivityClick('basket'),
    },
    {
      id: 'analytics',
      label: '统计',
      icon: <BarChart3 className="w-4 h-4" />,
      tooltip: '资产统计分析 (打开通用悬浮面板)',
      onClick: () => handleActivityClick('analytics'),
    },
    {
      id: 'database',
      label: '数据库',
      icon: <Database className="w-4 h-4" />,
      tooltip: '元数据库连接器 (打开通用悬浮面板)',
      onClick: () => handleActivityClick('database'),
    },
    {
      id: 'cloud',
      label: '协同',
      icon: <Cloud className="w-4 h-4" />,
      tooltip: '云端协同驱动器',
      onClick: () => handleActivityClick('cloud'),
    },
  ];

  // Bottom action icons for permanent rail
  const bottomActivityItems: ActivityRailItem[] = [
    {
      id: 'floating-toggle',
      label: '悬浮窗',
      icon: <Sparkles className="w-4 h-4 text-[#5b5ce6]" />,
      tooltip: '切换通用悬浮面板 (可拖动/调整大小)',
      onClick: () => toggleFloatingPanel(),
    },
    {
      id: 'settings',
      label: '设置',
      icon: <Settings className="w-4 h-4 text-[#94a3b8]" />,
      tooltip: '工作台全局配置',
      onClick: () => openFloatingPanel('marketplace'),
    },
  ];

  const tabs =
    tabContributions.length > 0
      ? tabContributions.map((t) => ({
          id: t.id,
          title: t.title || '资源管理',
          icon: t.icon,
        }))
      : [{ id: 'files', title: '资源管理', icon: <Folder className="w-3.5 h-3.5" /> }];

  return (
    <div className="flex h-full shrink-0 select-none overflow-hidden z-20">
      {/* 1. Permanent Slim Activity Rail - 一直显示的折叠左侧栏 */}
      <ThemeActivityRail
        items={activityItems}
        bottomItems={bottomActivityItems}
      />

      {/* 2. Expandable Secondary Left Drawer Panel - 在折叠栏展开下的侧面板 */}
      <ThemeSidebarPanel
        title="资源目录"
        tabs={tabs}
        activeTab={activeLeftTab}
        onTabChange={setActiveLeftTab}
        collapsed={leftCollapsed}
        onToggleCollapse={toggleLeftCollapsed}
        width={leftWidth}
        side="left"
      >
        <SlotRenderer
          slotId="sidebar.left.content"
          props={{ activeTab: activeLeftTab }}
          fallback={
            <div className="p-4 text-xs text-[#94a3b8] text-center">暂无挂载的左侧插件内容</div>
          }
        />
      </ThemeSidebarPanel>
    </div>
  );
};
