import React from 'react';

export type SlotId =
  | 'top.window_controls'
  | 'top.breadcrumbs'
  | 'top.actions'
  | 'sidebar.left.tabs'
  | 'sidebar.left.content'
  | 'workspace.toolbar'
  | 'workspace.views'
  | 'sidebar.right.tabs'
  | 'sidebar.right.content'
  | 'bottom.tabs'
  | 'bottom.toolbar'
  | 'bottom.content'
  | 'statusbar.left'
  | 'statusbar.right';

export interface SlotContribution<P = Record<string, unknown>> {
  id: string;
  slotId: SlotId;
  pluginId: string;
  title?: string;
  icon?: React.ReactNode;
  order?: number;
  badge?: string | number;
  shortcut?: string;
  render: (props: P) => React.ReactNode;
}

export interface PluginDefinition {
  id: string;
  name: string;
  version: string;
  description: string;
  author?: string;
  enabled?: boolean;
  contributions: SlotContribution[];
}

export type ThemeMode = 'light' | 'dark' | 'system';

export type ThemeAccent = 'blue' | 'indigo' | 'emerald' | 'amber' | 'rose' | 'cyan';

export interface ThemeTokens {
  mode: 'light' | 'dark';
  accent: ThemeAccent;
  isDark: boolean;
}

export interface LayoutState {
  leftWidth: number;
  rightWidth: number;
  bottomHeight: number;
  leftCollapsed: boolean;
  rightCollapsed: boolean;
  bottomCollapsed: boolean;
  activeLeftTab: string;
  activeRightTab: string;
  activeBottomTab: string;
  activeWorkspaceView: string;
  zenMode: boolean;
  floatingPanelOpen?: boolean;
  floatingPanelTab?: string;
}


export type FileType =
  | 'folder'
  | 'code'
  | 'image'
  | 'document'
  | 'archive'
  | 'audio'
  | 'video'
  | 'data';

export interface FileItem {
  id: string;
  name: string;
  path: string;
  extension?: string;
  type: FileType;
  size: number; // in bytes (0 for folders)
  modifiedAt: string;
  createdAt: string;
  permissions: string;
  tags?: string[];
  isFavorite?: boolean;
  thumbnail?: string;
  contentPreview?: string;
  lineCount?: number;
  dimensions?: string;
  children?: FileItem[];
  parentId?: string | null;
}

export interface DriveItem {
  id: string;
  name: string;
  letter: string;
  totalBytes: number;
  usedBytes: number;
  type: 'system' | 'data' | 'cloud' | 'removable';
}

export type ExplorerViewMode = 'list' | 'grid' | 'gallery';

export type LogLevel = 'info' | 'warn' | 'error' | 'event' | 'lifecycle';

export interface LogEntry {
  id: string;
  timestamp: string;
  level: LogLevel;
  source: string;
  message: string;
  payload?: Record<string, unknown> | string | number | boolean | null;
  tags?: string[];
}
