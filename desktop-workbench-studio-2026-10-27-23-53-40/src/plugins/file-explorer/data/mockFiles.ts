import { DriveItem, FileItem, FileType } from '../../../types/workbench';

export const MOCK_DRIVES: DriveItem[] = [
  {
    id: 'drive-c',
    name: '系统盘',
    letter: 'C:',
    totalBytes: 512 * 1024 * 1024 * 1024,
    usedBytes: 312 * 1024 * 1024 * 1024,
    type: 'system',
  },
  {
    id: 'drive-d',
    name: '开发工作盘',
    letter: 'D:',
    totalBytes: 2048 * 1024 * 1024 * 1024,
    usedBytes: 840 * 1024 * 1024 * 1024,
    type: 'data',
  },
  {
    id: 'drive-cloud',
    name: '云端同步盘',
    letter: 'Cloud:',
    totalBytes: 1024 * 1024 * 1024 * 1024,
    usedBytes: 142 * 1024 * 1024 * 1024,
    type: 'cloud',
  },
];

export const MOCK_FILES: FileItem[] = [
  {
    id: 'f-root-src',
    name: 'src',
    path: '/src',
    type: 'folder',
    size: 0,
    modifiedAt: '2026-10-27 14:20:00',
    createdAt: '2026-10-01 09:00:00',
    permissions: 'drwxr-xr-x',
    tags: ['source', 'frontend'],
    parentId: null,
    children: [
      {
        id: 'f-app-tsx',
        name: 'App.tsx',
        path: '/src/App.tsx',
        extension: 'tsx',
        type: 'code',
        size: 3420,
        modifiedAt: '2026-10-27 15:10:12',
        createdAt: '2026-10-01 09:12:00',
        permissions: '-rw-r--r--',
        tags: ['react', 'entry'],
        lineCount: 124,
        isFavorite: true,
        contentPreview: `import React from 'react';\nimport { WorkbenchLayout } from './components/layout/WorkbenchLayout';\n\nexport default function App() {\n  return <WorkbenchLayout />;\n}`,
        parentId: 'f-root-src',
      },
      {
        id: 'f-main-tsx',
        name: 'main.tsx',
        path: '/src/main.tsx',
        extension: 'tsx',
        type: 'code',
        size: 890,
        modifiedAt: '2026-10-26 11:00:00',
        createdAt: '2026-10-01 09:10:00',
        permissions: '-rw-r--r--',
        tags: ['vite', 'bootstrap'],
        lineCount: 32,
        contentPreview: `import { createRoot } from 'react-dom/client';\nimport App from './App';\nimport './index.css';\n\ncreateRoot(document.getElementById('root')!).render(<App />);`,
        parentId: 'f-root-src',
      },
      {
        id: 'f-index-css',
        name: 'index.css',
        path: '/src/index.css',
        extension: 'css',
        type: 'code',
        size: 1540,
        modifiedAt: '2026-10-27 10:45:00',
        createdAt: '2026-10-01 09:10:00',
        permissions: '-rw-r--r--',
        tags: ['styles', 'tailwind'],
        lineCount: 54,
        contentPreview: `@import "tailwindcss";\n\n@layer base {\n  body {\n    font-family: var(--font-sans);\n  }\n}`,
        parentId: 'f-root-src',
      },
      {
        id: 'f-plugin-file-tree',
        name: 'SlotRegistry.tsx',
        path: '/src/core/SlotRegistry.tsx',
        extension: 'tsx',
        type: 'code',
        size: 4210,
        modifiedAt: '2026-10-27 14:12:00',
        createdAt: '2026-10-20 16:30:00',
        permissions: '-rw-r--r--',
        tags: ['core', 'plugin-engine'],
        lineCount: 168,
        contentPreview: `export const SlotRegistryProvider: React.FC = ({ children }) => {\n  const [plugins, setPlugins] = useState<PluginDefinition[]>([]);\n  // ...\n};`,
        parentId: 'f-root-src',
      },
      {
        id: 'f-use-virtualizer',
        name: 'useVirtualizer.ts',
        path: '/src/core/useVirtualizer.ts',
        extension: 'ts',
        type: 'code',
        size: 2880,
        modifiedAt: '2026-10-27 16:00:00',
        createdAt: '2026-10-27 15:45:00',
        permissions: '-rw-r--r--',
        tags: ['perf', 'virtual-scroll'],
        lineCount: 110,
        contentPreview: `export function useVirtualizer({ count, itemHeight }: UseVirtualizerOptions) {\n  // 60FPS virtual table row windowing\n}`,
        parentId: 'f-root-src',
      },
    ],
  },
  {
    id: 'f-root-assets',
    name: 'assets',
    path: '/assets',
    type: 'folder',
    size: 0,
    modifiedAt: '2026-10-26 18:30:00',
    createdAt: '2026-10-05 10:00:00',
    permissions: 'drwxr-xr-x',
    tags: ['media', 'design'],
    parentId: null,
    children: [
      {
        id: 'f-hero-banner',
        name: 'desktop_workbench_cover.png',
        path: '/assets/desktop_workbench_cover.png',
        extension: 'png',
        type: 'image',
        size: 485000,
        modifiedAt: '2026-10-25 16:40:00',
        createdAt: '2026-10-25 16:40:00',
        permissions: '-rw-r--r--',
        dimensions: '1920 × 1080',
        tags: ['cover', 'ui-mockup'],
        isFavorite: true,
        thumbnail:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360"><rect width="100%" height="100%" fill="%230284c7"/><rect x="40" y="40" width="520" height="280" rx="12" fill="%230f172a"/><rect x="40" y="40" width="520" height="32" rx="12" fill="%231e293b"/><circle cx="60" cy="56" r="5" fill="%23ef4444"/><circle cx="75" cy="56" r="5" fill="%23f59e0b"/><circle cx="90" cy="56" r="5" fill="%2310b981"/><rect x="52" y="84" width="120" height="220" rx="6" fill="%231e293b"/><rect x="180" y="84" width="260" height="220" rx="6" fill="%231e293b"/><rect x="448" y="84" width="100" height="220" rx="6" fill="%231e293b"/><text x="300" y="195" font-family="sans-serif" font-size="14" fill="%2394a3b8" text-anchor="middle">Workbench UI Preview</text></svg>',
        parentId: 'f-root-assets',
      },
      {
        id: 'f-app-icon',
        name: 'workbench_icon_fluent.svg',
        path: '/assets/workbench_icon_fluent.svg',
        extension: 'svg',
        type: 'image',
        size: 12400,
        modifiedAt: '2026-10-26 09:15:00',
        createdAt: '2026-10-10 14:00:00',
        permissions: '-rw-r--r--',
        dimensions: '512 × 512',
        tags: ['vector', 'brand'],
        thumbnail:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="300" height="300" viewBox="0 0 300 300"><defs><linearGradient id="g" x1="0%" y1="0%" x2="100%" y2="100%"><stop offset="0%" stop-color="%2338bdf8"/><stop offset="100%" stop-color="%230369a1"/></linearGradient></defs><rect width="300" height="300" rx="64" fill="url(%23g)"/><rect x="60" y="60" width="180" height="180" rx="24" fill="%23ffffff" fill-opacity="0.2"/><path d="M90 100 h120 v30 h-120 z M90 145 h70 v70 h-70 z M175 145 h35 v70 h-35 z" fill="%23ffffff"/></svg>',
        parentId: 'f-root-assets',
      },
      {
        id: 'f-screenshot-gallery',
        name: 'workbench_dark_mode.png',
        path: '/assets/workbench_dark_mode.png',
        extension: 'png',
        type: 'image',
        size: 672000,
        modifiedAt: '2026-10-27 12:00:00',
        createdAt: '2026-10-27 12:00:00',
        permissions: '-rw-r--r--',
        dimensions: '2560 × 1440',
        tags: ['screenshot', 'dark-theme'],
        thumbnail:
          'data:image/svg+xml;utf8,<svg xmlns="http://www.w3.org/2000/svg" width="600" height="360" viewBox="0 0 600 360"><rect width="100%" height="100%" fill="%230b0f19"/><rect x="30" y="30" width="540" height="300" rx="10" fill="%23111827" stroke="%23374151" stroke-width="2"/><text x="300" y="185" font-family="sans-serif" font-size="16" fill="%2338bdf8" text-anchor="middle">Dark Mode Fluent Theme</text></svg>',
        parentId: 'f-root-assets',
      },
    ],
  },
  {
    id: 'f-root-docs',
    name: 'docs',
    path: '/docs',
    type: 'folder',
    size: 0,
    modifiedAt: '2026-10-27 08:30:00',
    createdAt: '2026-10-02 14:00:00',
    permissions: 'drwxr-xr-x',
    tags: ['documentation', 'specs'],
    parentId: null,
    children: [
      {
        id: 'f-plugin-spec',
        name: 'plugin-specification.md',
        path: '/docs/plugin-specification.md',
        extension: 'md',
        type: 'document',
        size: 8920,
        modifiedAt: '2026-10-27 09:30:00',
        createdAt: '2026-10-15 11:00:00',
        permissions: '-rw-r--r--',
        tags: ['architecture', 'api-spec'],
        lineCount: 240,
        isFavorite: true,
        contentPreview: `# Plugin Architecture Specification\n\n## 1. Slot Contribution Model\nPlugins declare slot IDs rather than directly mounting components.\n\n## 2. Unified Theme Contract\nAll controls use DesktopButton, DesktopTab, DesktopInput.\n\n## 3. Event Bus & Lifecycle\nPlugins emit structured logs to the Debug Console.`,
        parentId: 'f-root-docs',
      },
      {
        id: 'f-roadmap',
        name: 'phase1-deliverables.json',
        path: '/docs/phase1-deliverables.json',
        extension: 'json',
        type: 'data',
        size: 3200,
        modifiedAt: '2026-10-26 17:00:00',
        createdAt: '2026-10-24 10:00:00',
        permissions: '-rw-r--r--',
        tags: ['roadmap', 'config'],
        lineCount: 68,
        contentPreview: `{\n  "phase": 1,\n  "status": "in-progress",\n  "features": [\n    "Draggable Splitters",\n    "Slot Registry",\n    "File Explorer Plugin",\n    "Debug Console Plugin"\n  ]\n}`,
        parentId: 'f-root-docs',
      },
      {
        id: 'f-report-pdf',
        name: 'system-architecture-whitepaper.pdf',
        path: '/docs/system-architecture-whitepaper.pdf',
        extension: 'pdf',
        type: 'document',
        size: 1420000,
        modifiedAt: '2026-10-22 14:00:00',
        createdAt: '2026-10-20 10:00:00',
        permissions: '-rw-r--r--',
        tags: ['whitepaper', 'publication'],
        contentPreview: `[PDF Binary Document - 18 Pages]\nTitle: Desktop Workbench Plugin Architecture\nAuthor: Engineering Team\nAbstract: A slot-based extensible framework for high-performance React workbench applications.`,
        parentId: 'f-root-docs',
      },
    ],
  },
  {
    id: 'f-package-json',
    name: 'package.json',
    path: '/package.json',
    extension: 'json',
    type: 'data',
    size: 1840,
    modifiedAt: '2026-10-27 10:00:00',
    createdAt: '2026-10-01 09:00:00',
    permissions: '-rw-r--r--',
    tags: ['npm', 'dependencies'],
    lineCount: 42,
    contentPreview: `{\n  "name": "desktop-workbench-studio",\n  "private": true,\n  "version": "1.0.0",\n  "dependencies": {\n    "react": "^19.0.1",\n    "lucide-react": "^0.546.0"\n  }\n}`,
    parentId: null,
  },
  {
    id: 'f-tsconfig',
    name: 'tsconfig.json',
    path: '/tsconfig.json',
    extension: 'json',
    type: 'data',
    size: 720,
    modifiedAt: '2026-10-20 14:00:00',
    createdAt: '2026-10-01 09:00:00',
    permissions: '-rw-r--r--',
    tags: ['typescript', 'compiler'],
    lineCount: 28,
    contentPreview: `{\n  "compilerOptions": {\n    "target": "ES2022",\n    "module": "ESNext",\n    "jsx": "react-jsx"\n  }\n}`,
    parentId: null,
  },
  {
    id: 'f-readme',
    name: 'README.md',
    path: '/README.md',
    extension: 'md',
    type: 'document',
    size: 2450,
    modifiedAt: '2026-10-27 14:40:00',
    createdAt: '2026-10-01 09:00:00',
    permissions: '-rw-r--r--',
    tags: ['readme', 'docs'],
    lineCount: 82,
    isFavorite: true,
    contentPreview: `# Desktop Workbench Studio\n\nA modern, slot-based desktop software layout engine for React.\n\n### Highlights\n- Splitter drag-to-resize\n- Centralized theme tokens\n- Turnkey File Explorer & Debug Console plugins`,
    parentId: null,
  },
];

