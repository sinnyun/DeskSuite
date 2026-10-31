import { app, nativeImage } from 'electron'
import { createHash, randomUUID } from 'node:crypto'
import { copyFile, lstat, mkdir, open, readFile, readdir, realpath, rename, rm, stat } from 'node:fs/promises'
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path'
import type { Context } from 'cordis'
import { z } from 'zod'
import { mcpErrorFrom, mcpText } from '../../services/mcp'
import { materialDefaults } from './material-defaults'

const PLUGIN_ID = 'project-ops-workcrate-projects'
const INDEX_KEY = 'workcrate-project-index'
const INDEX_PATH = 'workcrate/recent.json'
const FORMAT_VERSION = 1
const MAX_PROJECTS = 1000
const MAX_REFERENCES = 5000
const MAX_IMAGE_BYTES = 32 * 1024 * 1024
const MAX_PROJECT_DOCUMENT_BYTES = 16 * 1024 * 1024
export type WorkCrateProjectSortOrder = 'manual' | 'name-asc' | 'name-desc' | 'created-newest' | 'created-oldest'

export interface WorkCratePreview {
  path: string
  sha256: string
  width: number
  height: number
}

export interface WorkCrateProject {
  id: string
  name: string
  createdAt: number
  archived: boolean
  mainImage: WorkCratePreview | null
  order?: number
}

export interface WorkCrateFileReference {
  id: string
  path: string
  displayTitle: string
  order: number
  sizeBytes: number
  modifiedAt: number | null
  customPreview: WorkCratePreview | null
  available?: boolean
}

export interface WorkCrateFieldPreset {
  key: string
  label: string
  values: string[]
}

export interface WorkCrateFieldPresets {
  fields: WorkCrateFieldPreset[]
}

export interface WorkCrateProjectLifecycleHook {
  beforeDelete(projectId: string): Promise<void>
  beforeRelocate(projectId: string): Promise<void>
  beforeSetDocumentPath(projectId: string): Promise<void>
}

interface ProjectIndex {
  version: number
  projects: WorkCrateProject[]
  locations: Record<string, string>
  programPresets: WorkCrateFieldPresets
  materialDefaultsVersion: number
  projectSortOrder: WorkCrateProjectSortOrder
}

interface ProjectDocument {
  version: number
  projectId: string
  project: WorkCrateProject
  references: WorkCrateFileReference[]
  documentPath: string | null
  documentBinding: string
  fieldPresets: WorkCrateFieldPresets
}

const previewSchema: z.ZodType<WorkCratePreview> = z.object({
  path: z.string().min(1),
  sha256: z.string().regex(/^[a-f0-9]{64}$/),
  width: z.number().int().positive(),
  height: z.number().int().positive()
})

const projectSchema: z.ZodType<WorkCrateProject> = z.object({
  id: z.string().uuid(),
  name: z.string().min(1).max(120),
  createdAt: z.number().int().nonnegative(),
  archived: z.boolean(),
  mainImage: previewSchema.nullable(),
  order: z.number().int().nonnegative().optional()
})

const referenceSchema: z.ZodType<WorkCrateFileReference> = z.object({
  id: z.string().uuid(),
  path: z.string().min(1),
  displayTitle: z.string().min(1).max(240),
  order: z.number().int().nonnegative(),
  sizeBytes: z.number().int().nonnegative(),
  modifiedAt: z.number().int().nonnegative().nullable(),
  customPreview: previewSchema.nullable()
})

const fieldPresetSchema: z.ZodType<WorkCrateFieldPreset> = z.object({
  key: z.string().trim().min(1).max(80),
  label: z.string().trim().min(1).max(120),
  values: z.array(z.string().trim().min(1).max(240)).max(200)
})

const fieldPresetsSchema: z.ZodType<WorkCrateFieldPresets> = z.object({
  fields: z.array(fieldPresetSchema).max(100)
})

const indexSchema: z.ZodType<ProjectIndex> = z.object({
  version: z.number().int().positive(),
  projects: z.array(projectSchema).max(MAX_PROJECTS),
  locations: z.record(z.string().uuid(), z.string().min(1)),
  programPresets: fieldPresetsSchema,
  materialDefaultsVersion: z.number().int().nonnegative().default(0),
  projectSortOrder: z.enum(['manual', 'name-asc', 'name-desc', 'created-newest', 'created-oldest']).default('manual')
})

const documentSchema: z.ZodType<ProjectDocument> = z.object({
  version: z.number().int().positive(),
  projectId: z.string().uuid(),
  project: projectSchema,
  references: z.array(referenceSchema).max(MAX_REFERENCES),
  documentPath: z.string().min(1).nullable(),
  documentBinding: z.string().uuid(),
  fieldPresets: fieldPresetsSchema
})

function emptyPresets(): WorkCrateFieldPresets {
  return { fields: [] }
}

function emptyIndex(): ProjectIndex {
  return { version: FORMAT_VERSION, projects: [], locations: {}, programPresets: emptyPresets(), materialDefaultsVersion: 0, projectSortOrder: 'manual' }
}

function normalizePresets(value: WorkCrateFieldPresets): WorkCrateFieldPresets {
  const seen = new Set<string>()
  return {
    fields: value.fields.map((field) => {
      const key = field.key.trim()
      if (seen.has(key)) throw new Error(`字段键重复：${key}`)
      seen.add(key)
      return { key, label: field.label.trim(), values: [...new Set(field.values.map((item) => item.trim()).filter(Boolean))] }
    })
  }
}

function within(root: string, path: string): boolean {
  const rel = relative(root, path)
  return rel === '' || (rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel))
}

function relativeAssetPath(root: string, value: string): string {
  if (!value || isAbsolute(value)) throw new Error('预览路径必须是相对路径')
  const normalized = resolve(root, value)
  if (!within(root, normalized)) throw new Error('预览路径超出工程目录')
  return relative(root, normalized).split(sep).join('/')
}

