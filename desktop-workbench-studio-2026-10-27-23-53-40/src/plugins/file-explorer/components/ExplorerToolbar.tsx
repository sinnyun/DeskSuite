import React, { useState } from 'react';
import { useExplorer } from '../context/ExplorerContext';
import {
  ArrowLeft,
  ArrowRight,
  ArrowUp,
  Copy,
  Check,
  RotateCw,
  Tag,
  Zap,
  Layers,
  ChevronDown,
  Search,
  List,
  LayoutGrid,
  Columns,
  Filter,
} from 'lucide-react';
import { useDebug } from '../../debug-console/context/DebugContext';

export const ExplorerToolbar: React.FC = () => {
  const {
    currentPath,
    navigateToFolder,
    allFlatFiles,
    virtualizationEnabled,
    toggleVirtualization,
    datasetMode,
    loadDataset,
    currentFolderFiles,
    searchQuery,
    setSearchQuery,
    viewMode,
    setViewMode,
    categoryFilter,
    setCategoryFilter,
    sortField,
    setSortField,
    sortOrder,
    setSortOrder,
  } = useExplorer();
  const { addLog } = useDebug();

  const [copied, setCopied] = useState(false);
  const [datasetDropdownOpen, setDatasetDropdownOpen] = useState(false);
  const [activeFilterDropdown, setActiveFilterDropdown] = useState<string | null>(null);
  const [zoomLevel, setZoomLevel] = useState<number>(50);
  const [selectedTag, setSelectedTag] = useState<string>('all');
  const [selectedExt, setSelectedExt] = useState<string>('all');
  const [selectedDate, setSelectedDate] = useState<string>('all');
  const [selectedRating, setSelectedRating] = useState<string>('all');
  const [selectedGrouping, setSelectedGrouping] = useState<string>('subfolder');

  const toggleDropdown = (id: string) => {
    setActiveFilterDropdown((curr) => (curr === id ? null : id));
  };

  const handleCopyPath = () => {
    navigator.clipboard.writeText(
      currentPath ? `F:\\AI\\geren\\pho_cordis\\test-data\\${currentPath.replace(/^\//, '')}` : 'F:\\AI\\geren\\pho_cordis\\test-data\\fileatlas-fixtures'
    );
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const handleGoUp = () => {
    if (!currentPath || currentPath === '/') return;
    const parts = currentPath.split('/').filter(Boolean);
    parts.pop();
    const parentPath = parts.length === 0 ? '/' : '/' + parts.join('/');
    const parentFolder = allFlatFiles.find((f) => f.path === parentPath && f.type === 'folder') || null;
    navigateToFolder(parentFolder);
  };

  const handleDatasetChange = (mode: 'default' | '1k' | '5k' | '10k') => {
    loadDataset(mode);
    setDatasetDropdownOpen(false);
    if (mode === 'default') {
      addLog('lifecycle', 'DatasetEngine', '已还原为标准工程文件集 (12 项)');
    } else {
      const count = mode === '1k' ? '1,000' : mode === '5k' ? '5,000' : '10,000';
      addLog(
        'event',
        'VirtualEngine',
        `已成功挂载海量测试数据集: ${count} 项文件记录，虚拟滑动窗口优化启动`,
        { count, mode, viewportWindowSize: 20 }
      );
    }
  };

  return (
    <div className="flex flex-col gap-2 select-none w-full text-xs font-sans">
      {/* Tier 1: Path Navigation, Address Pill, Search, and Virtualization Engine */}
      <div className="flex items-center justify-between gap-2">
        {/* Navigation Arrows + Breadcrumb Bar + Action Buttons */}
        <div className="flex items-center gap-1.5 min-w-0 flex-1">
          {/* Back/Forward/Up */}
          <div className="flex items-center gap-0.5 shrink-0">
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#64748b] hover:text-[#1e293b] cursor-pointer"
              title="后退"
            >
              <ArrowLeft className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#64748b] hover:text-[#1e293b] opacity-40 cursor-not-allowed"
              title="前进"
            >
              <ArrowRight className="w-3.5 h-3.5" />
            </button>
            <button
              type="button"
              onClick={handleGoUp}
              disabled={!currentPath || currentPath === '/'}
              className="w-7 h-7 flex items-center justify-center rounded-full hover:bg-black/[0.05] dark:hover:bg-white/[0.08] text-[#64748b] hover:text-[#1e293b] cursor-pointer disabled:opacity-40"
              title="返回上一级"
            >
              <ArrowUp className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Path Breadcrumbs Input Pill */}
          <div className="flex-1 max-w-lg flex items-center h-8 px-3 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs font-mono text-[#64748b] dark:text-[#94a3b8] overflow-hidden shadow-2xs">
            <span className="truncate">
              F:\ &gt; AI &gt; geren &gt; pho_cordis &gt; test-data &gt;{' '}
              <strong className="text-[#5b5ce6] font-semibold">
                {currentPath && currentPath !== '/' ? currentPath.replace(/^\//, '') : 'fileatlas-fixtures'}
              </strong>
            </span>
          </div>

          {/* Tag full expand pill */}
          <button
            type="button"
            className="hidden sm:flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-[#f5f3ff] text-[#7c3aed] border border-[#ede9fe] dark:bg-[#2e1065]/40 dark:text-[#c084fc] dark:border-[#7c3aed]/40 shrink-0 cursor-pointer"
          >
            <Tag className="w-3 h-3" />
            <span>标签: 完整展开</span>
          </button>

          {/* Go Pill */}
          <button
            type="button"
            className="px-3 py-1 rounded-full text-xs font-semibold bg-[#5b5ce6] text-white hover:bg-[#4e4fcb] shrink-0 cursor-pointer shadow-2xs"
          >
            Go
          </button>

          {/* Copy Path Icon */}
          <button
            type="button"
            onClick={handleCopyPath}
            title={copied ? '已复制绝对路径' : '复制路径'}
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-[#64748b] hover:text-[#1e293b] cursor-pointer shadow-2xs"
          >
            {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5" />}
          </button>

          {/* Refresh Icon */}
          <button
            type="button"
            title="刷新视图"
            className="w-7 h-7 flex items-center justify-center rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-[#64748b] hover:text-[#1e293b] cursor-pointer shadow-2xs"
          >
            <RotateCw className="w-3.5 h-3.5" />
          </button>
        </div>

        {/* Right Search Input + Virtualization Controls */}
        <div className="flex items-center gap-2 shrink-0">
          {/* Search Pill */}
          <div className="relative w-36 sm:w-48">
            <Search className="w-3.5 h-3.5 absolute left-3 top-1/2 -translate-y-1/2 text-[#94a3b8] pointer-events-none" />
            <input
              type="text"
              placeholder="搜索当前目录..."
              value={searchQuery}
              onChange={(e) => setSearchQuery(e.target.value)}
              className="w-full h-7 pl-8 pr-7 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs text-[#1e293b] dark:text-white placeholder:text-[#94a3b8] focus:outline-none focus:border-[#5b5ce6] transition-all shadow-2xs"
            />
            {searchQuery && (
              <button
                type="button"
                onClick={() => setSearchQuery('')}
                className="absolute right-2.5 top-1/2 -translate-y-1/2 text-xs text-[#94a3b8] hover:text-[#1e293b] cursor-pointer"
              >
                ✕
              </button>
            )}
          </div>

          {/* Virtualization Toggle Pill */}
          <button
            type="button"
            onClick={toggleVirtualization}
            title={
              virtualizationEnabled
                ? '虚拟行优化已启用（仅挂载可视 DOM，60FPS 极速滚动）'
                : '点击开启海量数据虚拟行与虚拟表格优化'
            }
            className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
              virtualizationEnabled
                ? 'bg-[#ecfdf5] text-[#059669] border-[#d1fae5] dark:bg-[#064e3b]/40 dark:text-[#34d399] dark:border-[#059669]/40'
                : 'bg-white text-[#64748b] border-[#e2e8f0] dark:bg-[#1a1e27] dark:border-[#2a3140]'
            }`}
          >
            <Zap className={`w-3 h-3 ${virtualizationEnabled ? 'text-emerald-500' : 'text-[#94a3b8]'}`} />
            <span className="hidden sm:inline">{virtualizationEnabled ? '虚拟化: 开' : '虚拟化: 关'}</span>
          </button>

          {/* Dataset Scale Benchmark Dropdown */}
          <div className="relative">
            <button
              type="button"
              onClick={() => setDatasetDropdownOpen((o) => !o)}
              title="切换测试数据规模 (1k / 5k / 10k)"
              className={`flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                datasetMode !== 'default'
                  ? 'bg-[#eef2ff] text-[#5b5ce6] border-[#5b5ce6]/40'
                  : 'bg-white text-[#64748b] border-[#e2e8f0] dark:bg-[#1a1e27] dark:border-[#2a3140]'
              }`}
            >
              <Layers className="w-3 h-3" />
              <span>{datasetMode === 'default' ? '数据规模' : `${datasetMode.toUpperCase()}`}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>

            {datasetDropdownOpen && (
              <div
                onMouseLeave={() => setDatasetDropdownOpen(false)}
                className="absolute right-0 top-full mt-1.5 w-44 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-lg p-1 z-40"
              >
                <div className="px-2 py-1 text-[10px] font-semibold text-[#94a3b8] uppercase tracking-wider">
                  海量数据虚拟化基准
                </div>
                <button
                  type="button"
                  onClick={() => handleDatasetChange('default')}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs hover:bg-[#f1f5f9] dark:hover:bg-[#222834] cursor-pointer"
                >
                  <span>标准示例集</span>
                  <span className="font-mono text-[10px] text-[#94a3b8]">12 项</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDatasetChange('1k')}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs hover:bg-[#f1f5f9] dark:hover:bg-[#222834] text-[#5b5ce6] font-semibold cursor-pointer"
                >
                  <span>⚡ 虚拟表格测试</span>
                  <span className="font-mono text-[10px]">1,000 项</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDatasetChange('5k')}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs hover:bg-[#f1f5f9] dark:hover:bg-[#222834] text-[#5b5ce6] font-semibold cursor-pointer"
                >
                  <span>⚡ 深度压力测试</span>
                  <span className="font-mono text-[10px]">5,000 项</span>
                </button>
                <button
                  type="button"
                  onClick={() => handleDatasetChange('10k')}
                  className="w-full flex items-center justify-between px-2.5 py-1.5 rounded-xl text-xs hover:bg-[#f1f5f9] dark:hover:bg-[#222834] text-[#5b5ce6] font-bold cursor-pointer"
                >
                  <span>⚡ 极限性能测试</span>
                  <span className="font-mono text-[10px]">10,000 项</span>
                </button>
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Tier 2: Migrated File Filters, View Modes (List/Grid/Gallery) & Zoom Slider */}
      <div className="flex items-center justify-between gap-2 pt-1 border-t border-[#e2e8f0]/60 dark:border-[#2a3140]/60 overflow-x-auto no-scrollbar">
        {/* Left Filter Pills Row */}
        <div className="flex items-center gap-1.5 shrink-0">
          {/* Pill 1: Type Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleDropdown('type')}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                categoryFilter !== 'all'
                  ? 'bg-[#eef2ff] border-[#5b5ce6] text-[#5b5ce6] font-semibold'
                  : 'bg-white hover:bg-[#f8fafc] text-[#475569] border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140]'
              }`}
            >
              <span>{categoryFilter === 'all' ? '全部类型' : categoryFilter}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeFilterDropdown === 'type' && (
              <div
                onMouseLeave={() => setActiveFilterDropdown(null)}
                className="absolute left-0 top-full mt-1.5 w-36 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-lg p-1.5 z-40"
              >
                {[
                  { id: 'all', label: '全部类型' },
                  { id: 'image', label: '图片资产' },
                  { id: 'code', label: '源代码' },
                  { id: 'document', label: '文档规范' },
                  { id: 'data', label: '数据配置' },
                ].map((item) => (
                  <button
                    key={item.id}
                    type="button"
                    onClick={() => {
                      setCategoryFilter(item.id as any);
                      setActiveFilterDropdown(null);
                    }}
                    className={`w-full text-left px-2.5 py-1.5 rounded-xl text-xs cursor-pointer ${
                      categoryFilter === item.id
                        ? 'bg-[#eef2ff] text-[#5b5ce6] font-semibold'
                        : 'text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#222834]'
                    }`}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pill 2: Tag Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleDropdown('tag')}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                selectedTag !== 'all'
                  ? 'bg-[#eef2ff] border-[#5b5ce6] text-[#5b5ce6] font-semibold'
                  : 'bg-white hover:bg-[#f8fafc] text-[#475569] border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140]'
              }`}
            >
              <span>{selectedTag === 'all' ? '标签' : selectedTag}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeFilterDropdown === 'tag' && (
              <div
                onMouseLeave={() => setActiveFilterDropdown(null)}
                className="absolute left-0 top-full mt-1.5 w-36 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-lg p-1.5 z-40"
              >
                {['全部标签', '投放渠道', '设计资产', '主视觉', '主题背景', '规范模板'].map((tag) => (
                  <button
                    key={tag}
                    type="button"
                    onClick={() => {
                      setSelectedTag(tag === '全部标签' ? 'all' : tag);
                      setActiveFilterDropdown(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] cursor-pointer"
                  >
                    {tag}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pill 3: Extension Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleDropdown('ext')}
              className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium border transition-colors cursor-pointer ${
                selectedExt !== 'all'
                  ? 'bg-[#eef2ff] border-[#5b5ce6] text-[#5b5ce6] font-semibold'
                  : 'bg-white hover:bg-[#f8fafc] text-[#475569] border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140]'
              }`}
            >
              <span>{selectedExt === 'all' ? '扩展名' : selectedExt}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeFilterDropdown === 'ext' && (
              <div
                onMouseLeave={() => setActiveFilterDropdown(null)}
                className="absolute left-0 top-full mt-1.5 w-36 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-lg p-1.5 z-40"
              >
                {['全部扩展名', '.png', '.jpg', '.txt', '.json', '.ts', '.svg'].map((ext) => (
                  <button
                    key={ext}
                    type="button"
                    onClick={() => {
                      setSelectedExt(ext === '全部扩展名' ? 'all' : ext);
                      setActiveFilterDropdown(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] cursor-pointer"
                  >
                    {ext}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pill 4: Date Filter */}
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-white hover:bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140] transition-colors cursor-pointer"
          >
            <span>日期</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Pill 5: Rating Filter */}
          <button
            type="button"
            className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-white hover:bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140] transition-colors cursor-pointer"
          >
            <span className="text-amber-500">★</span>
            <span>评分</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>

          {/* Pill 6: Sort Filter */}
          <div className="relative">
            <button
              type="button"
              onClick={() => toggleDropdown('sort')}
              className="flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium bg-white hover:bg-[#f8fafc] text-[#475569] border border-[#e2e8f0] dark:bg-[#1a1e27] dark:hover:bg-[#222834] dark:text-[#94a3b8] dark:border-[#2a3140] transition-colors cursor-pointer"
            >
              <span>{sortField === 'modifiedAt' ? '最新修改' : sortField === 'size' ? '按大小' : sortField === 'type' ? '按类型' : '最新优先'}</span>
              <ChevronDown className="w-3 h-3 opacity-60" />
            </button>
            {activeFilterDropdown === 'sort' && (
              <div
                onMouseLeave={() => setActiveFilterDropdown(null)}
                className="absolute left-0 top-full mt-1.5 w-36 rounded-2xl bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] shadow-lg p-1.5 z-40"
              >
                {[
                  { id: 'name', label: '按名称排序' },
                  { id: 'modifiedAt', label: '按修改时间' },
                  { id: 'size', label: '按文件大小' },
                  { id: 'type', label: '按文件种类' },
                ].map((s) => (
                  <button
                    key={s.id}
                    type="button"
                    onClick={() => {
                      setSortField(s.id as any);
                      setActiveFilterDropdown(null);
                    }}
                    className="w-full text-left px-2.5 py-1.5 rounded-xl text-xs text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#222834] cursor-pointer"
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* Pill 7: Grouping */}
          <button
            type="button"
            onClick={() => setSelectedGrouping((prev) => (prev === 'subfolder' ? 'none' : 'subfolder'))}
            className={`flex items-center gap-1 px-3 py-1 rounded-full text-xs font-medium transition-colors cursor-pointer ${
              selectedGrouping === 'subfolder'
                ? 'bg-[#f5f3ff] text-[#7c3aed] border border-[#ede9fe] dark:bg-[#2e1065]/40 dark:text-[#c084fc] dark:border-[#7c3aed]/40'
                : 'bg-white text-[#475569] border border-[#e2e8f0] dark:bg-[#1a1e27] dark:text-[#94a3b8] dark:border-[#2a3140]'
            }`}
          >
            <span>{selectedGrouping === 'subfolder' ? '按子文件夹分组' : '未分组'}</span>
            <ChevronDown className="w-3 h-3 opacity-60" />
          </button>
        </div>

        {/* Right View Modes Switcher & Zoom Slider */}
        <div className="flex items-center gap-2.5 shrink-0 ml-auto">
          {/* Zoom Slider */}
          <div className="hidden md:flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-[#f1f5f9] dark:bg-[#222834] border border-[#e2e8f0] dark:border-[#2a3140] text-xs">
            <span className="text-[10px] text-[#64748b] dark:text-[#94a3b8]">缩放</span>
            <input
              type="range"
              min="20"
              max="100"
              value={zoomLevel}
              onChange={(e) => setZoomLevel(Number(e.target.value))}
              className="w-16 h-1 bg-[#cbd5e1] dark:bg-[#475569] rounded-lg appearance-none cursor-pointer accent-[#5b5ce6]"
            />
            <span className="text-[10px] font-mono text-[#94a3b8]">{zoomLevel}%</span>
          </div>

          {/* View Switcher Pill: List / Grid / Gallery */}
          <div className="flex items-center bg-[#f1f5f9] dark:bg-[#222834] p-0.5 rounded-full border border-[#e2e8f0] dark:border-[#2a3140]">
            <button
              type="button"
              onClick={() => setViewMode('list')}
              title="列表视图"
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'list'
                  ? 'bg-white dark:bg-[#1a1e27] text-[#5b5ce6] shadow-xs font-semibold'
                  : 'text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white'
              }`}
            >
              <List className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">列表</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('grid')}
              title="网格卡片视图"
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'grid'
                  ? 'bg-white dark:bg-[#1a1e27] text-[#5b5ce6] shadow-xs font-semibold'
                  : 'text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white'
              }`}
            >
              <LayoutGrid className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">网格</span>
            </button>
            <button
              type="button"
              onClick={() => setViewMode('gallery')}
              title="画廊大图视图"
              className={`flex items-center gap-1 px-2 py-1 rounded-full text-xs font-medium transition-all cursor-pointer ${
                viewMode === 'gallery'
                  ? 'bg-white dark:bg-[#1a1e27] text-[#5b5ce6] shadow-xs font-semibold'
                  : 'text-[#64748b] hover:text-[#1e293b] dark:text-[#94a3b8] dark:hover:text-white'
              }`}
            >
              <Columns className="w-3.5 h-3.5" />
              <span className="hidden sm:inline">画廊</span>
            </button>
          </div>
        </div>
      </div>
    </div>
  );
};
