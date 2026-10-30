import React, { useState } from 'react';
import { useLayout } from '../../core/LayoutContext';
import {
  ThemeFloatingPanel,
  ThemeCollapsibleSection,
} from '../../theme/panels';
import {
  DesktopButton,
  DesktopCard,
  DesktopTagPill,
  DesktopInput,
} from '../../theme/components';
import {
  Clipboard,
  Archive,
  BarChart3,
  Puzzle,
  Database,
  Search,
  Copy,
  Check,
  Trash2,
  Download,
  Share2,
  FileCode,
  Image as ImageIcon,
  FileText,
  HardDrive,
  Sparkles,
  ExternalLink,
  Plus,
} from 'lucide-react';
import { useExplorer } from '../../plugins/file-explorer/context/ExplorerContext';
import { formatBytes } from '../../plugins/file-explorer/data/mockFiles';

export const UniversalFloatingWindow: React.FC = () => {
  const {
    floatingPanelOpen,
    closeFloatingPanel,
    floatingPanelTab,
    setFloatingPanelTab,
  } = useLayout();

  const { currentFolderFiles, selectedFile } = useExplorer();
  const [copiedId, setCopiedId] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  // Sample clipboard entries
  const [clipboardItems, setClipboardItems] = useState([
    {
      id: 'clip-1',
      type: 'code',
      title: 'useVirtualizer.ts 核心计算函数',
      content: 'const startIndex = Math.max(0, Math.floor(scrollTop / itemHeight) - overscan);',
      time: '10 分钟前',
      tag: 'TypeScript',
    },
    {
      id: 'clip-2',
      type: 'text',
      title: '桌面端托槽化插件接口规范说明',
      content: 'export interface SlotContribution<P = Record<string, unknown>> { id: string; slotId: SlotId; ... }',
      time: '25 分钟前',
      tag: '架构规范',
    },
    {
      id: 'clip-3',
      type: 'path',
      title: '当前工程绝对路径',
      content: 'F:\\AI\\geren\\pho_cordis\\test-data\\fileatlas-fixtures',
      time: '1 小时前',
      tag: '文件路径',
    },
  ]);

  // Sample basket items
  const [basketItems, setBasketItems] = useState(
    currentFolderFiles.slice(0, 3).map((f) => ({
      id: f.id,
      name: f.name,
      size: f.size,
      type: f.type,
      tags: f.tags || ['待导出'],
    }))
  );

  // Sample third-party plugins in marketplace
  const [pluginsList, setPluginsList] = useState([
    {
      id: 'p-git',
      name: 'GitLens Desktop Pro',
      author: 'DevTools Lab',
      desc: '在左侧折叠栏与悬浮面板提供实时分支对比与行级提交历史',
      version: 'v2.4.0',
      installed: true,
      category: '版本控制',
    },
    {
      id: 'p-hex',
      name: 'Hex & Binary Inspector',
      author: 'CoreTeam',
      desc: '在通用悬浮面板以十六进制视图审查任意二进制文件结构',
      version: 'v1.1.2',
      installed: true,
      category: '底层逆向',
    },
    {
      id: 'p-sync',
      name: 'Cloud Object Storage Sync',
      author: 'CloudSync Inc.',
      desc: '支持 S3/OSS 多桶同步、端到端加密与文件拖拽备份',
      version: 'v3.0.1',
      installed: false,
      category: '存储协同',
    },
  ]);

  const handleCopyClip = (id: string, text: string) => {
    navigator.clipboard.writeText(text);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 1800);
  };

  const tabs = [
    { id: 'clipboard', label: '剪贴板工作台', icon: <Clipboard className="w-3.5 h-3.5" /> },
    { id: 'basket', label: '文件暂存篮', icon: <Archive className="w-3.5 h-3.5" /> },
    { id: 'analytics', label: '资产统计分析', icon: <BarChart3 className="w-3.5 h-3.5" /> },
    { id: 'marketplace', label: '插件扩展中心', icon: <Puzzle className="w-3.5 h-3.5" /> },
    { id: 'database', label: '数据库连接器', icon: <Database className="w-3.5 h-3.5" /> },
  ];

  const getActiveTabTitle = () => {
    switch (floatingPanelTab) {
      case 'basket':
        return '文件暂存篮 (File Basket)';
      case 'analytics':
        return '资产统计分析 (Asset Analytics)';
      case 'marketplace':
        return '插件扩展中心 (Plugin SDK & Hub)';
      case 'database':
        return '数据库连接器 (Database Tools)';
      default:
        return '剪贴板工作台 (Clipboard Station)';
    }
  };

  return (
    <ThemeFloatingPanel
      isOpen={floatingPanelOpen}
      onClose={closeFloatingPanel}
      title={getActiveTabTitle()}
      icon={<Sparkles className="w-4 h-4 text-[#5b5ce6]" />}
      badge="通用悬浮托槽"
      tabs={tabs}
      activeTab={floatingPanelTab}
      onTabChange={setFloatingPanelTab}
      initialWidth={560}
      initialHeight={460}
      initialX={180}
      initialY={70}
    >
      {/* Tab 1: 剪贴板工作台 (Clipboard) */}
      {floatingPanelTab === 'clipboard' && (
        <div className="flex flex-col h-full space-y-3.5 text-xs">
          <div className="flex items-center justify-between gap-2">
            <DesktopInput
              icon={<Search className="w-3.5 h-3.5" />}
              placeholder="搜索剪贴板文本、代码或路径..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              clearable
              onClear={() => setSearchQuery('')}
            />
            <DesktopButton
              size="xs"
              variant="default"
              icon={<Trash2 className="w-3 h-3 text-[#64748b]" />}
              onClick={() => setClipboardItems([])}
            >
              清空
            </DesktopButton>
          </div>

          <ThemeCollapsibleSection
            title="捕获的历史条目"
            badge={clipboardItems.length}
            defaultOpen={true}
          >
            <div className="flex flex-col gap-2 pt-1">
              {clipboardItems.map((item) => (
                <DesktopCard
                  key={item.id}
                  interactive
                  className="p-3 flex flex-col gap-1.5 border-[#e2e8f0] dark:border-[#2a3140]"
                >
                  <div className="flex items-center justify-between">
                    <div className="flex items-center gap-1.5 font-semibold text-[#1e293b] dark:text-white">
                      {item.type === 'code' ? (
                        <FileCode className="w-3.5 h-3.5 text-[#5b5ce6]" />
                      ) : (
                        <FileText className="w-3.5 h-3.5 text-[#2563eb]" />
                      )}
                      <span>{item.title}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      <span className="text-[10px] text-[#94a3b8]">{item.time}</span>
                      <DesktopTagPill label={item.tag} variant="purple" />
                    </div>
                  </div>

                  <div className="p-2 rounded-xl bg-[#f8fafc] dark:bg-[#12151c] font-mono text-[11px] text-[#475569] dark:text-[#cbd5e1] break-all border border-[#edf2f7] dark:border-[#1f2430]">
                    {item.content}
                  </div>

                  <div className="flex items-center justify-end gap-1.5 pt-1">
                    <DesktopButton
                      size="xs"
                      variant="pill"
                      icon={copiedId === item.id ? <Check className="w-3 h-3 text-emerald-500" /> : <Copy className="w-3 h-3" />}
                      onClick={() => handleCopyClip(item.id, item.content)}
                    >
                      {copiedId === item.id ? '已复制' : '复制到剪贴板'}
                    </DesktopButton>
                  </div>
                </DesktopCard>
              ))}
            </div>
          </ThemeCollapsibleSection>
        </div>
      )}

      {/* Tab 2: 文件暂存篮 (Basket) */}
      {floatingPanelTab === 'basket' && (
        <div className="flex flex-col h-full space-y-3.5 text-xs">
          <div className="p-3 rounded-2xl bg-[#eff6ff] dark:bg-[#1e293b] border border-[#dbeafe] dark:border-[#2563eb]/30 flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Archive className="w-5 h-5 text-[#2563eb]" />
              <div>
                <div className="font-semibold text-[#1e293b] dark:text-white">暂存中项目 ({basketItems.length})</div>
                <div className="text-[10px] text-[#64748b]">
                  可跨目录暂存文件，批量压缩导出或移动归档
                </div>
              </div>
            </div>
            <DesktopButton size="xs" variant="primary" icon={<Download className="w-3 h-3" />}>
              一键打包导出
            </DesktopButton>
          </div>

          <ThemeCollapsibleSection
            title="已暂存文件清单"
            badge={basketItems.length}
            defaultOpen={true}
          >
            <div className="flex flex-col gap-2 pt-1">
              {basketItems.map((item) => (
                <div
                  key={item.id}
                  className="flex items-center justify-between p-2.5 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] shadow-2xs"
                >
                  <div className="flex items-center gap-2 min-w-0">
                    <span className="p-1.5 rounded-lg bg-[#f1f5f9] dark:bg-[#222834]">
                      <FileText className="w-4 h-4 text-[#5b5ce6]" />
                    </span>
                    <div className="truncate">
                      <div className="font-semibold text-[#1e293b] dark:text-white truncate">
                        {item.name}
                      </div>
                      <div className="text-[10px] text-[#94a3b8] font-mono">
                        {formatBytes(item.size)}
                      </div>
                    </div>
                  </div>

                  <div className="flex items-center gap-2">
                    {item.tags.map((t) => (
                      <DesktopTagPill key={t} label={t} variant="blue" />
                    ))}
                    <button
                      type="button"
                      onClick={() => setBasketItems((prev) => prev.filter((x) => x.id !== item.id))}
                      className="p-1 text-[#94a3b8] hover:text-rose-500 cursor-pointer"
                    >
                      <Trash2 className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </div>
              ))}
            </div>
          </ThemeCollapsibleSection>
        </div>
      )}

      {/* Tab 3: 资产统计分析 (Analytics) */}
      {floatingPanelTab === 'analytics' && (
        <div className="flex flex-col h-full space-y-3.5 text-xs">
          <div className="grid grid-cols-3 gap-3">
            <DesktopCard className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-[#64748b]">总文件数</span>
              <span className="text-xl font-bold text-[#1e293b] dark:text-white mt-0.5">
                {currentFolderFiles.length}
              </span>
              <span className="text-[10px] text-emerald-600 font-medium">健康状态</span>
            </DesktopCard>
            <DesktopCard className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-[#64748b]">总占用空间</span>
              <span className="text-xl font-bold text-[#5b5ce6] mt-0.5">
                {formatBytes(currentFolderFiles.reduce((a, b) => a + b.size, 0))}
              </span>
              <span className="text-[10px] text-[#94a3b8]">本地 SSD 缓存</span>
            </DesktopCard>
            <DesktopCard className="p-3 flex flex-col items-center justify-center text-center">
              <span className="text-[10px] text-[#64748b]">标签覆盖率</span>
              <span className="text-xl font-bold text-[#7c3aed] mt-0.5">92%</span>
              <span className="text-[10px] text-purple-600 font-medium">分类完善</span>
            </DesktopCard>
          </div>

          <ThemeCollapsibleSection title="格式与类型占比" defaultOpen={true}>
            <div className="p-3 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] space-y-2.5">
              <div>
                <div className="flex justify-between text-[11px] mb-1 font-medium">
                  <span>图像与视觉资源 (PNG/JPG/WEBP)</span>
                  <span className="font-mono text-[#5b5ce6]">45%</span>
                </div>
                <div className="w-full h-1.5 bg-[#f1f5f9] dark:bg-[#222834] rounded-full overflow-hidden">
                  <div className="h-full bg-[#5b5ce6] rounded-full" style={{ width: '45%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1 font-medium">
                  <span>TypeScript / React 源代码</span>
                  <span className="font-mono text-[#059669]">32%</span>
                </div>
                <div className="w-full h-1.5 bg-[#f1f5f9] dark:bg-[#222834] rounded-full overflow-hidden">
                  <div className="h-full bg-[#059669] rounded-full" style={{ width: '32%' }} />
                </div>
              </div>

              <div>
                <div className="flex justify-between text-[11px] mb-1 font-medium">
                  <span>工程配置与 JSON 规范</span>
                  <span className="font-mono text-[#d97706]">23%</span>
                </div>
                <div className="w-full h-1.5 bg-[#f1f5f9] dark:bg-[#222834] rounded-full overflow-hidden">
                  <div className="h-full bg-[#d97706] rounded-full" style={{ width: '23%' }} />
                </div>
              </div>
            </div>
          </ThemeCollapsibleSection>
        </div>
      )}

      {/* Tab 4: 插件扩展中心 (Marketplace & SDK) */}
      {floatingPanelTab === 'marketplace' && (
        <div className="flex flex-col h-full space-y-3.5 text-xs">
          <div className="p-3 rounded-2xl bg-[#fafbfd] dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140]">
            <div className="flex items-center justify-between">
              <div>
                <div className="font-semibold text-xs text-[#1e293b] dark:text-white">
                  插件化架构与通用主题托槽说明
                </div>
                <div className="text-[11px] text-[#64748b] mt-0.5">
                  第三方插件只需调用统一主题组件，即可无缝嵌入侧栏、工作区及本悬浮面板
                </div>
              </div>
              <DesktopButton size="xs" variant="primary" icon={<Plus className="w-3 h-3" />}>
                注册新插件
              </DesktopButton>
            </div>
          </div>

          <ThemeCollapsibleSection title="已安装扩展插件" badge={pluginsList.length} defaultOpen={true}>
            <div className="flex flex-col gap-2 pt-1">
              {pluginsList.map((p) => (
                <DesktopCard
                  key={p.id}
                  className="p-3 flex items-start justify-between border-[#e2e8f0] dark:border-[#2a3140]"
                >
                  <div className="flex items-start gap-2.5">
                    <div className="p-2 rounded-xl bg-[#eef2ff] dark:bg-[#252846] text-[#5b5ce6]">
                      <Puzzle className="w-4 h-4" />
                    </div>
                    <div>
                      <div className="flex items-center gap-2">
                        <span className="font-semibold text-[#1e293b] dark:text-white">{p.name}</span>
                        <span className="text-[10px] font-mono text-[#94a3b8]">{p.version}</span>
                        <DesktopTagPill label={p.category} variant="blue" />
                      </div>
                      <div className="text-[11px] text-[#64748b] mt-1 leading-relaxed">{p.desc}</div>
                      <div className="text-[10px] text-[#94a3b8] mt-1">开发者: {p.author}</div>
                    </div>
                  </div>

                  <DesktopButton
                    size="xs"
                    variant={p.installed ? 'pill' : 'default'}
                    active={p.installed}
                    onClick={() => {
                      setPluginsList((prev) =>
                        prev.map((item) =>
                          item.id === p.id ? { ...item, installed: !item.installed } : item
                        )
                      );
                    }}
                  >
                    {p.installed ? '已启用' : '安装启用'}
                  </DesktopButton>
                </DesktopCard>
              ))}
            </div>
          </ThemeCollapsibleSection>
        </div>
      )}

      {/* Tab 5: 数据库连接器 (Database) */}
      {floatingPanelTab === 'database' && (
        <div className="flex flex-col h-full space-y-3.5 text-xs">
          <div className="p-3 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140]">
            <div className="flex items-center justify-between">
              <div className="flex items-center gap-2">
                <Database className="w-4 h-4 text-[#5b5ce6]" />
                <span className="font-semibold text-[#1e293b] dark:text-white">本地元数据嵌入库 (SQLite & RocksDB)</span>
              </div>
              <span className="flex items-center gap-1 text-[11px] text-emerald-600 font-medium">
                <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 animate-pulse" />
                已连接
              </span>
            </div>
            <div className="text-[11px] text-[#64748b] mt-1 font-mono">
              F:\AI\geren\pho_cordis\test-data\fileatlas.db (12.4 MB)
            </div>
          </div>

          <ThemeCollapsibleSection title="活跃数据表" defaultOpen={true}>
            <div className="p-2 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#161922] font-mono text-[11px] space-y-1">
              <div className="flex justify-between py-1 px-2 hover:bg-white dark:hover:bg-[#222834] rounded">
                <span>📁 tb_file_metadata</span>
                <span className="text-[#94a3b8]">12 条记录</span>
              </div>
              <div className="flex justify-between py-1 px-2 hover:bg-white dark:hover:bg-[#222834] rounded">
                <span>🏷️ tb_tags_mapping</span>
                <span className="text-[#94a3b8]">36 条关联</span>
              </div>
              <div className="flex justify-between py-1 px-2 hover:bg-white dark:hover:bg-[#222834] rounded">
                <span>⚡ tb_virtual_indices</span>
                <span className="text-[#94a3b8]">10,000 虚拟行缓存</span>
              </div>
            </div>
          </ThemeCollapsibleSection>
        </div>
      )}
    </ThemeFloatingPanel>
  );
};
