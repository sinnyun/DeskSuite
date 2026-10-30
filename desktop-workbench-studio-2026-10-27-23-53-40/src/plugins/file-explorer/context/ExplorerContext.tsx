import React, { createContext, useContext, useMemo, useState } from 'react';
import { ExplorerViewMode, FileItem, FileType } from '../../../types/workbench';
import { MOCK_DRIVES, MOCK_FILES, generateMassiveDataset } from '../data/mockFiles';

interface ExplorerContextType {
  files: FileItem[];
  drives: typeof MOCK_DRIVES;
  currentPath: string;
  selectedFile: FileItem | null;
  selectedFileIds: string[];
  viewMode: ExplorerViewMode;
  searchQuery: string;
  categoryFilter: FileType | 'all';
  sortField: 'name' | 'size' | 'modifiedAt' | 'type';
  sortOrder: 'asc' | 'desc';
  expandedFolderIds: Set<string>;
  virtualizationEnabled: boolean;
  datasetMode: 'default' | '1k' | '5k' | '10k';
  setViewMode: (mode: ExplorerViewMode) => void;
  setSearchQuery: (query: string) => void;
  setCategoryFilter: (category: FileType | 'all') => void;
  setSortField: (field: 'name' | 'size' | 'modifiedAt' | 'type') => void;
  setSortOrder: (order: 'asc' | 'desc') => void;
  setVirtualizationEnabled: (enabled: boolean) => void;
  toggleVirtualization: () => void;
  loadDataset: (mode: 'default' | '1k' | '5k' | '10k') => void;
  selectFile: (file: FileItem | null, multi?: boolean) => void;
  navigateToFolder: (folder: FileItem | null) => void;
  toggleFolderExpanded: (folderId: string) => void;
  toggleStar: (fileId: string) => void;
  currentFolderFiles: FileItem[];
  allFlatFiles: FileItem[];
}

const ExplorerContext = createContext<ExplorerContextType | undefined>(undefined);