function safeName(value: string): string {
  const name = value.trim()
  if (!name || name.length > 120 || /[\\/\0]/.test(name)) throw new Error('工程名称须为 1–120 个字符且不能包含路径分隔符')
  return name
}

async function canonicalFile(value: string): Promise<{ path: string; info: Awaited<ReturnType<typeof stat>> }> {
  if (!isAbsolute(value)) throw new Error('文件路径必须是绝对路径')
  const path = await realpath(value)
  const info = await stat(path)
  if (!info.isFile()) throw new Error('所选路径不是普通文件')
  return { path, info }
}

async function digestFile(path: string): Promise<string> {
  const hash = createHash('sha256')
  const data = await readFile(path)
  hash.update(data)
  return hash.digest('hex')
}

async function writeAtomic(path: string, data: string | Uint8Array): Promise<void> {
  await mkdir(dirname(path), { recursive: true })
  const tempPath = `${path}.${randomUUID()}.tmp`
  const backupPath = `${path}.bak`
  const handle = await open(tempPath, 'wx')
  try {
    await handle.writeFile(data)
    await handle.sync()
  } finally {
    await handle.close()
  }
  let movedOld = false
  try {
    await rm(backupPath, { force: true })
    try {
      await rename(path, backupPath)
      movedOld = true
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error
    }
    await rename(tempPath, path)
  } catch (error) {
    if (movedOld) {
      try { await rename(backupPath, path) } catch { /* retain backup for recovery */ }
    }
    await rm(tempPath, { force: true })
    throw error
  }
}

async function readProjectDocument(path: string): Promise<ProjectDocument> {
  const info = await stat(path)
  if (!info.isFile() || info.size > MAX_PROJECT_DOCUMENT_BYTES) throw new Error('工程数据文件不是普通文件或超过 16 MiB')
  const bytes = await readFile(path)
  if (bytes.byteLength > MAX_PROJECT_DOCUMENT_BYTES) throw new Error('工程数据文件读取后超过 16 MiB')
  return documentSchema.parse(JSON.parse(bytes.toString('utf8')))
}

async function copyDirectory(source: string, target: string): Promise<void> {
  await mkdir(target, { recursive: true })
  for (const entry of await readdir(source, { withFileTypes: true })) {
    const from = join(source, entry.name)
    const to = join(target, entry.name)
    if (entry.isSymbolicLink()) throw new Error(`工程数据不能包含符号链接或重解析点：${from}`)
    if (entry.isDirectory()) await copyDirectory(from, to)
    else if (entry.isFile()) await copyFile(from, to)
  }
}

function samePath(left: string, right: string): boolean {
  return resolve(left).toLocaleLowerCase() === resolve(right).toLocaleLowerCase()
}

export interface WorkCrateProjectsService {
  initialize(): Promise<void>
  registerLifecycleHook(hook: WorkCrateProjectLifecycleHook): () => void
  list(includeArchived?: boolean): Promise<WorkCrateProject[]>
  getPreferences(): Promise<{ projectSortOrder: WorkCrateProjectSortOrder }>
  savePreferences(preferences: { projectSortOrder: WorkCrateProjectSortOrder }): Promise<{ projectSortOrder: WorkCrateProjectSortOrder }>
  get(projectId: string): Promise<{ project: WorkCrateProject; references: WorkCrateFileReference[]; fieldPresets: WorkCrateFieldPresets; documentPath: string | null; documentBinding: string }>
  projectDirectory(projectId: string): Promise<string>
  readPreview(projectId: string, relativePath: string): Promise<{ dataUrl: string; mimeType: string; width: number; height: number }>
  create(name: string): Promise<WorkCrateProject>
  rename(projectId: string, name: string): Promise<WorkCrateProject>
  setArchived(projectId: string, archived: boolean): Promise<WorkCrateProject>
  reorder(projectIds: string[]): Promise<WorkCrateProject[]>
  duplicate(projectId: string, name?: string): Promise<WorkCrateProject>
  delete(projectId: string): Promise<void>
  addReferences(projectId: string, paths: string[]): Promise<WorkCrateFileReference[]>
  removeReference(projectId: string, referenceId: string): Promise<WorkCrateFileReference[]>
  relinkReference(projectId: string, referenceId: string, path: string): Promise<WorkCrateFileReference[]>
  updateReference(projectId: string, referenceId: string, patch: { displayTitle?: string; order?: number }): Promise<WorkCrateFileReference[]>
  setCover(projectId: string, path: string): Promise<WorkCratePreview>
  removeCover(projectId: string): Promise<void>
  setReferencePreview(projectId: string, referenceId: string, path: string): Promise<WorkCratePreview>
  removeReferencePreview(projectId: string, referenceId: string): Promise<void>
  getDocumentPath(projectId: string): Promise<string | null>
  setDocumentPath(projectId: string, path: string): Promise<{ path: string; binding: string }>
  clearDocumentPath(projectId: string, expectedPath: string): Promise<void>
  relocateProject(projectId: string, directory: string): Promise<string>
  openProjectFolder(directory: string): Promise<WorkCrateProject[]>
  getProjectPresets(projectId: string): Promise<WorkCrateFieldPresets>
  saveProjectPresets(projectId: string, presets: WorkCrateFieldPresets): Promise<WorkCrateFieldPresets>
  getProgramPresets(): Promise<WorkCrateFieldPresets>
  saveProgramPresets(presets: WorkCrateFieldPresets): Promise<WorkCrateFieldPresets>
  effectivePresets(projectId?: string): Promise<WorkCrateFieldPresets>
  promoteProjectField(projectId: string, key: string): Promise<WorkCrateFieldPresets>
  documentBinding(projectId: string): Promise<string>
}

declare module 'cordis' {
  interface Context {
    workcrateProjects: WorkCrateProjectsService
  }
}

class WorkCrateProjectsServiceImpl implements WorkCrateProjectsService {
  constructor(private readonly ctx: Context) {}

  private readonly root = join(app.getPath('userData'), 'data', 'workcrate')
  private readonly projectRoot = join(this.root, 'projects')
  private readonly queues = new Map<string, Promise<unknown>>()
  private readonly lifecycleHooks = new Set<WorkCrateProjectLifecycleHook>()
  private index: ProjectIndex = emptyIndex()
  private revisionValue = 0

