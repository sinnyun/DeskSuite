import { z } from 'zod'

export const PaneSessionStateSchema = z.object({
  path: z.string().max(32768).nullable(),
  viewMode: z.enum(['list', 'grid', 'gallery', 'grouped']),
  groupingEnabled: z.boolean(),
  sortField: z.enum(['name', 'size', 'modifiedAt', 'kind', 'rating']),
  sortOrder: z.enum(['asc', 'desc']),
  search: z.string().max(4096),
  kindFilter: z.enum(['all', 'folder', 'code', 'image', 'document', 'data', 'archive', 'video', 'audio', 'other']),
  tagFilter: z.string().max(512).nullable(),
  favoriteOnly: z.boolean(),
  minRating: z.number().int().min(0).max(5),
  paneWidths: z.object({
    left: z.number().finite().min(120).max(1200),
    right: z.number().finite().min(120).max(1200),
    bottom: z.number().finite().min(80).max(1000)
  }).strict(),
  expandedDirectories: z.array(z.string().max(32768)).max(10000),
  tagFocus: z.object({ tagId: z.number().int().positive(), name: z.string().min(1).max(512) }).strict().nullable()
}).strict()

export const WorkspaceDescriptorSchema = z.object({
  id: z.string().min(1).max(128),
  name: z.string().trim().min(1).max(80),
  layout: z.union([z.literal(1), z.literal(2), z.literal(4)]),
  panes: z.array(z.object({ id: z.string().min(1).max(64), state: PaneSessionStateSchema }).strict()).min(1).max(4),
  activePaneId: z.string().max(64).nullable().optional()
}).strict()

export const WorkspaceCatalogSchema = z.object({
  activeId: z.string().max(128).nullable(),
  activePaneId: z.string().max(64).nullable(),
  items: z.array(WorkspaceDescriptorSchema).max(10000)
}).strict()