export const ExplorerProvider: React.FC<{ children: React.ReactNode }> = ({ children }) => {
  const [files, setFiles] = useState<FileItem[]>(MOCK_FILES);
  const [datasetMode, setDatasetMode] = useState<'default' | '1k' | '5k' | '10k'>('default');
  const [virtualizationEnabled, setVirtualizationEnabled] = useState<boolean>(true);
  const [currentPath, setCurrentPath] = useState<string>('/src');
  const [selectedFileId, setSelectedFileId] = useState<string | null>('f-app-tsx');
  const [selectedFileIds, setSelectedFileIds] = useState<string[]>(['f-app-tsx']);
  const [viewMode, setViewMode] = useState<ExplorerViewMode>('list');
  const [searchQuery, setSearchQuery] = useState<string>('');
  const [categoryFilter, setCategoryFilter] = useState<FileType | 'all'>('all');
  const [sortField, setSortField] = useState<'name' | 'size' | 'modifiedAt' | 'type'>('name');
  const [sortOrder, setSortOrder] = useState<'asc' | 'desc'>('asc');
  const [expandedFolderIds, setExpandedFolderIds] = useState<Set<string>>(
    new Set(['f-root-src', 'f-root-assets', 'f-root-docs'])
  );

  // Load massive dataset on demand
  const loadDataset = (mode: 'default' | '1k' | '5k' | '10k') => {
    setDatasetMode(mode);
    if (mode === 'default') {
      setFiles(MOCK_FILES);
      setCurrentPath('/src');
      setSelectedFileId('f-app-tsx');
    } else {
      const count = mode === '1k' ? 1000 : mode === '5k' ? 5000 : 10000;
      const massive = generateMassiveDataset(count);
      setFiles(massive);
      setCurrentPath('/src/virtual_data');
      setSelectedFileId(massive[0]?.id || null);
    }
  };

  const toggleVirtualization = () => {
    setVirtualizationEnabled((prev) => !prev);
  };

  // Flatten all files for global search / inspection
  const allFlatFiles = useMemo(() => {
    const list: FileItem[] = [];
    const traverse = (items: FileItem[]) => {
      for (const item of items) {
        list.push(item);
        if (item.children) traverse(item.children);
      }
    };
    traverse(files);
    return list;
  }, [files]);

  const selectedFile = useMemo(() => {
    return allFlatFiles.find((f) => f.id === selectedFileId) || null;
  }, [allFlatFiles, selectedFileId]);

  // Files in the current active folder or search results
  const currentFolderFiles = useMemo(() => {
    let result: FileItem[] = [];

    if (searchQuery.trim()) {
      const q = searchQuery.toLowerCase();
      result = allFlatFiles.filter(
        (f) =>
          f.name.toLowerCase().includes(q) ||
          f.tags?.some((t) => t.toLowerCase().includes(q)) ||
          f.extension?.toLowerCase().includes(q)
      );
    } else {
      if (datasetMode !== 'default') {
        result = files;
      } else {
        if (currentPath === '/' || !currentPath) {
          result = files;
        } else {
          const target = allFlatFiles.find((f) => f.path === currentPath && f.type === 'folder');
          result = target?.children || files;
        }
      }
    }

    if (categoryFilter !== 'all') {
      result = result.filter((f) => f.type === categoryFilter);
    }

    // Sort
    result = [...result].sort((a, b) => {
      if (a.type === 'folder' && b.type !== 'folder') return -1;
      if (a.type !== 'folder' && b.type === 'folder') return 1;

      let compare = 0;
      if (sortField === 'name') {
        compare = a.name.localeCompare(b.name);
      } else if (sortField === 'size') {
        compare = a.size - b.size;
      } else if (sortField === 'modifiedAt') {
        compare = a.modifiedAt.localeCompare(b.modifiedAt);
      } else if (sortField === 'type') {
        compare = a.type.localeCompare(b.type);
      }

      return sortOrder === 'asc' ? compare : -compare;
    });

    return result;
  }, [files, allFlatFiles, currentPath, searchQuery, categoryFilter, sortField, sortOrder, datasetMode]);

  const selectFile = (file: FileItem | null, multi = false) => {
    if (!file) {
      setSelectedFileId(null);
      setSelectedFileIds([]);
      return;
    }
    if (multi) {
      setSelectedFileIds((prev) =>
        prev.includes(file.id) ? prev.filter((id) => id !== file.id) : [...prev, file.id]
      );
    } else {
      setSelectedFileId(file.id);
      setSelectedFileIds([file.id]);
    }
  };

  const navigateToFolder = (folder: FileItem | null) => {
    if (!folder) {
      setCurrentPath('/');
      setSelectedFileId(null);
      return;
    }
    setCurrentPath(folder.path);
    setSelectedFileId(folder.id);
    if (!expandedFolderIds.has(folder.id)) {
      setExpandedFolderIds((prev) => new Set([...prev, folder.id]));
    }
  };

  const toggleFolderExpanded = (folderId: string) => {
    setExpandedFolderIds((prev) => {
      const next = new Set(prev);
      if (next.has(folderId)) {
        next.delete(folderId);
      } else {
        next.add(folderId);
      }
      return next;
    });
  };

  const toggleStar = (fileId: string) => {
    const updateRecursive = (items: FileItem[]): FileItem[] => {
      return items.map((item) => {
        if (item.id === fileId) {
          return { ...item, isFavorite: !item.isFavorite };
        }
        if (item.children) {
          return { ...item, children: updateRecursive(item.children) };
        }
        return item;
      });
    };
    setFiles((prev) => updateRecursive(prev));
  };

  return (
    <ExplorerContext.Provider
      value={{
        files,
        drives: MOCK_DRIVES,
        currentPath,
        selectedFile,
        selectedFileIds,
        viewMode,
        searchQuery,
        categoryFilter,
        sortField,
        sortOrder,
        expandedFolderIds,
        virtualizationEnabled,
        datasetMode,
        setViewMode,
        setSearchQuery,
        setCategoryFilter,
        setSortField,
        setSortOrder,
        setVirtualizationEnabled,
        toggleVirtualization,
        loadDataset,
        selectFile,
        navigateToFolder,
        toggleFolderExpanded,
        toggleStar,
        currentFolderFiles,
        allFlatFiles,
      }}
    >
      {children}
    </ExplorerContext.Provider>
  );
};

export const useExplorer = (): ExplorerContextType => {
  const context = useContext(ExplorerContext);
  if (!context) {
    throw new Error('useExplorer must be used within an ExplorerProvider');
  }
  return context;
};
