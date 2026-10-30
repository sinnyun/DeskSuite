import React, { useState } from 'react';
import {
  Folder,
  FolderOpen,
  ChevronRight,
  ChevronDown,
  HardDrive,
  MoreHorizontal,
  Plus,
  Home,
  FileText,
  Image as ImageIcon,
  Film,
  Music,
  Download,
  FileCode,
  FileJson,
  FileArchive,
  File,
  Star,
} from 'lucide-react';
import { useExplorer } from '../context/ExplorerContext';
import { FileItem } from '../../../types/workbench';

export const getFileIcon = (file: FileItem, className = 'w-4 h-4') => {
  if (file.type === 'folder') {
    return <Folder className={`${className} text-[#f59e0b] fill-[#fffbeb]`} />;
  }
  if (file.type === 'code') {
    return <FileCode className={`${className} text-[#5b5ce6]`} />;
  }
  if (file.type === 'image') {
    return <ImageIcon className={`${className} text-[#059669]`} />;
  }
  if (file.type === 'data') {
    return <FileJson className={`${className} text-[#d97706]`} />;
  }
  if (file.type === 'document') {
    return <FileText className={`${className} text-[#2563eb]`} />;
  }
  if (file.type === 'archive') {
    return <FileArchive className={`${className} text-[#7c3aed]`} />;
  }
  return <File className={`${className} text-[#64748b]`} />;
};