  registerLifecycleHook(hook: WorkCrateProjectLifecycleHook): () => void {
    this.lifecycleHooks.add(hook)
    return () => { this.lifecycleHooks.delete(hook) }
  }

  private async runLifecycleHook(action: keyof WorkCrateProjectLifecycleHook, projectId: string): Promise<void> {
    for (const hook of [...this.lifecycleHooks]) await hook[action](projectId)
  }

  async initialize(): Promise<void> {
    await mkdir(this.projectRoot, { recursive: true })
    this.ctx.store.registerDocument(INDEX_KEY, INDEX_PATH, { schema: indexSchema, default: emptyIndex(), version: FORMAT_VERSION })
    this.index = indexSchema.parse(await this.ctx.store.read<ProjectIndex>(INDEX_KEY))
    if (this.index.version !== FORMAT_VERSION) throw new Error(`不支持的 WorkCrate 索引版本：${this.index.version}`)
    for (const [id, location] of Object.entries(this.index.locations)) {
      if (!isAbsolute(location)) throw new Error(`工程定位必须是绝对路径：${id}`)
    }
    if (this.index.materialDefaultsVersion < 1) {
      await this.updateIndex((index) => ({
        ...index, materialDefaultsVersion: 1,
        programPresets: { fields: [...index.programPresets.fields, ...materialDefaults.fields.filter((field) => !index.programPresets.fields.some((current) => current.key === field.key))] }
      }))
    }
  }

  private queue<T>(key: string, action: () => Promise<T>): Promise<T> {
    const previous = this.queues.get(key) ?? Promise.resolve()
    const next = previous.catch(() => undefined).then(action)
    this.queues.set(key, next)
    void next.finally(() => { if (this.queues.get(key) === next) this.queues.delete(key) }).catch(() => undefined)
    return next
  }

  private async updateIndex(update: (index: ProjectIndex) => ProjectIndex): Promise<void> {
    const next = await this.ctx.store.update<ProjectIndex>(INDEX_KEY, (current) => {
      const parsed = indexSchema.parse(current)
      return indexSchema.parse(update(parsed))
    })
    this.index = indexSchema.parse(next)
    this.changed()
  }

  private changed(projectId?: string): void {
    this.revisionValue += 1
    this.ctx.ipc.broadcast('workcrateProjects:changed', { projectId: projectId ?? null, revision: this.revisionValue, at: Date.now() })
  }

  private requireProject(projectId: string): WorkCrateProject {
    if (!z.string().uuid().safeParse(projectId).success) throw new Error('工程 ID 无效')
    const project = this.index.projects.find((item) => item.id === projectId)
    if (!project) throw new Error(`工程不存在：${projectId}`)
    return project
  }

  private nextProjectOrder(): number {
    return this.index.projects.reduce((max, item) => Math.max(max, item.order ?? -1), -1) + 1
  }

