import React, { useState } from 'react';
import { useExplorer } from '../context/ExplorerContext';
import { getFileIcon } from './FileTree';
import { formatBytes } from '../data/mockFiles';
import {
  Copy,
  Check,
  FolderOpen,
  RotateCw,
  EyeOff,
  Link2,
  Layers,
  BarChart2,
  CloudUpload,
  Calendar,
  FileText,
  Clock,
  Folder,
  Sliders,
  Undo,
  Redo,
  Clipboard,
  Archive,
} from 'lucide-react';
import { DesktopTagPill } from '../../../theme/components';
import { useLayout } from '../../../core/LayoutContext';

export const FileInspector: React.FC = () => {
  const { selectedFile, currentFolderFiles, currentPath } = useExplorer();
  const { openFloatingPanel } = useLayout();
  const [copied, setCopied] = useState(false);
  const [copiedText, setCopiedText] = useState(false);
  const [activeTab, setActiveTab] = useState<'info' | 'tools'>('info');

  const [selectedGrouping, setSelectedGrouping] = useState<string>('subfolder');

  const isTextFile = Boolean(
    selectedFile &&
      (selectedFile.type === 'document' ||
        selectedFile.type === 'code' ||
        ['txt', 'md', 'json', 'ts', 'tsx', 'js', 'py', 'html', 'css', 'yml', 'yaml'].includes(
          selectedFile.extension?.toLowerCase() || ''
        ) ||
        selectedFile.name.endsWith('.txt') ||
        selectedFile.name.endsWith('.json') ||
        selectedFile.name.endsWith('.md'))
  );

  const getTextContent = (file: typeof selectedFile): string => {
    if (!file) return '';
    if (file.name === 'README.txt') {
      return `# FileAtlas Project Fixtures
Version: 2.4.0-preview
Encoding: UTF-8 (LF)
Directory: F:\\AI\\geren\\pho_cordis\\test-data

Overview:
FileAtlas is a high-performance desktop file manager
and asset catalog designed for creative workflows.

Key Directories:
- .dev-support/       : Development helpers, build configs
- 01-small/           : Sample raster & vector graphic assets
- 02-mixed-formats/   : Mixed media, markdown docs, templates
- 03-nested/          : Deep hierarchical directory structures
- 04-no-thumbnail/    : Raw telemetry, JSON configs & caches

Quick Operations:
* 拖拽分屏任意跨栏目排布
* 空格键呼出悬浮资产详情
* 双击快速开启虚拟化滚动测试`;
    }
    if (file.name.endsWith('.json') || file.extension === 'json') {
      return `{
  "name": "${file.name.replace('.json', '')}",
  "version": "2.4.0",
  "private": true,
  "description": "FileAtlas desktop schema",
  "encoding": "UTF-8",
  "tags": ["投放渠道", "设计资产"],
  "sizeBytes": ${file.size || 2048},
  "isSystem": false
}`;
    }
    if (file.name.endsWith('.md') || file.extension === 'md') {
      return `# ${file.name}

## 架构规范说明
这是工程 fixtures 中的规范文档。

- 路径: ${file.path}
- 规格: ${formatBytes(file.size || 1024)}
- 编码: UTF-8 (LF)

### 模块说明
1. 插件自动注册托槽 (Slot System)
2. 响应式布局与折叠侧栏
3. 海量数据虚拟表格 (Virtualizer)`;
    }
    if (file.name.endsWith('.ts') || file.name.endsWith('.tsx') || file.extension === 'ts' || file.extension === 'tsx') {
      return `import React from 'react';

/**
 * FileAtlas Module: ${file.name}
 */
export const Component: React.FC = () => {
  return (
    <div className="atlas-node">
      <h3>${file.name}</h3>
    </div>
  );
};`;
    }
    return `[FileAtlas Text Viewer]
文件名: ${file.name}
文件路径: ${file.path}
文件大小: ${formatBytes(file.size || 1024)}
字符编码: UTF-8
换行格式: LF (Unix)

文件内容已就绪。
可以在此预览、高亮浏览或复制文本源码。`;
  };

  const handleCopyText = (content: string) => {
    navigator.clipboard.writeText(content);
    setCopiedText(true);
    setTimeout(() => setCopiedText(false), 1800);
  };

  const handleCopyPath = () => {
    const fullPath = selectedFile
      ? `F:\\AI\\geren\\pho_cordis\\test-data\\${selectedFile.path.replace(/^\//, '')}`
      : 'F:\\AI\\geren\\pho_cordis\\test-data\\fileatlas-fixtures';
    navigator.clipboard.writeText(fullPath);
    setCopied(true);
    setTimeout(() => setCopied(false), 1800);
  };

  const isFolder = !selectedFile || selectedFile.type === 'folder';
  const displayName = selectedFile ? selectedFile.name : 'fileatlas-fixtures';
  const displayPath = selectedFile
    ? `F:\\AI\\geren\\pho_cordis\\test-data\\${selectedFile.path.replace(/^\//, '')}`
    : 'F:\\AI\\geren\\pho_cordis\\test-data\\fileatlas-fixtures';

  const groupingOptions = [
    { id: 'none', label: '不分组', icon: <Sliders className="w-3.5 h-3.5" /> },
    { id: 'month', label: '按月分组', icon: <Calendar className="w-3.5 h-3.5" /> },
    { id: 'type', label: '按文件类型分组', icon: <FileText className="w-3.5 h-3.5" /> },
    { id: 'mtime', label: '按修改时间分组 (月)', icon: <Clock className="w-3.5 h-3.5" /> },
    { id: 'root', label: '按根文件夹分组', icon: <Folder className="w-3.5 h-3.5" /> },
    { id: 'subfolder', label: '按子文件夹分组', icon: <Layers className="w-3.5 h-3.5" /> },
  ];

  return (
    <div className="flex flex-col h-full select-none overflow-y-auto text-xs font-sans bg-white dark:bg-[#161922]">
      {/* Top Segment Switcher: 信息 / 工具箱 */}
      <div className="flex items-center p-2 border-b border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] gap-1">
        <button
          type="button"
          onClick={() => setActiveTab('info')}
          className={`flex-1 py-1 px-2.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer text-center ${
            activeTab === 'info'
              ? 'bg-white dark:bg-[#222834] text-[#5b5ce6] dark:text-[#7c7df6] shadow-2xs border border-[#e2e8f0] dark:border-[#2a3140]'
              : 'text-[#64748b] hover:text-[#1e293b]'
          }`}
        >
          {isFolder ? '文件夹信息' : '文件信息'}
        </button>
        <button
          type="button"
          onClick={() => setActiveTab('tools')}
          className={`flex-1 py-1 px-2.5 rounded-xl font-semibold text-xs transition-colors cursor-pointer text-center ${
            activeTab === 'tools'
              ? 'bg-white dark:bg-[#222834] text-[#5b5ce6] dark:text-[#7c7df6] shadow-2xs border border-[#e2e8f0] dark:border-[#2a3140]'
              : 'text-[#64748b] hover:text-[#1e293b]'
          }`}
        >
          工具箱与控制
        </button>
      </div>

      {activeTab === 'info' ? (
        <div className="p-3.5 space-y-4">
          {/* 1. Preview Area: Rich Text Content Preview / Image Preview / Folder Summary */}
          {isTextFile && selectedFile ? (
            <div className="rounded-2xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#13161f] shadow-xs overflow-hidden flex flex-col">
              {/* Preview Header */}
              <div className="flex items-center justify-between px-3 py-2 bg-[#f8fafc] dark:bg-[#1a1e27] border-b border-[#e2e8f0] dark:border-[#2a3140]">
                <div className="flex items-center gap-1.5 min-w-0">
                  <span className="px-1.5 py-0.5 rounded text-[10px] font-mono font-bold uppercase bg-[#eef2ff] text-[#5b5ce6] dark:bg-[#252846] dark:text-[#7c7df6]">
                    {selectedFile.extension || 'TXT'}
                  </span>
                  <span className="font-medium text-xs text-[#1e293b] dark:text-white truncate max-w-[120px]">
                    {displayName}
                  </span>
                </div>

                <div className="flex items-center gap-1 shrink-0">
                  <span className="text-[10px] font-mono text-[#94a3b8]">
                    {getTextContent(selectedFile).split('\n').length} 行
                  </span>
                  <span className="text-[#cbd5e1] dark:text-[#334155]">·</span>
                  <span className="text-[10px] font-mono text-[#94a3b8]">UTF-8</span>
                  <button
                    type="button"
                    onClick={() => handleCopyText(getTextContent(selectedFile))}
                    title={copiedText ? '已复制文本内容' : '复制文件文本内容'}
                    className="ml-1 p-1 rounded-md text-[#64748b] hover:text-[#5b5ce6] hover:bg-[#eef2ff] dark:hover:bg-[#252846] transition-colors cursor-pointer"
                  >
                    {copiedText ? (
                      <Check className="w-3.5 h-3.5 text-emerald-500" />
                    ) : (
                      <Copy className="w-3.5 h-3.5" />
                    )}
                  </button>
                </div>
              </div>

              {/* Text Preview Viewport */}
              <div className="p-2.5 max-h-56 overflow-y-auto font-mono text-[11px] leading-relaxed select-text bg-[#fafbfc] dark:bg-[#0f1219]">
                <div className="flex">
                  {/* Line Numbers */}
                  <div className="flex flex-col text-right pr-2 text-[#94a3b8]/60 select-none border-r border-[#e2e8f0] dark:border-[#2a3140] mr-2">
                    {getTextContent(selectedFile)
                      .split('\n')
                      .map((_, i) => (
                        <span key={i} className="tabular-nums">
                          {i + 1}
                        </span>
                      ))}
                  </div>
                  {/* Code / Text Lines */}
                  <pre className="flex-1 text-[#334155] dark:text-[#cbd5e1] font-mono whitespace-pre-wrap break-all selection:bg-[#5b5ce6]/20">
                    {getTextContent(selectedFile)}
                  </pre>
                </div>
              </div>
            </div>
          ) : selectedFile && selectedFile.type === 'image' ? (
            <div className="flex flex-col items-center justify-center p-4 rounded-2xl bg-[#f8fafc] dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] text-center shadow-xs">
              <div className="w-full h-28 rounded-xl bg-gradient-to-br from-indigo-50 to-purple-100 dark:from-indigo-950/40 dark:to-purple-950/40 flex items-center justify-center border border-dashed border-[#cbd5e1] dark:border-[#334155] relative overflow-hidden">
                <div className="w-12 h-12 flex items-center justify-center text-[#5b5ce6]">
                  {getFileIcon(selectedFile, 'w-10 h-10')}
                </div>
                <span className="absolute bottom-1.5 right-2 px-1.5 py-0.5 rounded text-[10px] font-mono bg-black/60 text-white">
                  1920 × 1080 · sRGB
                </span>
              </div>
              <span className="font-bold text-xs text-[#1e293b] dark:text-white mt-2 truncate max-w-full">
                {displayName}
              </span>
              <span className="text-[10px] text-[#94a3b8] font-mono mt-0.5 truncate max-w-full">
                {displayPath}
              </span>
            </div>
          ) : (
            <div className="flex flex-col items-center justify-center p-5 rounded-2xl bg-[#fffbeb] dark:bg-[#2b2416] border border-[#fef3c7] dark:border-[#45381d] text-center shadow-xs">
              <div className="w-16 h-14 mb-2 flex items-center justify-center text-[#f59e0b]">
                {selectedFile && selectedFile.type !== 'folder' ? (
                  getFileIcon(selectedFile, 'w-12 h-12')
                ) : (
                  <svg
                    className="w-14 h-12 fill-[#fef3c7] stroke-[#f59e0b] stroke-[1.8]"
                    viewBox="0 0 24 24"
                    strokeLinecap="round"
                    strokeLinejoin="round"
                  >
                    <path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z" />
                  </svg>
                )}
              </div>
              <span className="font-bold text-sm text-[#1e293b] dark:text-white truncate max-w-full">
                {displayName}
              </span>
              <span className="text-[10px] text-[#94a3b8] font-mono mt-1 truncate max-w-full">
                {displayPath}
              </span>
            </div>
          )}

          {/* 2. FileAtlas Details Box */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              {isFolder ? '文件夹详情' : '属性规格'}
            </span>
            <div className="rounded-2xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] divide-y divide-[#e2e8f0] dark:divide-[#2a3140] text-xs">
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#64748b]">名称</span>
                <span className="font-semibold text-[#1e293b] dark:text-white truncate max-w-[160px]">
                  {displayName}
                </span>
              </div>
              <div className="flex items-center justify-between p-2.5">
                <span className="text-[#64748b]">{isFolder ? '当前结果' : '文件大小'}</span>
                <span className="font-mono text-[#1e293b] dark:text-white">
                  {isFolder ? `${currentFolderFiles.length} 项` : formatBytes(selectedFile?.size || 0)}
                </span>
              </div>
              {isFolder ? (
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#64748b]">子文件夹</span>
                  <span className="font-mono text-[#1e293b] dark:text-white">5 个</span>
                </div>
              ) : (
                <div className="flex items-center justify-between p-2.5">
                  <span className="text-[#64748b]">修改时间</span>
                  <span className="font-mono text-[#1e293b] dark:text-white text-[11px]">
                    {selectedFile?.modifiedAt}
                  </span>
                </div>
              )}
            </div>
          </div>

          {/* 3. Location & Copy Path */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              位置
            </span>
            <div className="p-2.5 rounded-2xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] flex flex-col gap-2">
              <span className="font-mono text-[11px] text-[#64748b] break-all">
                {displayPath}
              </span>
              <button
                type="button"
                onClick={handleCopyPath}
                className="w-full py-1.5 px-3 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#222834] text-xs font-medium text-[#1e293b] dark:text-white hover:border-[#5b5ce6] flex items-center justify-center gap-1.5 transition-colors cursor-pointer shadow-2xs"
              >
                {copied ? <Check className="w-3.5 h-3.5 text-emerald-500" /> : <Copy className="w-3.5 h-3.5 text-[#64748b]" />}
                <span>{copied ? '已复制路径' : '复制路径'}</span>
              </button>
            </div>
          </div>

          {/* 4. Engine Status */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              浏览状态
            </span>
            <div className="p-2.5 rounded-2xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] flex items-center justify-between">
              <span className="text-[#64748b]">引擎状态</span>
              <div className="flex items-center gap-1.5 font-medium text-[#059669]">
                <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse" />
                <span>就绪</span>
              </div>
            </div>
          </div>

          {/* 5. Rounded-full Action Buttons */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              操作
            </span>
            <div className="flex items-center gap-2">
              <button
                type="button"
                className="flex-1 py-2 px-3 rounded-full bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] text-xs font-semibold text-[#1e293b] dark:text-white hover:bg-[#f8fafc] flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <FolderOpen className="w-3.5 h-3.5 text-[#5b5ce6]" />
                <span>打开文件夹</span>
              </button>
              <button
                type="button"
                className="flex-1 py-2 px-3 rounded-full bg-white dark:bg-[#1a1e27] border border-[#e2e8f0] dark:border-[#2a3140] text-xs font-semibold text-[#1e293b] dark:text-white hover:bg-[#f8fafc] flex items-center justify-center gap-1.5 shadow-2xs transition-colors cursor-pointer"
              >
                <RotateCw className="w-3.5 h-3.5 text-[#64748b]" />
                <span>刷新</span>
              </button>
            </div>
          </div>
        </div>
      ) : (
        /* FileAtlas Toolbox & View Controls Pane */
        <div className="p-3.5 space-y-4">
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              常用工具
            </span>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] text-left text-xs font-medium text-[#1e293b] dark:text-white hover:bg-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <EyeOff className="w-4 h-4 text-[#64748b]" />
                <span>隐藏缩略图</span>
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] text-left text-xs font-medium text-[#1e293b] dark:text-white hover:bg-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Link2 className="w-4 h-4 text-[#64748b]" />
                <span>重新链接缺失文件</span>
              </button>
              <button
                type="button"
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] text-left text-xs font-medium text-[#1e293b] dark:text-white hover:bg-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <Layers className="w-4 h-4 text-[#64748b]" />
                <span>批量操作...</span>
              </button>
              <button
                type="button"
                onClick={() => openFloatingPanel('analytics')}
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] text-left text-xs font-medium text-[#1e293b] dark:text-white hover:bg-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <BarChart2 className="w-4 h-4 text-[#5b5ce6]" />
                <span>资产统计分析 (打开悬浮面板)</span>
              </button>
              <button
                type="button"
                onClick={() => openFloatingPanel('basket')}
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-[#fafbfd] dark:bg-[#1a1e27] text-left text-xs font-medium text-[#1e293b] dark:text-white hover:bg-white flex items-center gap-2 transition-colors cursor-pointer"
              >
                <CloudUpload className="w-4 h-4 text-[#64748b]" />
                <span>导出元数据</span>
              </button>
            </div>
          </div>

          {/* Grouping Radio List */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              查看与分组
            </span>
            <div className="flex flex-col gap-1 rounded-2xl border border-[#e2e8f0] dark:border-[#2a3140] p-1.5 bg-[#fafbfd] dark:bg-[#1a1e27]">
              {groupingOptions.map((opt) => {
                const isSelected = selectedGrouping === opt.id;
                return (
                  <button
                    key={opt.id}
                    type="button"
                    onClick={() => setSelectedGrouping(opt.id)}
                    className={`flex items-center gap-2 px-2.5 py-1.5 rounded-xl text-xs font-medium transition-colors cursor-pointer ${
                      isSelected
                        ? 'bg-[#5b5ce6] text-white shadow-2xs font-semibold'
                        : 'text-[#475569] dark:text-[#cbd5e1] hover:bg-white dark:hover:bg-[#222834]'
                    }`}
                  >
                    {opt.icon}
                    <span>{opt.label}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Workbench Shortcuts */}
          <div className="space-y-2">
            <span className="text-[11px] font-semibold text-[#64748b] dark:text-[#94a3b8] uppercase tracking-wider">
              工作台辅助
            </span>
            <div className="flex flex-col gap-1.5">
              <button
                type="button"
                onClick={() => openFloatingPanel('clipboard')}
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs font-medium text-[#1e293b] dark:text-white hover:border-[#5b5ce6] flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
              >
                <Clipboard className="w-4 h-4 text-[#5b5ce6]" />
                <span>打开剪贴板工作台 (悬浮窗口)</span>
              </button>
              <button
                type="button"
                onClick={() => openFloatingPanel('basket')}
                className="w-full py-2 px-3 rounded-xl border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs font-medium text-[#1e293b] dark:text-white hover:border-[#5b5ce6] flex items-center gap-2 transition-colors cursor-pointer shadow-2xs"
              >
                <Archive className="w-4 h-4 text-[#5b5ce6]" />
                <span>打开文件暂存篮 (悬浮窗口)</span>
              </button>

              <div className="flex items-center gap-2 pt-1">
                <button
                  type="button"
                  className="flex-1 py-1.5 px-3 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs text-[#64748b] hover:text-[#1e293b] flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Undo className="w-3.5 h-3.5" />
                  <span>撤销</span>
                </button>
                <button
                  type="button"
                  className="flex-1 py-1.5 px-3 rounded-full border border-[#e2e8f0] dark:border-[#2a3140] bg-white dark:bg-[#1a1e27] text-xs text-[#64748b] hover:text-[#1e293b] flex items-center justify-center gap-1 cursor-pointer"
                >
                  <Redo className="w-3.5 h-3.5" />
                  <span>重做</span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