export const FileTree: React.FC = () => {
  const {
    files,
    drives,
    currentPath,
    selectedFile,
    expandedFolderIds,
    toggleFolderExpanded,
    navigateToFolder,
    selectFile,
  } = useExplorer();

  const [drivesOpen, setDrivesOpen] = useState(true);
  const [quickAccessOpen, setQuickAccessOpen] = useState(true);
  const [fixturesOpen, setFixturesOpen] = useState(true);

  const quickAccessItems = [
    { name: '桌面', icon: <Home className="w-3.5 h-3.5 text-[#f59e0b]" /> },
    { name: '文档', icon: <FileText className="w-3.5 h-3.5 text-[#2563eb]" /> },
    { name: '图片', icon: <ImageIcon className="w-3.5 h-3.5 text-[#059669]" /> },
    { name: '视频', icon: <Film className="w-3.5 h-3.5 text-[#e11d48]" /> },
    { name: '音乐', icon: <Music className="w-3.5 h-3.5 text-[#7c3aed]" /> },
    { name: '下载', icon: <Download className="w-3.5 h-3.5 text-[#0284c7]" /> },
  ];

  // Recursive tree node renderer with dashed guide lines
  const renderTreeItem = (item: FileItem, depth = 0) => {
    const isFolder = item.type === 'folder';
    const isExpanded = expandedFolderIds.has(item.id);
    const isSelected = selectedFile?.id === item.id;
    const isCurrentFolder = currentPath === item.path;

    return (
      <div key={item.id} className="relative select-none text-xs">
        <div
          onClick={() => {
            if (isFolder) {
              navigateToFolder(item);
            } else {
              selectFile(item);
            }
          }}
          className={`group relative flex items-center gap-1.5 h-7 px-2 rounded-xl cursor-pointer transition-colors box-border border ${
            isSelected || isCurrentFolder
              ? 'bg-[#eef2ff] text-[#5b5ce6] font-medium border-[#5b5ce6]/30 dark:bg-[#252846] dark:text-[#7c7df6]'
              : 'border-transparent text-[#475569] dark:text-[#cbd5e1] hover:bg-[#f1f5f9] dark:hover:bg-[#1f2430]'
          }`}
        >
          {/* Horizontal dashed branch connector */}
          {depth > 0 && (
            <div
              className="absolute -left-3.5 top-1/2 w-3.5 border-t border-dashed border-[#cbd5e1] dark:border-[#475569] pointer-events-none"
              style={{ transform: 'translateY(-50%)' }}
            />
          )}

          {/* Folder arrow toggle */}
          {isFolder ? (
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation();
                toggleFolderExpanded(item.id);
              }}
              className="p-0.5 text-[#94a3b8] hover:text-[#1e293b] rounded transition-colors"
            >
              {isExpanded ? (
                <ChevronDown className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            </button>
          ) : (
            <span className="w-3.5" />
          )}

          {/* Icon */}
          {isFolder ? (
            isExpanded ? (
              <FolderOpen className="w-4 h-4 text-[#f59e0b] fill-[#fffbeb] shrink-0" />
            ) : (
              <Folder className="w-4 h-4 text-[#f59e0b] fill-[#fffbeb] shrink-0" />
            )
          ) : (
            <span className="shrink-0">{getFileIcon(item)}</span>
          )}

          {/* Label */}
          <span className="truncate flex-1">{item.name}</span>

          {/* Item Count / Size */}
          {isFolder && item.children && (
            <span className="text-[10px] text-[#94a3b8] font-mono tabular-nums">
              {item.children.length}
            </span>
          )}
        </div>

        {/* Children Container with Vertical Dashed Guide Line */}
        {isFolder && isExpanded && item.children && item.children.length > 0 && (
          <div className="relative ml-4 pl-3.5 border-l border-dashed border-[#cbd5e1] dark:border-[#475569] my-0.5 flex flex-col gap-0.5">
            {item.children.map((child) => renderTreeItem(child, depth + 1))}
          </div>
        )}
      </div>
    );
  };

  return (
    <div className="flex flex-col gap-3 p-2.5 text-xs">
      {/* 1. FileAtlas Drives Section */}
      <div>
        <div
          onClick={() => setDrivesOpen((o) => !o)}
          className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold text-[#475569] dark:text-[#94a3b8] cursor-pointer hover:text-[#1e293b]"
        >
          <div className="flex items-center gap-1.5">
            {drivesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>驱动器</span>
          </div>
          <button type="button" className="p-0.5 text-[#94a3b8] hover:text-[#1e293b]">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {drivesOpen && (
          <div className="flex flex-col gap-0.5 mt-1">
            {drives.map((drive) => {
              const usedGB = Math.round(drive.usedBytes / (1024 * 1024 * 1024));
              const totalGB = Math.round(drive.totalBytes / (1024 * 1024 * 1024));

              return (
                <div
                  key={drive.id}
                  onClick={() => navigateToFolder(null)}
                  className="flex items-center justify-between px-2 py-1 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#1f2430] cursor-pointer text-xs group transition-colors"
                >
                  <div className="flex items-center gap-2 truncate">
                    <HardDrive className="w-3.5 h-3.5 text-[#64748b] group-hover:text-[#5b5ce6] shrink-0" />
                    <span className="font-medium text-[#1e293b] dark:text-white truncate">
                      {drive.letter} {drive.name}
                    </span>
                  </div>
                  <span className="font-mono text-[10px] text-[#94a3b8] tabular-nums shrink-0 ml-1">
                    {usedGB}/{totalGB}
                  </span>
                </div>
              );
            })}
          </div>
        )}
      </div>

      <div className="h-px bg-[#e2e8f0] dark:bg-[#2a3140]" />

      {/* 2. FileAtlas Quick Access */}
      <div>
        <div
          onClick={() => setQuickAccessOpen((o) => !o)}
          className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold text-[#475569] dark:text-[#94a3b8] cursor-pointer hover:text-[#1e293b]"
        >
          <div className="flex items-center gap-1.5">
            {quickAccessOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>快速访问</span>
          </div>
          <button type="button" className="p-0.5 text-[#94a3b8] hover:text-[#1e293b]">
            <Plus className="w-3.5 h-3.5" />
          </button>
        </div>

        {quickAccessOpen && (
          <div className="flex flex-col gap-0.5 mt-1">
            {quickAccessItems.map((item) => (
              <div
                key={item.name}
                className="flex items-center gap-2 px-2 py-1 rounded-xl hover:bg-[#f1f5f9] dark:hover:bg-[#1f2430] cursor-pointer text-xs text-[#475569] dark:text-[#cbd5e1] transition-colors"
              >
                {item.icon}
                <span>{item.name}</span>
              </div>
            ))}
          </div>
        )}
      </div>

      <div className="h-px bg-[#e2e8f0] dark:bg-[#2a3140]" />

      {/* 3. FileAtlas Favorites & Project Fixtures */}
      <div>
        <div
          onClick={() => setFixturesOpen((o) => !o)}
          className="flex items-center justify-between px-1.5 py-1 text-xs font-semibold text-[#475569] dark:text-[#94a3b8] cursor-pointer hover:text-[#1e293b]"
        >
          <div className="flex items-center gap-1.5">
            {fixturesOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            <span>常用</span>
          </div>
          <button type="button" className="p-0.5 text-[#94a3b8] hover:text-[#1e293b]">
            <MoreHorizontal className="w-3.5 h-3.5" />
          </button>
        </div>

        {fixturesOpen && (
          <div className="flex flex-col gap-1 mt-1">
            {/* Top Root highlight container */}
            <div className="border border-[#5b5ce6]/30 dark:border-[#7c7df6]/30 rounded-xl p-1 bg-[#fbfbff] dark:bg-[#1a1e27]">
              <div className="flex items-center gap-1.5 px-2 py-1 font-semibold text-[#5b5ce6] dark:text-[#7c7df6] text-xs">
                <Folder className="w-3.5 h-3.5 text-[#5b5ce6]" />
                <span className="truncate">fileatlas-fixtures</span>
              </div>

              {/* Hierarchical files tree with dashed guide lines */}
              <div className="flex flex-col gap-0.5 pl-2 pt-1">
                {files.map((file) => renderTreeItem(file, 0))}
              </div>
            </div>

            {/* Add new group button */}
            <button
              type="button"
              className="mt-2 w-full py-1.5 px-3 rounded-full border border-dashed border-[#cbd5e1] hover:border-[#5b5ce6] text-xs text-[#64748b] hover:text-[#5b5ce6] flex items-center justify-center gap-1 transition-colors cursor-pointer"
            >
              <Plus className="w-3 h-3" />
              <span>新建分组</span>
            </button>
          </div>
        )}
      </div>
    </div>
  );
};