export function formatBytes(bytes: number, decimals = 1): string {
  if (bytes === 0) return '0 B';
  const k = 1024;
  const dm = decimals < 0 ? 0 : decimals;
  const sizes = ['B', 'KB', 'MB', 'GB', 'TB'];
  const i = Math.floor(Math.log(bytes) / Math.log(k));
  return `${parseFloat((bytes / Math.pow(k, i)).toFixed(dm))} ${sizes[i]}`;
}

// Helper to generate massive datasets for testing virtual table & virtual row optimization
export function generateMassiveDataset(count: number): FileItem[] {
  const extensions = ['tsx', 'ts', 'jsx', 'json', 'png', 'svg', 'md', 'css', 'pdf', 'zip'];
  const types: FileType[] = ['code', 'code', 'code', 'data', 'image', 'image', 'document', 'code', 'document', 'archive'];
  const tagPool = [
    ['react', 'frontend'],
    ['ui-mockup', 'vector'],
    ['api', 'backend'],
    ['core', 'engine'],
    ['specs', 'architecture'],
    ['dataset', 'analytics'],
    ['test', 'benchmark'],
    ['styles', 'theme'],
    ['plugin', 'extension'],
  ];

  const items: FileItem[] = [];
  const baseTimestamp = Date.now();

  for (let i = 1; i <= count; i++) {
    const typeIdx = i % types.length;
    const ext = extensions[typeIdx];
    const type = types[typeIdx];
    const tags = tagPool[i % tagPool.length];
    const size = Math.floor(1000 + (i * 137) % 5000000);
    const day = String((i % 28) + 1).padStart(2, '0');
    const hour = String((i % 24)).padStart(2, '0');
    const minute = String((i % 60)).padStart(2, '0');

    items.push({
      id: `virtual-file-${i}`,
      name: `record_item_${String(i).padStart(5, '0')}.${ext}`,
      path: `/src/virtual_data/record_item_${String(i).padStart(5, '0')}.${ext}`,
      extension: ext,
      type,
      size,
      modifiedAt: `2026-10-${day} ${hour}:${minute}:00`,
      createdAt: `2026-09-15 08:00:00`,
      permissions: '-rw-r--r--',
      tags,
      isFavorite: i % 17 === 0,
      lineCount: type === 'code' ? (i % 500) + 20 : undefined,
      contentPreview: `// Virtual record item #${i}\nexport const ITEM_${i} = {\n  id: "virtual-${i}",\n  timestamp: ${baseTimestamp - i * 1000},\n  size: ${size}\n};`,
      parentId: 'f-root-src',
    });
  }

  return items;
}