  async projectDirectory(projectId: string): Promise<string> {
    this.requireProject(projectId)
    const root = this.index.locations[projectId]
    if (!root || !isAbsolute(root)) throw new Error('工程定位信息无效')
    const normalized = resolve(root)
    const internalRoot = await realpath(this.projectRoot)
    const expectedInternal = resolve(this.projectRoot, projectId)
    const isInternal = normalized.toLocaleLowerCase() === expectedInternal.toLocaleLowerCase()
    const isPortable = basename(normalized).toLocaleLowerCase() === projectId.toLocaleLowerCase()
      && basename(dirname(normalized)).toLocaleLowerCase() === '.workcrate'
    if (!isInternal && !isPortable) throw new Error('工程定位不属于允许的 WorkCrate 目录')
    const info = await lstat(normalized)
    if (!info.isDirectory() || info.isSymbolicLink()) throw new Error('工程目录不能是符号链接或重解析点')
    const canonical = await realpath(normalized)
    if (isInternal && !within(internalRoot, canonical)) throw new Error('应用工程目录解析后越界')
    if (isPortable) {
      const portableParent = dirname(normalized)
      const parentInfo = await lstat(portableParent)
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || canonical.toLocaleLowerCase() !== normalized.toLocaleLowerCase()) {
        throw new Error('便携工程目录不允许经过符号链接或重解析点')
      }
    }
    return canonical
  }

  async readPreview(projectId: string, rawPath: string): Promise<{ dataUrl: string; mimeType: string; width: number; height: number }> {
    const root = await this.projectDirectory(projectId)
    const relPath = relativeAssetPath(root, rawPath)
    if (!relPath.startsWith('previews/')) throw new Error('只能读取工程拥有的预览图片')
    const doc = await this.readDocument(projectId)
    const owned = [doc.project.mainImage, ...doc.references.map((item) => item.customPreview)]
      .some((preview) => preview?.path === relPath)
    if (!owned) throw new Error('该路径不是当前工程登记的预览')
    const path = join(root, ...relPath.split('/'))
    const canonical = await realpath(path)
    if (!within(root, canonical)) throw new Error('预览文件解析后超出工程目录')
    const info = await stat(canonical)
    if (!info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error('预览文件不存在或超过 32MB')
    const registered = [doc.project.mainImage, ...doc.references.map((item) => item.customPreview)]
      .find((preview) => preview?.path === relPath)
    if (!registered || await digestFile(canonical) !== registered.sha256) throw new Error('预览文件校验失败')
    const image = nativeImage.createFromPath(canonical)
    if (image.isEmpty()) throw new Error('无法读取工程预览图片')
    const original = image.getSize()
    const scale = Math.min(1, 1200 / original.width, 1200 / original.height)
    const resized = image.resize({ width: Math.max(1, Math.round(original.width * scale)), height: Math.max(1, Math.round(original.height * scale)), quality: 'good' })
    const data = resized.toJPEG(82)
    if (data.byteLength > 8 * 1024 * 1024) throw new Error('预览图片转换后超过 8MB')
    return { dataUrl: `data:image/jpeg;base64,${data.toString('base64')}`, mimeType: 'image/jpeg', width: original.width, height: original.height }
  }

  private async readDocument(projectId: string): Promise<ProjectDocument> {
    const root = await this.projectDirectory(projectId)
    const path = join(root, 'project.json')
    const readCandidate = async (candidate: string): Promise<ProjectDocument> => {
      const doc = await readProjectDocument(candidate)
      if (doc.version !== FORMAT_VERSION || doc.projectId !== projectId) throw new Error('工程数据版本或 ID 与索引不匹配')
      return doc
    }
    try {
      return await readCandidate(path)
    } catch (primaryError) {
      try { return await readCandidate(`${path}.bak`) }
      catch { throw primaryError }
    }
  }

  private async validateStoredProject(root: string, projectId: string): Promise<ProjectDocument> {
    const rootInfo = await lstat(root)
    if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink()) throw new Error('工程目录不能是符号链接或重解析点')
    const canonicalRoot = await realpath(root)
    if (!samePath(canonicalRoot, root)) throw new Error('工程目录解析后路径发生变化')
    const document = await readProjectDocument(join(canonicalRoot, 'project.json'))
    if (document.version !== FORMAT_VERSION || document.projectId !== projectId) throw new Error('工程数据版本或 ID 与目录不匹配')
    const previews = [document.project.mainImage, ...document.references.map((reference) => reference.customPreview)]
    for (const preview of previews) {
      if (!preview) continue
      const relativePath = relativeAssetPath(canonicalRoot, preview.path)
      if (!relativePath.startsWith('previews/')) throw new Error('工程预览必须位于 previews 目录')
      const path = join(canonicalRoot, ...relativePath.split('/'))
      const canonicalPath = await realpath(path)
      const info = await stat(canonicalPath)
      if (!within(canonicalRoot, canonicalPath) || !info.isFile() || info.size <= 0 || info.size > MAX_IMAGE_BYTES) {
        throw new Error(`工程预览文件无效：${relativePath}`)
      }
      if (await digestFile(canonicalPath) !== preview.sha256) throw new Error(`工程预览校验失败：${relativePath}`)
    }
    return document
  }

  private async writeDocument(projectId: string, doc: ProjectDocument): Promise<void> {
    const root = await this.projectDirectory(projectId)
    const parsed = documentSchema.parse({ ...doc, version: FORMAT_VERSION, projectId })
    const serialized = JSON.stringify(parsed, null, 2)
    if (Buffer.byteLength(serialized, 'utf8') > MAX_PROJECT_DOCUMENT_BYTES) throw new Error('工程数据文件超过 16 MiB 限额')
    await writeAtomic(join(root, 'project.json'), serialized)
  }

  private async mutateDocument<T>(projectId: string, mutate: (doc: ProjectDocument) => T | Promise<T>): Promise<T> {
    return this.queue(projectId, async () => {
      this.requireProject(projectId)
      const doc = await this.readDocument(projectId)
      const result = await mutate(doc)
      await this.writeDocument(projectId, doc)
      this.changed(projectId)
      return result
    })
  }

  async list(includeArchived = false): Promise<WorkCrateProject[]> {
    return this.index.projects.filter((project) => includeArchived || !project.archived)
      .sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt)
      .map((project) => ({ ...project }))
  }

  async getPreferences(): Promise<{ projectSortOrder: WorkCrateProjectSortOrder }> {
    return { projectSortOrder: this.index.projectSortOrder }
  }

  async savePreferences(preferences: { projectSortOrder: WorkCrateProjectSortOrder }): Promise<{ projectSortOrder: WorkCrateProjectSortOrder }> {
    const projectSortOrder = z.enum(['manual', 'name-asc', 'name-desc', 'created-newest', 'created-oldest']).parse(preferences.projectSortOrder)
    await this.updateIndex((index) => ({ ...index, projectSortOrder }))
    return { projectSortOrder }
  }

  async get(projectId: string) {
    const project = { ...this.requireProject(projectId) }
    const doc = await this.readDocument(projectId)
    const references = await this.referencesWithAvailability(doc.references)
    return { project, references, fieldPresets: structuredClone(doc.fieldPresets), documentPath: doc.documentPath, documentBinding: doc.documentBinding }
  }

  private async referencesWithAvailability(references: WorkCrateFileReference[]): Promise<WorkCrateFileReference[]> {
    return Promise.all(references.map(async (item) => {
      let available = false
      try { available = (await stat(item.path)).isFile() } catch { /* Missing source is surfaced as available:false. */ }
      return { ...item, available }
    }))
  }

  async reorder(projectIds: string[]): Promise<WorkCrateProject[]> {
    const all = this.index.projects
    if (!Array.isArray(projectIds) || !projectIds.length || new Set(projectIds).size !== projectIds.length || projectIds.some((id) => !all.some((p) => p.id === id))) {
      throw new Error('排序列表必须只包含存在且不重复的工程')
    }
    return this.queue('index', async () => {
      await this.updateIndex((index) => {
        const ordered = [...index.projects].sort((a, b) => (a.order ?? Number.MAX_SAFE_INTEGER) - (b.order ?? Number.MAX_SAFE_INTEGER) || a.createdAt - b.createdAt)
        const slots = ordered.flatMap((item, i) => projectIds.includes(item.id) ? [i] : [])
        const reordered = new Map(projectIds.map((id, i) => [id, slots[i]]))
        return { ...index, projects: index.projects.map((item) => reordered.has(item.id) ? { ...item, order: reordered.get(item.id)! } : item) }
      })
      return this.index.projects.map((project) => ({ ...project }))
    })
  }

  async duplicate(projectId: string, rawName?: string): Promise<WorkCrateProject> {
    return this.queue(projectId, async () => {
      const sourceRoot = await this.projectDirectory(projectId)
      const source = await this.validateStoredProject(sourceRoot, projectId)
      const name = safeName(rawName?.trim() || `${source.project.name} 副本`)
      return this.queue('index', async () => {
      if (this.index.projects.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`工程名称已存在：${name}`)
      if (this.index.projects.length >= MAX_PROJECTS) throw new Error('工程数量已达到上限')
      const id = randomUUID()
      const dest = join(this.projectRoot, id)
      const project: WorkCrateProject = { ...source.project, id, name, createdAt: Date.now(), order: this.nextProjectOrder() }
      try {
        await copyDirectory(sourceRoot, dest)
        let documentPath: string | null = null
        if (source.documentPath) {
          const nativeFile = await canonicalFile(source.documentPath)
          documentPath = join(dest, `document${extname(nativeFile.path) || '.vectorcraft'}`)
          await copyFile(nativeFile.path, documentPath)
        }
        const document: ProjectDocument = { ...structuredClone(source), projectId: id, project, documentPath, documentBinding: randomUUID(), references: source.references.map((ref) => ({ ...structuredClone(ref), id: randomUUID() })) }
        await rm(join(dest, 'project.json'), { force: true })
        await rm(join(dest, 'project.json.bak'), { force: true })
        await writeAtomic(join(dest, 'project.json'), JSON.stringify(documentSchema.parse(document), null, 2))
        await this.validateStoredProject(dest, id)
        await this.updateIndex((index) => ({ ...index, projects: [...index.projects, project], locations: { ...index.locations, [id]: dest } }))
        return project
      } catch (error) { await rm(dest, { recursive: true, force: true }); throw error }
      })
    })
  }

  async create(rawName: string): Promise<WorkCrateProject> {
    const name = safeName(rawName)
    return this.queue('index', async () => {
      if (this.index.projects.some((item) => item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`工程名称已存在：${name}`)
      if (this.index.projects.length >= MAX_PROJECTS) throw new Error('工程数量已达到上限')
      const project: WorkCrateProject = { id: randomUUID(), name, createdAt: Date.now(), archived: false, mainImage: null, order: this.nextProjectOrder() }
      const root = join(this.projectRoot, project.id)
      await mkdir(join(root, 'previews'), { recursive: true })
      const doc: ProjectDocument = { version: FORMAT_VERSION, projectId: project.id, project, references: [], documentPath: null, documentBinding: randomUUID(), fieldPresets: emptyPresets() }
      try {
        await writeAtomic(join(root, 'project.json'), JSON.stringify(doc, null, 2))
        await this.updateIndex((index) => ({ ...index, projects: [...index.projects, project], locations: { ...index.locations, [project.id]: root } }))
      } catch (error) {
        await rm(root, { recursive: true, force: true })
        throw error
      }
      return project
    })
  }

  async rename(projectId: string, rawName: string): Promise<WorkCrateProject> {
    const name = safeName(rawName)
    return this.queue(projectId, async () => this.queue('index', async () => {
      const current = this.requireProject(projectId)
      if (this.index.projects.some((item) => item.id !== projectId && item.name.toLocaleLowerCase() === name.toLocaleLowerCase())) throw new Error(`工程名称已存在：${name}`)
      const next = { ...current, name }
      const doc = await this.readDocument(projectId)
      doc.project = next
      await this.writeDocument(projectId, doc)
      await this.updateIndex((index) => ({ ...index, projects: index.projects.map((item) => item.id === projectId ? next : item) }))
      return next
    }))
  }

  async setArchived(projectId: string, archived: boolean): Promise<WorkCrateProject> {
    return this.queue(projectId, async () => this.queue('index', async () => {
      const current = this.requireProject(projectId)
      const next = { ...current, archived: archived === true }
      const doc = await this.readDocument(projectId)
      doc.project = next
      await this.writeDocument(projectId, doc)
      await this.updateIndex((index) => ({ ...index, projects: index.projects.map((item) => item.id === projectId ? next : item) }))
      return next
    }))
  }

  async delete(projectId: string): Promise<void> {
    await this.queue(projectId, async () => {
      await this.runLifecycleHook('beforeDelete', projectId)
      const root = await this.projectDirectory(projectId)
      const trashRoot = join(this.root, 'trash')
      await mkdir(trashRoot, { recursive: true })
      const target = join(trashRoot, `${projectId}-${randomUUID()}`)
      try {
        await copyDirectory(root, target)
        await this.validateStoredProject(target, projectId)
      } catch (error) {
        await rm(target, { recursive: true, force: true })
        throw error
      }
      await this.updateIndex((index) => ({
        ...index,
        projects: index.projects.filter((item) => item.id !== projectId),
        locations: Object.fromEntries(Object.entries(index.locations).filter(([id]) => id !== projectId))
      }))
      await rm(root, { recursive: true, force: true })
    })
  }

  async addReferences(projectId: string, paths: string[]): Promise<WorkCrateFileReference[]> {
    if (!Array.isArray(paths) || paths.length < 1 || paths.length > 500) throw new Error('一次添加的文件数须在 1–500 之间')
    const references = await this.mutateDocument(projectId, async (doc) => {
      const seen = new Set(doc.references.map((item) => item.path.toLocaleLowerCase()))
      for (const raw of paths) {
        const { path, info } = await canonicalFile(raw)
        const key = path.toLocaleLowerCase()
        if (seen.has(key)) continue
        if (doc.references.length >= MAX_REFERENCES) throw new Error('工程文件引用数量已达到上限')
        seen.add(key)
        doc.references.push({
          id: randomUUID(), path,
          displayTitle: basename(path, extname(path)).slice(0, 240) || basename(path).slice(0, 240),
          order: doc.references.length,
          sizeBytes: Number(info.size),
          modifiedAt: Math.floor(Number(info.mtimeMs)),
          customPreview: null
        })
      }
      return doc.references.map((item) => ({ ...item }))
    })
    return this.referencesWithAvailability(references)
  }

  async removeReference(projectId: string, referenceId: string): Promise<WorkCrateFileReference[]> {
    const removed = await this.mutateDocument(projectId, async (doc) => {
      const ref = doc.references.find((item) => item.id === referenceId)
      if (!ref) throw new Error('工程引用不存在')
      const oldPreview = ref.customPreview
      doc.references = doc.references.filter((item) => item.id !== referenceId).map((item, index) => ({ ...item, order: index }))
      return { references: doc.references.map((item) => ({ ...item })), oldPreview }
    })
    if (removed.oldPreview) {
      const root = await this.projectDirectory(projectId)
      await rm(join(root, ...relativeAssetPath(root, removed.oldPreview.path).split('/')), { force: true })
    }
    return this.referencesWithAvailability(removed.references)
  }

  async relinkReference(projectId: string, referenceId: string, rawPath: string): Promise<WorkCrateFileReference[]> {
    const { path, info } = await canonicalFile(rawPath)
    const references = await this.mutateDocument(projectId, (doc) => {
      const ref = doc.references.find((item) => item.id === referenceId)
      if (!ref) throw new Error('工程引用不存在')
      if (doc.references.some((item) => item.id !== referenceId && item.path.toLocaleLowerCase() === path.toLocaleLowerCase())) throw new Error('该文件已在工程中引用')
      ref.path = path
      ref.sizeBytes = Number(info.size)
      ref.modifiedAt = Math.floor(Number(info.mtimeMs))
      return doc.references.map((item) => ({ ...item }))
    })
    return this.referencesWithAvailability(references)
  }

  async updateReference(projectId: string, referenceId: string, patch: { displayTitle?: string; order?: number }): Promise<WorkCrateFileReference[]> {
    if (patch.displayTitle !== undefined && (!patch.displayTitle.trim() || patch.displayTitle.trim().length > 240)) throw new Error('引用标题须为 1–240 个字符')
    if (patch.order !== undefined && (!Number.isInteger(patch.order) || patch.order < 0)) throw new Error('引用顺序无效')
    const references = await this.mutateDocument(projectId, (doc) => {
      const index = doc.references.findIndex((item) => item.id === referenceId)
      if (index < 0) throw new Error('工程引用不存在')
      const [item] = doc.references.splice(index, 1)
      if (patch.displayTitle !== undefined) item.displayTitle = patch.displayTitle.trim()
      const target = patch.order === undefined ? index : Math.min(patch.order, doc.references.length)
      doc.references.splice(target, 0, item)
      doc.references = doc.references.map((reference, order) => ({ ...reference, order }))
      return doc.references.map((reference) => ({ ...reference }))
    })
    return this.referencesWithAvailability(references)
  }

  private async makePreview(projectId: string, sourcePath: string, assetName: string): Promise<WorkCratePreview> {
    const { path, info } = await canonicalFile(sourcePath)
    const ext = extname(path).toLowerCase()
    if (!['.jpg', '.jpeg', '.png'].includes(ext)) throw new Error('预览仅支持 JPEG 或 PNG 图片')
    if (info.size <= 0 || info.size > MAX_IMAGE_BYTES) throw new Error('预览图片须小于 32MB')
    const bytes = await readFile(path)
    const image = nativeImage.createFromBuffer(bytes)
    const size = image.getSize()
    if (image.isEmpty() || size.width < 1 || size.height < 1) throw new Error('无法读取预览图片')
    const root = await this.projectDirectory(projectId)
    const filename = `${assetName}-${randomUUID()}${ext}`
    const relPath = `previews/${filename}`
    const destination = join(root, ...relPath.split('/'))
    const hash = createHash('sha256').update(bytes).digest('hex')
    await writeAtomic(destination, bytes)
    return { path: relPath, sha256: hash, width: size.width, height: size.height }
  }

  async setCover(projectId: string, path: string): Promise<WorkCratePreview> {
    return this.queue(projectId, async () => {
      const project = this.requireProject(projectId)
      const preview = await this.makePreview(projectId, path, 'cover')
      const oldPreview = project.mainImage
      const nextProject = { ...project, mainImage: preview }
      const doc = await this.readDocument(projectId)
      doc.project = nextProject
      await this.writeDocument(projectId, doc)
      await this.updateIndex((index) => ({ ...index, projects: index.projects.map((item) => item.id === projectId ? nextProject : item) }))
      if (oldPreview) {
        const root = await this.projectDirectory(projectId)
        await rm(join(root, ...relativeAssetPath(root, oldPreview.path).split('/')), { force: true })
      }
      return preview
    })
  }

  async removeCover(projectId: string): Promise<void> {
    const old = await this.queue(projectId, async () => {
      const project = this.requireProject(projectId)
      const previous = project.mainImage
      if (!previous) return null
      const next = { ...project, mainImage: null }
      const doc = await this.readDocument(projectId)
      doc.project = next
      await this.writeDocument(projectId, doc)
      await this.updateIndex((index) => ({ ...index, projects: index.projects.map((item) => item.id === projectId ? next : item) }))
      return previous
    })
    if (old) {
      const root = await this.projectDirectory(projectId)
      await rm(join(root, ...relativeAssetPath(root, old.path).split('/')), { force: true })
    }
  }

  async setReferencePreview(projectId: string, referenceId: string, path: string): Promise<WorkCratePreview> {
    return this.queue(projectId, async () => {
      const doc = await this.readDocument(projectId)
      const ref = doc.references.find((item) => item.id === referenceId)
      if (!ref) throw new Error('工程引用不存在')
      const preview = await this.makePreview(projectId, path, `reference-${referenceId}`)
      const previous = ref.customPreview
      ref.customPreview = preview
      try {
        await this.writeDocument(projectId, doc)
      } catch (error) {
        const root = await this.projectDirectory(projectId)
        await rm(join(root, ...relativeAssetPath(root, preview.path).split('/')), { force: true })
        throw error
      }
      this.changed(projectId)
      if (previous) {
        const root = await this.projectDirectory(projectId)
        await rm(join(root, ...relativeAssetPath(root, previous.path).split('/')), { force: true })
      }
      return preview
    })
  }

  async removeReferencePreview(projectId: string, referenceId: string): Promise<void> {
    const old = await this.mutateDocument(projectId, (doc) => {
      const ref = doc.references.find((item) => item.id === referenceId)
      if (!ref) throw new Error('工程引用不存在')
      const previous = ref.customPreview
      ref.customPreview = null
      return previous
    })
    if (old) {
      const root = await this.projectDirectory(projectId)
      await rm(join(root, ...relativeAssetPath(root, old.path).split('/')), { force: true })
    }
  }

  async getDocumentPath(projectId: string): Promise<string | null> {
    return (await this.readDocument(projectId)).documentPath
  }

  async documentBinding(projectId: string): Promise<string> {
    return (await this.readDocument(projectId)).documentBinding
  }

  async setDocumentPath(projectId: string, rawPath: string): Promise<{ path: string; binding: string }> {
    const { path } = await canonicalFile(rawPath)
    await this.runLifecycleHook('beforeSetDocumentPath', projectId)
    return this.mutateDocument(projectId, (doc) => {
      doc.documentPath = path
      doc.documentBinding = randomUUID()
      return { path, binding: doc.documentBinding }
    })
  }

  async clearDocumentPath(projectId: string, expectedPath: string): Promise<void> {
    if (!isAbsolute(expectedPath)) throw new Error('原生文档路径必须是绝对路径')
    let expected = resolve(expectedPath)
    try { expected = await realpath(expectedPath) }
    catch (error) {
      const code = (error as NodeJS.ErrnoException).code
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error
    }
    const current = await this.getDocumentPath(projectId)
    if (!current || !samePath(current, expected)) return
    await this.runLifecycleHook('beforeSetDocumentPath', projectId)
    await this.mutateDocument(projectId, (doc) => {
      if (!doc.documentPath || !samePath(doc.documentPath, expected)) return
      doc.documentPath = null
      doc.documentBinding = randomUUID()
    })
  }

  async relocateProject(projectId: string, rawDirectory: string): Promise<string> {
    const directory = await realpath(rawDirectory)
    if (!(await stat(directory)).isDirectory()) throw new Error('目标必须是已存在的目录')
    return this.queue(projectId, async () => {
      await this.runLifecycleHook('beforeRelocate', projectId)
      const source = await this.projectDirectory(projectId)
      const destination = join(directory, '.workcrate', projectId)
      if (within(source, destination) || within(destination, source)) throw new Error('工程不能移动到自身目录或其子目录')
      try { await stat(destination); throw new Error('目标工程目录已存在，不会覆盖') } catch (error) { if ((error as NodeJS.ErrnoException).code !== 'ENOENT') throw error }
      const parent = dirname(destination)
      await mkdir(parent, { recursive: true })
      const parentInfo = await lstat(parent)
      if (!parentInfo.isDirectory() || parentInfo.isSymbolicLink() || (await realpath(parent)).toLocaleLowerCase() !== resolve(parent).toLocaleLowerCase()) {
        throw new Error('目标 .workcrate 目录不能是符号链接或重解析点')
      }
      const stage = `${destination}.${randomUUID()}.tmp`
      try {
        await copyDirectory(source, stage)
        await this.validateStoredProject(stage, projectId)
        await rename(stage, destination)
      } catch (error) {
        await rm(stage, { recursive: true, force: true })
        throw error
      }
      try {
        await this.updateIndex((index) => ({ ...index, locations: { ...index.locations, [projectId]: destination } }))
      } catch (error) {
        await rm(destination, { recursive: true, force: true })
        throw error
      }
      await rm(source, { recursive: true, force: true })
      return destination
    })
  }

  async openProjectFolder(rawDirectory: string): Promise<WorkCrateProject[]> {
    const directory = await realpath(rawDirectory)
    if (!(await stat(directory)).isDirectory()) throw new Error('工程目录必须是文件夹')
    const workcrateRoot = join(directory, '.workcrate')
    let workcrateInfo: Awaited<ReturnType<typeof lstat>>
    try { workcrateInfo = await lstat(workcrateRoot) }
    catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return []; throw error }
    if (!workcrateInfo.isDirectory() || workcrateInfo.isSymbolicLink() || (await realpath(workcrateRoot)).toLocaleLowerCase() !== resolve(workcrateRoot).toLocaleLowerCase()) {
      throw new Error('.workcrate 必须是普通目录，不能是符号链接或重解析点')
    }
    const entries = await readdir(workcrateRoot, { withFileTypes: true })
    const found: Array<{ project: WorkCrateProject; root: string }> = []
    for (const entry of entries) {
      if (!entry.isDirectory() || !z.string().uuid().safeParse(entry.name).success) continue
      const root = join(workcrateRoot, entry.name)
      const rootInfo = await lstat(root)
      if (!rootInfo.isDirectory() || rootInfo.isSymbolicLink() || (await realpath(root)).toLocaleLowerCase() !== resolve(root).toLocaleLowerCase()) throw new Error(`工程目录不能是符号链接：${entry.name}`)
      const doc = await this.validateStoredProject(root, entry.name)
      const candidate = projectSchema.parse(doc.project)
      found.push({ project: candidate, root })
    }
    if (found.length === 0) return []
    await this.queue('index', async () => {
      const names = new Set(this.index.projects.filter((p) => !found.some((x) => x.project.id === p.id)).map((p) => p.name.toLocaleLowerCase()))
      for (const item of found) {
        if (names.has(item.project.name.toLocaleLowerCase())) throw new Error(`已存在同名工程：${item.project.name}`)
        names.add(item.project.name.toLocaleLowerCase())
      }
      for (const item of found) {
        const current = this.index.locations[item.project.id]
        if (current && resolve(current).toLocaleLowerCase() !== resolve(item.root).toLocaleLowerCase()) {
          await this.runLifecycleHook('beforeRelocate', item.project.id)
        }
      }
      await this.updateIndex((index) => {
        const projectById = new Map(index.projects.map((p) => [p.id, p]))
        for (const item of found) projectById.set(item.project.id, item.project)
        const locations = { ...index.locations }
        for (const item of found) locations[item.project.id] = item.root
        return { ...index, projects: [...projectById.values()], locations }
      })
    })
    return found.map((item) => item.project)
  }

  async getProjectPresets(projectId: string): Promise<WorkCrateFieldPresets> {
    return structuredClone((await this.readDocument(projectId)).fieldPresets)
  }

  async saveProjectPresets(projectId: string, presets: WorkCrateFieldPresets): Promise<WorkCrateFieldPresets> {
    const normalized = normalizePresets(fieldPresetsSchema.parse(presets))
    await this.mutateDocument(projectId, (doc) => { doc.fieldPresets = normalized })
    return normalized
  }

  async getProgramPresets(): Promise<WorkCrateFieldPresets> {
    return structuredClone(this.index.programPresets)
  }

  async saveProgramPresets(presets: WorkCrateFieldPresets): Promise<WorkCrateFieldPresets> {
    const normalized = normalizePresets(fieldPresetsSchema.parse(presets))
    await this.queue('index', () => this.updateIndex((index) => ({ ...index, programPresets: normalized })))
    return normalized
  }

  async effectivePresets(projectId?: string): Promise<WorkCrateFieldPresets> {
    const program = this.index.programPresets
    if (!projectId) return structuredClone(program)
    const project = await this.getProjectPresets(projectId)
    const result = new Map(program.fields.map((field) => [field.key, { ...field, values: [...field.values] }]))
    for (const field of project.fields) {
      const inherited = result.get(field.key)
      if (!inherited) result.set(field.key, { ...field, values: [...field.values] })
      else result.set(field.key, { key: field.key, label: field.label, values: [...new Set([...field.values, ...inherited.values])] })
    }
    return { fields: [...result.values()] }
  }

  async promoteProjectField(projectId: string, key: string): Promise<WorkCrateFieldPresets> {
    const project = await this.getProjectPresets(projectId)
    const field = project.fields.find((item) => item.key === key)
    if (!field) throw new Error(`工程字段不存在：${key}`)
    const current = await this.getProgramPresets()
    const map = new Map(current.fields.map((item) => [item.key, item]))
    const existing = map.get(key)
    map.set(key, existing
      ? { ...existing, values: [...new Set([...existing.values, ...field.values])] }
      : structuredClone(field))
    return this.saveProgramPresets({ fields: [...map.values()] })
  }
}

const plugin = {
  name: PLUGIN_ID,
  inject: ['ipc', 'store', 'mcp', 'storage'],
  async apply(ctx: Context): Promise<() => Promise<void>> {
    const service = new WorkCrateProjectsServiceImpl(ctx)
    await service.initialize()
    ctx.storage.register(PLUGIN_ID, {
      title: 'WorkCrate 工程',
      entries: [{ label: '工程数据与最近列表', relativePath: 'data/workcrate', kind: 'directory' }]
    })
    const disposeProvider = ctx.reflect.provide('workcrateProjects', service)

    ctx.ipc.handle('workcrateProjects', {
      list: (includeArchived = false) => service.list(includeArchived),
      get: (projectId: string) => service.get(projectId),
      create: (name: string) => service.create(name),
      delete: (projectId: string) => service.delete(projectId),
      getDocumentPath: (projectId: string) => service.getDocumentPath(projectId),
      getProgramPresets: () => service.getProgramPresets(),
      saveProgramPresets: (presets: WorkCrateFieldPresets) => service.saveProgramPresets(presets),
      effectivePresets: (projectId?: string) => service.effectivePresets(projectId),
      relocateProject: ({ projectId, directory }: { projectId: string; directory: string }) => service.relocateProject(projectId, directory)
    }, {
      list: z.tuple([z.boolean().optional()]),
      get: z.tuple([z.string().uuid()]),
      create: z.tuple([z.string().trim().min(1).max(120)]),
      delete: z.tuple([z.string().uuid()]),
      getDocumentPath: z.tuple([z.string().uuid()]),
      getProgramPresets: z.tuple([]),
      saveProgramPresets: z.tuple([fieldPresetsSchema]),
      effectivePresets: z.union([z.tuple([]), z.tuple([z.string().uuid().nullable().optional()])]),
      relocateProject: z.tuple([z.object({ projectId: z.string().uuid(), directory: z.string().trim().min(1).max(32768) }).strict()])
    })

    const result = async (operation: () => unknown | Promise<unknown>) => {
      try { return mcpText(JSON.stringify((await operation()) ?? null)) }
      catch (error) { return mcpErrorFrom(error) }
    }
    ctx.mcp.registerTool('workcrate_projects_list', {
      description: '列出 WorkCrate 工程。',
      inputSchema: { includeArchived: z.boolean().optional() },
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await service.list(args.includeArchived === true))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_project_get', {
      description: '读取一个 WorkCrate 工程、文件引用、字段预设与原生文档关联。',
      inputSchema: { projectId: z.string().uuid() },
      execute: async (args) => {
        try { return mcpText(JSON.stringify(await service.get(args.projectId as string))) }
        catch (error) { return mcpErrorFrom(error) }
      }
    })
    ctx.mcp.registerTool('workcrate_project_document_get', {
      description: '读取工程关联的原生文档路径和绑定 ID。',
      inputSchema: { projectId: z.string().uuid() },
      execute: async (args) => result(async () => ({ path: await service.getDocumentPath(args.projectId as string), binding: await service.documentBinding(args.projectId as string) }))
    })
    ctx.mcp.registerTool('workcrate_program_presets_get', {
      description: '读取 WorkCrate 各物料字段的程序基础信息选项。',
      execute: () => result(() => service.getProgramPresets())
    })
    ctx.mcp.registerTool('workcrate_program_presets_save', {
      description: '保存 WorkCrate 程序基础信息选项，完整替换字段列表。',
      inputSchema: { presets: fieldPresetsSchema, confirm: z.literal(true) },
      mutating: true, impact: 'low',
      execute: ({ presets }) => result(() => service.saveProgramPresets(presets as WorkCrateFieldPresets))
    })
    return async () => { await disposeProvider() }
  }
}

export default plugin
