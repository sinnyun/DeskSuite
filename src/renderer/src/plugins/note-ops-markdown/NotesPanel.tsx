import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { ComponentType, ReactElement } from 'react'
import { parse as parseYaml, parseDocument, isMap } from 'yaml'
import { z } from 'zod'
import { Archive, BookOpen, Clock3, Download, FilePlus2, FolderOpen, History, ImagePlus, Info, Link2, MoreHorizontal, PanelLeftClose, PanelLeftOpen, PanelRightClose, PanelRightOpen, RefreshCw, Search, Tags } from 'lucide-react'
import { call, callValidated, errorText, getService, useLayoutShallow, useUiKit } from '../../workbench/sdk'

interface FsEntry { name: string; path: string; isDirectory: boolean; kind: string; size: number; modifiedAt: number }
interface NoteFile extends FsEntry { title: string; tags?: string[] }
interface Plan { planId: string; target: string; expiresAt: number }

const noteTextResultSchema = z.object({
  path: z.string().min(1).max(32_768),
  content: z.string().max(200_000),
  truncated: z.boolean()
}).strict()

async function readNoteText(path: string): Promise<z.infer<typeof noteTextResultSchema>> {
  const result = await callValidated(noteTextResultSchema, 'filesystem', 'readText', path)
  if (result.path !== path) throw new Error('文件系统返回的笔记路径与请求不一致')
  return result
}

const MAX_FRONTMATTER_CHARS = 256 * 1024
const noteFrontmatterSchema = z.object({
  tags: z.union([z.string().max(20_000), z.array(z.string().max(200)).max(100)]).optional(),
  title: z.string().max(1000).optional(),
  category: z.string().max(240).optional(),
  status: z.string().max(120).optional(),
  date: z.string().max(120).optional()
}).passthrough()

/** note-provider-editor 服务的组件契约，类型在本插件内镜像，不做跨插件文件导入。 */
interface NoteEditorApi {
  getMarkdown: () => string
  replaceMarkdown: (markdown: string) => Promise<void>
  completeWikiLink?: (candidate: WikiLinkCandidate) => void
  getOutline?: () => Array<{ level: number; text: string; line: number }>
  getStats?: () => { characters: number; words: number; readingMinutes: number }
  findNext?: (query: string) => boolean
  replaceCurrent?: (query: string, replacement: string) => boolean
  replaceAll?: (query: string, replacement: string) => number
}
interface WikiLinkCandidate { target: string; label?: string }

interface NoteEditorProps {
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
  resolveImageSrc?: (src: string) => Promise<string | null>
  uploadImage?: (file: File) => Promise<string>
  onReady?: (api: NoteEditorApi | null) => void
  onWikiLinkQuery?: (query: string | null) => void
  onWikiLinkOpen?: (target: string, label?: string) => void
  sourceMode?: boolean
  onSourceModeChange?: (sourceMode: boolean) => void
}

/** 面板当前状态的快照，供 MCP 桥接读取，每次渲染刷新。 */
interface LiveState {
  root: string
  files: NoteFile[]
  activePath: string
  content: string
  dirty: boolean
  openNote: (file: NoteFile) => Promise<void>
  setRootDir: (path: string) => Promise<void>
  createNote: (title: string) => Promise<string>
  save: () => Promise<{ planId: string; path: string }>
  pendingExecution: boolean
  error: string
}

interface NotePreferences { rootDir: string | null; lastNote: string | null; recentPaths: string[] }
interface NoteAttributes { title: string; tags: string; category: string; status: string; date: string }
interface LoreVersion { versionId: string; revisionNumber: number; title: string; createdAt: string; sizeBytes: number; isCurrent: boolean }
interface TagAggregate { tag: string; count: number; paths: string[] }
const versionJobStartSchema = z.object({ jobId: z.string().min(1).max(256) }).passthrough()
const jobDoneSchema = z.object({
  id: z.string().min(1).max(256),
  state: z.enum(['done', 'failed', 'canceled']),
  error: z.string().optional()
}).transform(({ id, state, error }) => ({ id, state, error: error?.slice(0, 2048) }))
type JobDone = z.infer<typeof jobDoneSchema>
interface ResourceInfo { uri: string; url: string; name: string; kind: string; available: boolean }
interface ResourceClient {
  register(path: string): Promise<ResourceInfo>
  registerFile(file: File): Promise<ResourceInfo>
  resolve(reference: string): Promise<ResourceInfo>
  choose(): Promise<ResourceInfo[]>
}

const MAX_FILES = 5000
const MAX_DEPTH = 6

export function NotesPanel(): ReactElement | null {
  const { ThemeFloatingPanel, ThemeSidebarPanel, ThemeCollapsibleSection, DesktopButton, DesktopIconButton, DesktopInput, DesktopSelect, DesktopTagPill } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, openFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, openFloatingPanel: state.openFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const NoteEditor = getService<ComponentType<NoteEditorProps>>('noteEditor') ?? PlainNoteEditor
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'notes'
  const [root, setRoot] = useState('')
  const [files, setFiles] = useState<NoteFile[]>([])
  const [directories, setDirectories] = useState<string[]>([])
  const [targetDirectory, setTargetDirectory] = useState('')
  const [filter, setFilter] = useState('')
  const [sort, setSort] = useState<'name' | 'modified'>('name')
  const [externalChange, setExternalChange] = useState(false)
  const [allowOverwrite, setAllowOverwrite] = useState(false)
  const [fullTextSearch, setFullTextSearch] = useState(false)
  const [fullTextPaths, setFullTextPaths] = useState<string[] | null>(null)
  const [scanWarning, setScanWarning] = useState('')
  const [recentPaths, setRecentPaths] = useState<string[]>([])
  const [wikiQuery, setWikiQuery] = useState<string | null>(null)
  const [wikiTarget, setWikiTarget] = useState('')
  const [template, setTemplate] = useState<'blank' | 'meeting' | 'project' | 'daily'>('blank')
  const [showTrash, setShowTrash] = useState(false)
  const [eagleSourceInput, setEagleSourceInput] = useState('')
  const [sourceMode, setSourceMode] = useState(false)
  const [readingMode, setReadingMode] = useState(false)
  const [searchTerm, setSearchTerm] = useState('')
  const [replaceTerm, setReplaceTerm] = useState('')
  const [attributes, setAttributes] = useState<NoteAttributes>({ title: '', tags: '', category: '', status: '', date: '' })
  const [tagStats, setTagStats] = useState<TagAggregate[]>([])
  const [tagLoading, setTagLoading] = useState(false)
  const [tagIndexLoaded, setTagIndexLoaded] = useState(false)
  const [tagFilter, setTagFilter] = useState('')
  const [tagIndexCapped, setTagIndexCapped] = useState(false)
  const [versions, setVersions] = useState<LoreVersion[]>([])
  const [historyOpen, setHistoryOpen] = useState(false)
  const [historyTitle, setHistoryTitle] = useState('')
  const [activePath, setActivePath] = useState('')
  const [content, setContent] = useState('')
  const [savedContent, setSavedContent] = useState('')
  const [draftIsNew, setDraftIsNew] = useState(false)
  const [revision, setRevision] = useState(0)
  const [pendingExecution, setPendingExecution] = useState(false)
  const savingRef = useRef(false)
  const [autoSaveStatus, setAutoSaveStatus] = useState<'saved' | 'waiting' | 'saving' | 'error'>('saved')
  const autoSaveRetryCount = useRef(0)
  const [autoSaveRetry, setAutoSaveRetry] = useState(0)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [message, setMessage] = useState('')
  const [backlinks, setBacklinks] = useState<NoteFile[]>([])
  const [leftCollapsed, setLeftCollapsed] = useState(false)
  const [rightCollapsed, setRightCollapsed] = useState(false)
  const [creating, setCreating] = useState(false)
  const [draftTitle, setDraftTitle] = useState('')
  const [prefsLoaded, setPrefsLoaded] = useState(false)
  const editorApi = useRef<NoteEditorApi | null>(null)
  const live = useRef<LiveState | null>(null)
  const sessionVersion = useRef(0)

  const activeNote = files.find((file) => samePath(file.path, activePath))
  const resourceClient = getService<ResourceClient>('resources')
  const dirty = content !== savedContent
  const noteDoc = useMemo(() => readNoteDocument(content), [content])
  const visibleFiles = useMemo(() => {
    const query = filter.trim().normalize('NFKC').toLocaleLowerCase()
    const selectedTags = tagFilter.split(',').map((tag) => tag.trim()).filter(Boolean)
    return files.filter((file) => {
      const matchesTag = selectedTags.every((tag) => tagStats.some((item) => item.tag === tag && item.paths.some((path) => samePath(path, file.path))))
      return (!targetDirectory || samePath(dirname(file.path), targetDirectory))
        && (!query || `${file.title} ${file.path}`.normalize('NFKC').toLocaleLowerCase().includes(query))
        && (!fullTextSearch || fullTextPaths?.includes(file.path))
        && matchesTag
    })
      .sort((a, b) => sort === 'name' ? a.title.localeCompare(b.title, 'zh-CN') || a.path.localeCompare(b.path) : b.modifiedAt - a.modifiedAt)
  }, [files, filter, sort, targetDirectory, fullTextSearch, fullTextPaths, tagFilter, tagStats])
  const wikiCandidates = useMemo(() => {
    if (wikiQuery === null) return []
    const query = wikiQuery.normalize('NFKC').toLocaleLowerCase()
    return files.filter((file) => !query || `${file.title} ${file.path}`.normalize('NFKC').toLocaleLowerCase().includes(query))
      .slice(0, 12).map((file) => ({ target: files.filter((candidate) => candidate.title === file.title).length > 1 ? relativePath(root, file.path).replace(/\.md$/i, '') : file.title, label: relativePath(root, file.path) }))
  }, [files, root, wikiQuery])
  const outline = useMemo(() => [...noteDoc.body.matchAll(/^(#{1,6})\s+(.+?)\s*#*\s*$/gm)].map((match) => ({ level: match[1].length, title: match[2], offset: match.index ?? 0 })), [noteDoc.body])
  const wordStats = useMemo(() => {
    const text = noteDoc.body.trim()
    const chars = [...text].length
    const words = (text.match(/[\p{L}\p{N}]+/gu) ?? []).length
    return { chars, words, minutes: Math.max(1, Math.ceil(words / 250)) }
  }, [noteDoc.body])

  useEffect(() => { setTagStats([]); setTagIndexLoaded(false); setTagFilter('') }, [files])
  const applyBody = useCallback((markdown: string): void => {
    setContent((prev) => `${readNoteDocument(prev).front}${markdown}`)
  }, [])

  const handleEditorReady = useCallback((api: NoteEditorApi | null): void => {
    editorApi.current = api
  }, [])

  const resolveImageSrc = useCallback(async (src: string): Promise<string | null> => {
    if (!resourceClient || !root || !activePath || src.startsWith('//') || /^(https?:|data:|blob:)/i.test(src)) return null
    try {
      let reference = src
      if (!/^desksuite-resource:/i.test(src)) {
        const target = /^(?:[a-z]:[\\/]|\\\\)/i.test(src) ? src : resolveRelative(dirname(activePath), src)
        if (!isInside(root, target)) return null
        reference = (await resourceClient.register(target)).uri
      }
      const resource = await resourceClient.resolve(reference)
      if (!resource.available || resource.kind !== 'image') return null
      return resource.url
    } catch {
      return null
    }
  }, [activePath, resourceClient, root])

  const uploadImage = useCallback(async (file: File): Promise<string> => {
    if (!resourceClient) throw new Error('统一资源服务不可用，无法插入图片')
    const resource = await resourceClient.registerFile(file)
    if (!resource.available || resource.kind !== 'image') throw new Error('只支持插入可用的本地图片文件')
    return resource.uri
  }, [resourceClient])

  const insertResources = async (): Promise<void> => {
    if (!resourceClient) { setError('统一资源服务不可用'); return }
    try {
      const chosen = await resourceClient.choose()
      const refs = chosen.filter((item) => item.available).map((item) => item.kind === 'image'
        ? `![${escapeMarkdownLabel(item.name)}](${item.uri})`
        : `[${escapeMarkdownLabel(item.name)}](${item.uri})`)
      if (!refs.length) return
      const current = editorApi.current?.getMarkdown() ?? noteDoc.body
      const next = `${current.replace(/\s*$/, '')}\n\n${refs.join('\n')}\n`
      await editorApi.current?.replaceMarkdown(next)
      applyBody(next)
      setMessage(`已插入 ${refs.length} 个资源链接；原文件保持在原位置`)
    } catch (cause) { setError(`${messageOf(cause, '插入资源链接失败')}；内存图片不支持直接保存，请先保存到磁盘`) }
  }

  const linkEagleSource = async (): Promise<void> => {
    const match = eagleSourceInput.trim().match(/^eagle:\/\/item\/([a-z0-9]{1,100})\/?$/i)
    if (!match) { setError('请输入 eagle://item/<ID> 来源链接'); return }
    try {
      const source = await call<{ resourceUri: string; name: string }>('eagleLinks', 'link', { itemId: match[1] })
      const reference = `![${escapeMarkdownLabel(source.name)}](${source.resourceUri})`
      const current = editorApi.current?.getMarkdown() ?? noteDoc.body
      const next = `${current.replace(/\s*$/, '')}\n\n${reference}\n`
      await editorApi.current?.replaceMarkdown(next)
      applyBody(next)
      setEagleSourceInput('')
      setMessage('Eagle 原图已登记为统一资源链接，原文件仍在 Eagle 库中')
    } catch (cause) { setError(`Eagle 来源无法登记：${messageOf(cause, 'Eagle 来源登记失败')}`) }
  }

  const reloadActive = async (): Promise<void> => {
    if (!activePath) return
    const result = await readNoteText(activePath)
    if (result.truncated) throw new Error('笔记超过读取上限，无法重新加载')
    setContent(result.content); setSavedContent(result.content); setExternalChange(false)
    setRevision((value) => value + 1)
    setMessage('已从磁盘重新加载')
  }

  const exportMarkdown = (): void => {
    if (!activePath) return
    const blob = new Blob([content], { type: 'text/markdown;charset=utf-8' })
    downloadBlob(blob, activePath.split(/[\\/]/).pop() || 'note.md')
  }

  const exportHtml = (): void => {
    if (!activePath) return
    const safe = escapeHtml(content)
    const linked = safe.replace(/(!?)\[([^\]]*)\]\((desksuite-resource:[^)]+)\)/gi, (_match, image: string, label: string, uri: string) => `<a href="${escapeAttribute(uri)}">${image ? `图片：${label}` : label || uri}</a>`)
    const html = `<!doctype html><meta charset="utf-8"><title>${escapeHtml(activeNote?.title ?? '笔记')}</title><article><pre>${linked}</pre></article>`
    downloadBlob(new Blob([html], { type: 'text/html;charset=utf-8' }), `${(activeNote?.title ?? 'note').replace(/[\\/:*?"<>|]/g, '_')}.html`)
  }

  const applyAttributes = (): void => {
    if (!activePath) return
    try {
      setContent((current) => patchFrontmatter(current, attributes))
      setMessage('笔记属性已更新；保存后写入原 Markdown 文件')
    } catch (cause) { setError(`属性未更新：${messageOf(cause, '笔记属性更新失败')}`) }
  }

  const loadTagIndex = async (): Promise<void> => {
    setTagLoading(true); setError('')
    const counts = new Map<string, string[]>()
    const scope = files.filter((file) => file.size <= 128 * 1024).slice(0, 1000)
    try {
      for (let index = 0; index < scope.length; index += 12) {
        const results = await Promise.all(scope.slice(index, index + 12).map(async (file) => {
          try {
            const read = await readNoteText(file.path)
            if (read.truncated) return null
            return { file, tags: readNoteDocument(read.content).meta.tags }
          } catch { return null }
        }))
        for (const result of results) if (result) for (const raw of result.tags) {
          const tag = raw.trim()
          if (tag) counts.set(tag, [...(counts.get(tag) ?? []), result.file.path])
        }
      }
      setTagStats([...counts].map(([tag, paths]) => ({ tag, count: paths.length, paths })).sort((a, b) => a.tag.localeCompare(b.tag, 'zh-CN')))
      setTagIndexLoaded(true)
      setTagIndexCapped(scope.length < files.length)
      setMessage(`标签聚合完成：${counts.size} 个标签，基于 ${scope.length} 篇笔记`)
    } catch (cause) { setError(`标签聚合失败：${messageOf(cause, '标签索引读取失败')}`) }
    finally { setTagLoading(false) }
  }

  const refreshHistory = async (path = activePath): Promise<void> => {
    if (!path) { setVersions([]); return }
    try { setVersions(await call<LoreVersion[]>('versions', 'list', path)) }
    catch { setVersions([]); setMessage('Lore 历史服务不可用或此笔记尚未建立历史') }
  }

  const createHistory = async (titleOverride?: string): Promise<boolean> => {
    if (!activePath || dirty || pendingExecution) throw new Error('请先保存笔记正文，再创建 Lore 历史快照')
    setBusy(true); setError('')
    try {
      await runVersionJob(() => call<{ jobId: string }>('versions', 'create', activePath, titleOverride?.trim() || historyTitle.trim() || `笔记快照 ${new Date().toLocaleString('zh-CN')}`))
      setHistoryTitle(''); await refreshHistory(); setMessage('Lore 历史快照已创建')
      return true
    } catch (cause) { setError(`创建历史快照失败：${messageOf(cause, 'Lore 快照创建失败')}`); throw cause }
    finally { setBusy(false) }
  }

  const restoreHistory = async (version: LoreVersion): Promise<boolean> => {
    if (!activePath || dirty || pendingExecution) throw new Error('请先保存或丢弃当前草稿，再恢复历史')
    if (!window.confirm(`恢复 Lore 版本「${version.title}」？当前 Markdown 文件将被替换。`)) return false
    setBusy(true); setError('')
    try {
      await runVersionJob(() => call<{ jobId: string }>('versions', 'restore', activePath, version.versionId, true))
      await reloadActive(); await refreshHistory(); setMessage('已恢复所选 Lore 版本')
      return true
    } catch (cause) { setError(`恢复历史失败：${messageOf(cause, 'Lore 历史恢复失败')}`); throw cause }
    finally { setBusy(false) }
  }

  const toggleTagFilter = (tag: string): void => {
    const selected = tagFilter.split(',').map((item) => item.trim()).filter(Boolean)
    setTagFilter(selected.includes(tag) ? selected.filter((item) => item !== tag).join(', ') : [...selected, tag].join(', '))
  }

  const runFullTextSearch = async (): Promise<void> => {
    const query = filter.trim().normalize('NFKC').toLocaleLowerCase()
    if (!query) { setFullTextPaths(null); return }
    setBusy(true); setError(''); setFullTextPaths([])
    const matches: string[] = []
    try {
      for (let i = 0; i < files.length; i += 10) {
        const batch = files.slice(i, i + 10)
        const results = await Promise.all(batch.map(async (file) => {
          try { const result = await readNoteText(file.path); return !result.truncated && result.content.normalize('NFKC').toLocaleLowerCase().includes(query) ? file.path : null }
          catch { return null }
        }))
        matches.push(...results.filter((path): path is string => path !== null))
      }
      setFullTextPaths(matches); setFullTextSearch(true); setMessage(`全文搜索完成：${matches.length} 篇命中`)
    } catch (cause) { setError(messageOf(cause)) }
    finally { setBusy(false) }
  }

  const jumpWikiTarget = async (target: string): Promise<void> => {
    const [filePart, anchorPart] = target.split('#')
    const normalized = filePart.split('|')[0].trim().normalize('NFKC').toLocaleLowerCase().replace(/\.md$/i, '')
    const matches = files.filter((file) => file.title.normalize('NFKC').toLocaleLowerCase() === normalized || relativePath(root, file.path).replace(/\.md$/i, '').normalize('NFKC').toLocaleLowerCase() === normalized)
    if (matches.length === 1) {
      await openNote(matches[0]); setWikiTarget('')
      if (anchorPart) window.setTimeout(() => {
        const wanted = anchorPart.normalize('NFKC').toLocaleLowerCase().replace(/[^\p{L}\p{N}\s-]/gu, '').trim().replace(/\s+/g, '-')
        const elements = document.querySelectorAll('[data-note-editor] h1,[data-note-editor] h2,[data-note-editor] h3,[data-note-editor] h4,[data-note-editor] h5,[data-note-editor] h6')
        const found = [...elements].find((element) => element.textContent?.trim().normalize('NFKC').toLocaleLowerCase() === anchorPart.normalize('NFKC').toLocaleLowerCase() || element.id === wanted) as HTMLElement | undefined
        found?.scrollIntoView({ block: 'center', behavior: 'smooth' })
      }, 50)
      return
    }
    if (matches.length > 1) { setWikiTarget(target); setMessage(`“${target}”有多个匹配项，请从左侧选定具体路径`); setFilter(target); return }
    setError(`尚无目标笔记“${target}”；可先新建笔记并使用相同标题`)
    setDraftTitle(target.split('#')[0].split('|')[0].trim())
    setCreating(true)
  }

  const handleWikiOpen = useCallback((target: string, _label?: string): void => { void jumpWikiTarget(target) }, [files, root, activePath, dirty])
  const handleWikiQuery = useCallback((query: string | null): void => { setWikiQuery(query) }, [])

  const scanNotes = useCallback(async (base: string): Promise<NoteFile[]> => {
    setScanWarning('')
    const found: NoteFile[] = []
    const foundDirectories = new Set<string>([base])
    const visit = async (directory: string, depth: number): Promise<void> => {
      if (depth > MAX_DEPTH || found.length >= MAX_FILES) return
      let listing: { entries: FsEntry[]; nextCursor?: string | null }
      try { listing = await call<{ entries: FsEntry[]; nextCursor?: string | null }>('filesystem', 'listDir', directory) }
      catch (cause) { setScanWarning((previous) => `${previous}${previous ? '；' : ''}${relativePath(base, directory)}：${messageOf(cause)}`); return }
      while (true) {
        for (const entry of listing.entries) {
          if (entry.isDirectory) {
            if ((entry.name !== '.trash' || showTrash) && entry.name !== 'assets' && (showTrash || !entry.name.startsWith('.'))) { foundDirectories.add(entry.path); await visit(entry.path, depth + 1) }
          } else if (/\.md$/i.test(entry.name)) {
            found.push({ ...entry, title: entry.name.replace(/\.md$/i, '') })
            if (found.length >= MAX_FILES) return
          }
        }
        if (!listing.nextCursor || found.length >= MAX_FILES) break
        listing = await call<{ entries: FsEntry[]; nextCursor?: string | null }>('filesystem', 'listMore', listing.nextCursor)
      }
    }
    await visit(base, 0)
    setDirectories([...foundDirectories].sort((a, b) => a.localeCompare(b, 'zh-CN')))
    return found
  }, [showTrash])

  const refresh = useCallback(async (base = root): Promise<void> => {
    if (!base) return
    setBusy(true)
    setError('')
    try {
      const next = await scanNotes(base)
      setFiles(next)
      if (activePath && next.some((file) => file.path === activePath)) return
      if (dirty) { setError('当前笔记有未保存内容，请先保存或切换目录后再刷新'); return }
      if (next.length) {
        const first = next[0]
        const result = await readNoteText(first.path)
        if (result.truncated) throw new Error('首篇笔记超过 20 万字符预览上限，请从列表选择其他笔记')
        setActivePath(first.path)
        setContent(result.content)
        setSavedContent(result.content)
        setRevision((value) => value + 1)
      } else { setActivePath(''); setContent(''); setSavedContent('') }
    } catch (cause) {
      setError(messageOf(cause))
    } finally { setBusy(false) }
  }, [activePath, dirty, root, scanNotes])

  /** 扫描目录并把指定（或首篇）笔记装进编辑器；启动恢复与切换目录共用。 */
  const loadDirectory = useCallback(async (base: string, preferredPath = ''): Promise<void> => {
      const request = ++sessionVersion.current
    setBusy(true)
    setError('')
    try {
      const next = await scanNotes(base)
      if (request !== sessionVersion.current) return
      const target = next.find((file) => preferredPath && samePath(file.path, preferredPath)) ?? next[0]
      setRoot(base)
      setTargetDirectory(base)
      setFiles(next)
      if (!target) { setActivePath(''); setContent(''); setSavedContent(''); return }
      const result = await readNoteText(target.path)
      if (request !== sessionVersion.current) return
      if (result.truncated) throw new Error('笔记超过文本预览上限（20 万字符），为避免覆盖未读内容，无法打开编辑')
      const recovery = await call<{ markdown: string } | null>('notePanel', 'loadDraft', target.path)
      if (request !== sessionVersion.current) return
      setActivePath(target.path)
      setContent(recovery?.markdown ?? result.content)
      setSavedContent(result.content)
      setDraftIsNew(false)
      if (recovery) setMessage('已恢复未保存草稿；磁盘原文未被修改')
      setRevision((value) => value + 1)
    } catch (cause) {
      setError(messageOf(cause))
      throw cause
    } finally { setBusy(false) }
  }, [scanNotes])

  const openNote = useCallback(async (file: NoteFile): Promise<void> => {
    if (samePath(activePath, file.path)) return
    if (dirty && activePath) await live.current?.save()
    const request = ++sessionVersion.current
    setBusy(true)
    setError('')
    try {
      const result = await readNoteText(file.path)
      if (request !== sessionVersion.current) return
      if (result.truncated) throw new Error('笔记超过文本预览上限（20 万字符），为避免覆盖未读内容，无法打开编辑')
      const recovery = await call<{ markdown: string } | null>('notePanel', 'loadDraft', file.path)
      if (request !== sessionVersion.current) return
      setActivePath(file.path)
      setContent(recovery?.markdown ?? result.content)
      setSavedContent(result.content)
      setDraftIsNew(false)
      setExternalChange(false)
      setAllowOverwrite(false)
      setRecentPaths((previous) => {
        const next = [file.path, ...previous.filter((path) => !samePath(path, file.path))].slice(0, 20)
        void call('notePanel', 'rememberPreferences', { rootDir: root, lastNote: file.path, recentPaths: next })
          .catch((cause) => setError(`最近笔记未能记住：${messageOf(cause)}`))
        return next
      })
      if (recovery) setMessage('已恢复未保存草稿；磁盘原文未被修改')
      setRevision((value) => value + 1)
    } catch (cause) { setError(messageOf(cause)); throw cause }
    finally { setBusy(false) }
  }, [activePath, dirty])

  const chooseRoot = async (): Promise<void> => {
    try {
      const selected = await call<string | null>('notePanel', 'pickDirectory')
      if (!selected) return
      if (dirty) {
        if (!samePath(selected, root)) throw new Error('当前笔记有未保存内容，请先保存再切换目录')
        setError('')
        setMessage('笔记目录已授权写入，请继续保存')
        return
      }
      await loadDirectory(selected)
    } catch (cause) { setError(messageOf(cause)) }
  }

  /** 直接指定笔记目录（不经系统选择框），供 MCP 驱动与启动恢复使用。 */
  const setRootDir = useCallback(async (path: string): Promise<void> => {
    if (dirty && activePath) await live.current?.save()
    await call('filesystem', 'listDir', path, 1)
    setActivePath('')
    setContent('')
    setSavedContent('')
    setFiles([])
    await loadDirectory(path)
  }, [activePath, dirty, loadDirectory])

  /** Electron 不支持 window.prompt，新建一律走面板内联输入或 MCP 的 new 动作；正文写入仍要经保存审批。 */
  const createNote = useCallback(async (rawTitle: string): Promise<string> => {
    const date = new Date().toISOString().slice(0, 10)
    const title = rawTitle.trim() || (template === 'daily' ? date : '')
    if (pendingExecution) throw new Error('正在自动保存，请稍候再新建')
    if (dirty && activePath) await live.current?.save()
    if (!root) throw new Error('请先选择笔记目录')
    if (!title) throw new Error('请输入笔记标题')
    const base = targetDirectory && isInside(root, targetDirectory) ? targetDirectory : root
    const path = joinPath(base, `${slug(title)}.md`)
    if (files.some((file) => samePath(file.path, path))) throw new Error('同名笔记已存在')
    if (template === 'daily') {
      const daily = joinPath(base, `${date}.md`)
      const existing = files.find((file) => samePath(file.path, daily))
      if (existing) { await openNote(existing); setCreating(false); return existing.path }
    }
    const bodies: Record<typeof template, string> = {
      blank: `# ${title}\n\n`,
      meeting: `# ${title}\n\n## 会议时间\n\n## 参与者\n\n## 议题\n\n## 结论\n\n## 待办\n\n`,
      project: `# ${title}\n\n## 目标\n\n## 进展\n\n## 决策\n\n## 下一步\n\n`,
      daily: `# ${date}\n\n## 今日安排\n\n## 记录\n\n## 回顾\n\n`
    }
    const noteTitle = template === 'daily' ? date : title
    const draft = `---\nid: ${crypto.randomUUID()}\ntitle: ${JSON.stringify(noteTitle)}\ncategory: notes\nstatus: draft\ntags: []\n---\n\n${bodies[template]}`
    setActivePath(path)
    setContent(draft)
    setSavedContent('')
      setDraftIsNew(true)
    setRevision((value) => value + 1)
    setCreating(false)
    setDraftTitle('')
    setError('')
    setMessage('新笔记已创建，正在自动保存')
    return path
  }, [activePath, dirty, files, openNote, pendingExecution, root, targetDirectory, template])

  // 直接读取编辑器快照；内容未变化时不创建计划，也不触碰文件时间戳。
  const save = async (): Promise<{ planId: string; path: string }> => {
    if (!activePath) throw new Error('尚未打开笔记，无法保存')
    if (pendingExecution || savingRef.current) {
      while (savingRef.current) await new Promise((resolve) => window.setTimeout(resolve, 40))
      const latest = live.current
      if (!latest?.dirty) return { planId: '', path: latest?.activePath ?? activePath }
      if (latest.save !== save) return latest.save()
      throw new Error('自动保存尚未完成，请稍后重试')
    }
    const markdown = editorApi.current?.getMarkdown() ?? noteDoc.body
    const snapshot = `${noteDoc.front}${markdown}`
    if (snapshot === savedContent) {
      setAutoSaveStatus('saved')
      return { planId: '', path: activePath }
    }
    savingRef.current = true
    setPendingExecution(true)
    setAutoSaveStatus('saving')
    setError('')
    setMessage('')
    try {
      // A new note must never intentionally replace a file that appeared after the initial scan.
      const siblings = await call<{ entries: FsEntry[]; nextCursor?: string | null }>('filesystem', 'listDir', dirname(activePath))
      if (draftIsNew && siblings.entries.some((entry) => !entry.isDirectory && samePath(entry.path, activePath))) {
        throw new Error('同名文件已在磁盘出现。请取消新建并打开该文件，或更改标题后重试')
      }
      // Compare the disk text with the version opened in the editor before making a write plan.
      if (!draftIsNew && !allowOverwrite) {
        const disk = await readNoteText(activePath)
        if (disk.truncated) throw new Error('当前文件超过读取上限，无法安全比较外部修改')
        if (disk.content !== savedContent) {
          setExternalChange(true)
          throw new Error('检测到磁盘内容与打开时不同。请先重新加载，或通过“明确覆盖”再次保存')
        }
      }
      const plan = await call<Plan>('fileOps', 'writeText', activePath, snapshot, { noOverwrite: draftIsNew })
      // 选择笔记目录时用户已授权该目录写入；自动保存沿用 fileOps 计划、指纹校验、任务与审计。
      if (!await call<boolean>('fileOps', 'approve', plan.planId)) throw new Error('自动保存计划已失效，请稍后重试')
      const waiting = waitForPlanResult(plan.planId)
      try {
        await call('fileOps', 'execute', plan.planId)
        const completion = await waiting.promise
        const result = completion.results?.[0]
        if (result?.status !== 'completed') throw new Error(result?.message ?? completion.error ?? '笔记自动保存未完成')
      } catch (cause) {
        waiting.cancel()
        throw cause
      }
      setSavedContent(snapshot)
      setDraftIsNew(false)
      setAllowOverwrite(false)
      setExternalChange(false)
      setAutoSaveStatus('saved')
      autoSaveRetryCount.current = 0
      try { await call('notePanel', 'clearDraft', activePath) } catch { setMessage('笔记已保存，但恢复草稿暂未清理') }
      // Update only the saved file's list metadata; persistence must not reload the directory/editor.
      setFiles((previous) => {
        const name = activePath.split(/[\\/]/).pop() || 'note.md'
        const metadata = { size: new TextEncoder().encode(snapshot).length, modifiedAt: Date.now() }
        return previous.some((file) => samePath(file.path, activePath))
          ? previous.map((file) => samePath(file.path, activePath) ? { ...file, ...metadata } : file)
          : [...previous, { name, path: activePath, title: name.replace(/\.md$/i, ''), isDirectory: false, kind: 'file', ...metadata }]
      })
      setMessage('已自动保存')
      return { planId: plan.planId, path: activePath }
    } catch (cause) {
      setAutoSaveStatus('error')
      setError(`${messageOf(cause)}；若目录未授权，请重新点击「笔记目录」选择该目录`)
      throw cause
    } finally {
      savingRef.current = false
      setPendingExecution(false)
    }
  }

  const archiveNote = async (): Promise<boolean> => {
    if (!root || !activePath || dirty || pendingExecution) throw new Error('请先保存或丢弃草稿，再归档笔记')
    if (!window.confirm('将这篇笔记移入笔记目录的 .trash 文件夹？')) return false
    const trashDirectory = joinPath(root, '.trash')
    setBusy(true)
    setError('')
    setMessage('')
    try {
      await executeApprovedPlan('mkdir', [], trashDirectory, 'skip')
      await executeApprovedPlan('move', [activePath], trashDirectory, 'rename')
      setActivePath('')
      setContent('')
      setSavedContent('')
      setRevision((value) => value + 1)
      setMessage('笔记已移入 .trash')
      await refresh(root)
      return true
    } catch (cause) { setError(messageOf(cause)); throw cause }
    finally { setBusy(false) }
  }

  const restoreNote = async (): Promise<boolean> => {
    if (!root || !activePath || !samePath(dirname(dirname(activePath)), root) || dirty || pendingExecution) throw new Error('请选择回收区内的笔记，并先保存或丢弃草稿')
    if (!window.confirm('将此笔记从回收区恢复到笔记根目录？若发生重名，文件操作会自动改名。')) return false
    const destination = joinPath(root, activePath.split(/[\\/]/).pop() || '')
    setBusy(true); setError('')
    try {
      await executeApprovedPlan('move', [activePath], root, 'rename')
      setActivePath(''); setContent(''); setSavedContent(''); setRevision((value) => value + 1)
      setDraftIsNew(false)
      setMessage('笔记已从回收区恢复；如原位置有同名文件，系统会自动改名')
      await refresh(root)
      void destination
      return true
    } catch (cause) { setError(messageOf(cause)); throw cause }
    finally { setBusy(false) }
  }

  const refreshNotes = async (): Promise<void> => {
    if (!root) return
    const oldActive = activePath
    const oldSaved = savedContent
    await refresh(root)
    if (oldActive) {
      try {
        const disk = await readNoteText(oldActive)
        if (!disk.truncated && disk.content !== oldSaved) { setExternalChange(true); setMessage('检测到当前笔记已被外部修改；磁盘版本仍被保留') }
      } catch { setError('当前笔记已无法从磁盘读取，未保存内容仍保留在编辑器中') }
    }
  }

  const jumpToHeading = (heading: { title: string; offset: number }): void => {
    const editor = document.querySelector('[data-note-editor]')
    const matching = editor?.querySelectorAll('h1,h2,h3,h4,h5,h6')
    const target = [...(matching ?? [])].find((element) => element.textContent?.trim() === heading.title) as HTMLElement | undefined
    target?.scrollIntoView({ block: 'center', behavior: 'smooth' })
  }

  const addWikiLink = (): void => {
    const candidate = wikiCandidates[0] ?? { target: wikiQuery || '' }
    if (!candidate.target) return
    editorApi.current?.completeWikiLink?.(candidate)
    if (!wikiCandidates.length) { setDraftTitle(wikiQuery || ''); setCreating(true); setMessage('双链已插入；可同时创建对应笔记') }
    setWikiQuery(null)
  }

  live.current = { root, files, activePath, content, dirty, openNote, setRootDir, createNote, save, pendingExecution, error }

  // 启动时恢复上次选择的目录与打开项；目录被改名或删除时保持未选择状态并说明原因。
  const restored = useRef(false)
  const previousShowTrash = useRef(showTrash)
  useEffect(() => {
    if (previousShowTrash.current === showTrash) return
    previousShowTrash.current = showTrash
    if (prefsLoaded && root) void refresh(root)
  }, [showTrash])

  useEffect(() => {
    if (restored.current) return
    restored.current = true
    void (async () => {
      try {
        const preferences = await call<NotePreferences>('notePanel', 'loadPreferences')
        setRecentPaths(preferences?.recentPaths ?? [])
        if (preferences?.rootDir) {
          await call('filesystem', 'listDir', preferences.rootDir, 1)
          await loadDirectory(preferences.rootDir, preferences.lastNote ?? '')
        }
      } catch (cause) {
        setError(`上次的笔记目录不可用：${messageOf(cause)}`)
      } finally {
        setPrefsLoaded(true)
      }
    })()
  }, [loadDirectory])

  useEffect(() => {
    if (!prefsLoaded || !root) return
    void call<NotePreferences>('notePanel', 'rememberPreferences', { rootDir: root, lastNote: activePath || null, recentPaths })
      .catch(() => setError('笔记目录未能记住'))
  }, [activePath, prefsLoaded, recentPaths, root])

  useEffect(() => {
    setAttributes({ title: noteDoc.meta.title ?? activeNote?.title ?? '', tags: noteDoc.meta.tags.join(', '), category: noteDoc.meta.category ?? '', status: noteDoc.meta.status ?? '', date: noteDoc.meta.date ?? '' })
  }, [activePath, revision])

  useEffect(() => { void refreshHistory(activePath) }, [activePath])

  useEffect(() => {
    if (!activePath || !prefsLoaded || (!dirty && !draftIsNew)) return
    const timer = window.setTimeout(() => {
      const markdown = `${noteDoc.front}${editorApi.current?.getMarkdown() ?? noteDoc.body}`
      void call('notePanel', 'saveDraft', { path: activePath, markdown }).catch((cause) => setError(`草稿暂存失败：${messageOf(cause)}`))
    }, 350)
    return () => window.clearTimeout(timer)
  }, [activePath, content, prefsLoaded, noteDoc, dirty, draftIsNew])

  // Only the serialized document is observed here. Panel position, filters, tabs and other UI state never trigger writes.
  useEffect(() => {
    if (!activePath || !prefsLoaded || !dirty) {
      if (!dirty) { setAutoSaveStatus('saved'); autoSaveRetryCount.current = 0 }
      return
    }
    if (pendingExecution) return
    if (externalChange && !allowOverwrite) { setAutoSaveStatus('error'); return }
    setAutoSaveStatus('waiting')
    const timer = window.setTimeout(() => {
      const current = live.current
      if (!current?.dirty || current.pendingExecution) return
      void current.save().catch(() => {
        if (externalChange) return
        if (autoSaveRetryCount.current < 3) {
          autoSaveRetryCount.current += 1
          window.setTimeout(() => setAutoSaveRetry((value) => value + 1), 1500 * autoSaveRetryCount.current)
        }
      })
    }, 700)
    return () => window.clearTimeout(timer)
  }, [activePath, allowOverwrite, content, dirty, externalChange, pendingExecution, prefsLoaded, autoSaveRetry])

  // MCP 驱动入口：note-ops-panel 广播 note:action，这里代为开关面板并回报状态。
  useEffect(
    () =>
      window.bridge.onEvent((channel, payload) => {
        if (channel !== 'note:action') return
        const args = payload as {
          action?: string; title?: string; path?: string; markdown?: string; requestId?: string
          attributes?: Partial<Omit<NoteAttributes, 'tags'>> & { tags?: string[] | string }; enabled?: boolean; operation?: 'next' | 'replaceCurrent' | 'replaceAll'
          query?: string; replacement?: string; versionId?: string
        }
        const requestId = args.requestId
        if (!requestId) return
        void (async () => {
          const state = live.current
          if (!state) {
            await call('notePanel', 'complete', requestId, { error: '笔记面板尚未初始化' })
            return
          }
          try {
            let value: unknown = true
            if (args.action === 'setroot') {
              const path = String(args.path ?? '').trim()
              if (!path) throw new Error('setroot 需要提供笔记目录路径')
              await state.setRootDir(path)
              openFloatingPanel('notes')
              value = { root: path }
            } else if (args.action === 'open') {
              openFloatingPanel('notes')
            } else if (args.action === 'select') {
              const wanted = String(args.title ?? '').trim().toLocaleLowerCase()
              const byPath = args.path ? state.files.filter((file) => samePath(file.path, args.path!)) : []
              const byTitle = wanted ? state.files.filter((file) => file.title.toLocaleLowerCase() === wanted) : []
              const matches = args.path ? byPath : byTitle
              if (!matches.length) throw new Error(args.path ? `未找到笔记路径：${args.path}` : `未找到笔记：${args.title ?? '(未给出标题)'}`)
              if (matches.length > 1) throw new Error(`笔记标题不唯一，请通过 path 指定：${matches.map((file) => file.path).join('；')}`)
              const target = matches[0]
              openFloatingPanel('notes')
              await state.openNote(target)
              value = { activePath: target.path }
            } else if (args.action === 'new') {
              const title = String(args.title ?? '').trim()
              if (!title) throw new Error('new 需要提供笔记标题')
              openFloatingPanel('notes')
              value = { activePath: await state.createNote(title) }
            } else if (args.action === 'setbody') {
              const api = editorApi.current
              if (!api) throw new Error('笔记编辑器尚未挂载')
              if (!state.activePath) throw new Error('尚未打开笔记，无法写入正文')
              await api.replaceMarkdown(String(args.markdown ?? ''))
              value = { bodyLength: api.getMarkdown().trim().length }
            } else if (args.action === 'setattrs') {
              if (!state.activePath) throw new Error('尚未打开笔记，无法修改属性')
              if (!args.attributes) throw new Error('setattrs 需要提供 attributes')
              const current = attributesFromInput(args.attributes, attributesFromNoteDocument(readNoteDocument(state.content).meta))
              const next = patchFrontmatter(state.content, current)
              setAttributes(current); setContent(next)
              value = { attributes: current, dirty: true }
            } else if (args.action === 'sourceMode') {
              if (typeof args.enabled !== 'boolean') throw new Error('sourceMode 需要提供 enabled 布尔值')
              setSourceMode(args.enabled); value = { sourceMode: args.enabled }
            } else if (args.action === 'readingMode') {
              if (typeof args.enabled !== 'boolean') throw new Error('readingMode 需要提供 enabled 布尔值')
              setReadingMode(args.enabled); value = { readingMode: args.enabled }
            } else if (args.action === 'findReplace') {
              const api = editorApi.current
              const query = String(args.query ?? '')
              if (!api || !query) throw new Error('findReplace 需要挂载编辑器并提供 query')
              const replacement = String(args.replacement ?? '')
              const operation = args.operation ?? 'next'
              if (operation === 'next') value = { matched: api.findNext?.(query) ?? false }
              else if (operation === 'replaceCurrent') value = { replaced: api.replaceCurrent?.(query, replacement) ?? false }
              else value = { replaced: api.replaceAll?.(query, replacement) ?? 0 }
            } else if (args.action === 'archive') {
              if (state.dirty || state.pendingExecution) throw new Error('当前笔记有未保存改动，MCP 归档已中止')
              value = { archived: await archiveNote() }
            } else if (args.action === 'restoreTrash') {
              if (state.dirty || state.pendingExecution) throw new Error('当前笔记有未保存改动，MCP 恢复已中止')
              value = { restored: await restoreNote() }
            } else if (args.action === 'createVersion') {
              if (state.dirty || state.pendingExecution) throw new Error('请先保存笔记正文，再创建 Lore 历史快照')
              value = { created: await createHistory(args.title) }
            } else if (args.action === 'restoreVersion') {
              if (state.dirty || state.pendingExecution) throw new Error('请先保存或丢弃草稿，再恢复 Lore 版本')
              if (!state.activePath) throw new Error('尚未打开笔记')
              if (!args.versionId) throw new Error('restoreVersion 需要 versionId')
              const available = await call<LoreVersion[]>('versions', 'list', state.activePath)
              const selected = available.find((item) => item.versionId === args.versionId)
              if (!selected) throw new Error('该 Lore 版本不属于当前笔记或已不存在')
              value = { restored: await restoreHistory(selected) }
            } else if (args.action === 'inspect') {
              const api = editorApi.current
              value = {
                root: state.root,
                activePath: state.activePath,
                fileCount: state.files.length,
                dirty: state.dirty,
                pendingExecution: state.pendingExecution,
                autoSaveStatus,
                error: state.error,
                bodyLength: readNoteDocument(state.content).body.trim().length,
                // 面板 React 状态里的正文样本：编辑事件到状态之间有一帧延迟，验收要等它追上编辑器
                contentSample: readNoteDocument(state.content).body.slice(0, 200),
                editorMarkdown: api ? api.getMarkdown().slice(0, 2000) : null,
                editorMounted: Boolean(document.querySelector('[data-note-editor] .milkdown')),
                outline,
                statistics: api?.getStats?.() ?? wordStats,
                sourceMode, readingMode,
                attributes: noteDoc.meta,
                visiblePaths: visibleFiles.map((file) => file.path)
              }
            } else if (args.action === 'search') {
              const query = String(args.title ?? '').trim()
              if (!query) throw new Error('search 需要提供关键词')
              const needle = query.normalize('NFKC').toLocaleLowerCase()
              const matches: Array<{ path: string; title: string; excerpt: string }> = []
              for (let i = 0; i < files.length; i += 10) {
                const results = await Promise.all(files.slice(i, i + 10).map(async (file) => {
                  if (`${file.title} ${file.path}`.normalize('NFKC').toLocaleLowerCase().includes(needle)) return { path: file.path, title: file.title, excerpt: file.title }
                  try { const result = await readNoteText(file.path); if (result.truncated) return null; const index = result.content.normalize('NFKC').toLocaleLowerCase().indexOf(needle); return index < 0 ? null : { path: file.path, title: file.title, excerpt: result.content.slice(Math.max(0, index - 60), index + query.length + 100) } }
                  catch { return null }
                }))
                matches.push(...results.filter((item): item is NonNullable<typeof item> => item !== null))
              }
              value = matches
            } else if (args.action === 'outline') {
              value = { headings: outline, ...wordStats }
            } else if (args.action === 'versions') {
              const path = String(args.path ?? state.activePath).trim()
              if (!path) throw new Error('请提供 path 或先打开一篇笔记')
              value = await call<LoreVersion[]>('versions', 'list', path)
            } else if (args.action === 'reload') {
              await reloadActive(); value = { activePath: activePath }
            } else {
              throw new Error(`未知操作：${args.action ?? '(空)'}`)
            }
            await call('notePanel', 'complete', requestId, { value: value ?? true })
          } catch (cause) {
            await call('notePanel', 'complete', requestId, { error: messageOf(cause) })
          }
        })()
      }),
    [openFloatingPanel, outline, wordStats, visibleFiles, files, activePath, sourceMode, readingMode, autoSaveStatus]
  )

  useEffect(() => {
    let alive = true
    if (!activeNote) { setBacklinks([]); return }
    void findBacklinks(files, activePath, activeNote.title)
      .then((matches) => { if (alive) setBacklinks(matches) })
    return () => { alive = false }
  }, [activeNote?.title, activePath, files])

  const closePanel = (): void => { closeFloatingPanel() }
  if (!isOpen) return null
  const sectionDivider = 'mb-2 border-b border-[var(--ds-border)] pb-2'
  return (
    <ThemeFloatingPanel title="Markdown 笔记" persistenceKey="notes.workspace.v2" badge={dirty ? (autoSaveStatus === 'saving' ? '自动保存中' : autoSaveStatus === 'error' ? '自动保存失败' : '等待自动保存') : `${files.length} 篇`} icon={<FolderOpen className="h-3.5 w-3.5" />} isOpen={isOpen} onClose={closePanel} initialX={32} initialY={44} initialWidth={1510} initialHeight={900} minWidth={1040} minHeight={620}>
      <div className="flex h-full min-h-0 overflow-hidden rounded-lg bg-[var(--ds-workspace)] text-[var(--ds-text-secondary)]">
        <ThemeSidebarPanel title="笔记管理" width={290} side="left" collapsed={leftCollapsed} onToggleCollapse={() => setLeftCollapsed(true)}>
          <div className="flex h-full min-h-0 flex-1 flex-col gap-2 p-3">
          {creating ? (
            <div className="flex shrink-0 flex-col gap-1">
              <DesktopSelect aria-label="新建笔记目录" value={targetDirectory || root} onChange={setTargetDirectory} options={directories.map((directory) => ({ value: directory, label: relativePath(root, directory) || '根目录' }))} className="w-full" />
              <DesktopSelect aria-label="笔记模板" value={template} onChange={(value) => setTemplate(value as typeof template)} options={[{ value: 'blank', label: '空白模板' }, { value: 'meeting', label: '会议记录' }, { value: 'project', label: '项目记录' }, { value: 'daily', label: '每日笔记' }]} className="w-full" />
              <DesktopInput
                autoFocus
                value={draftTitle}
                placeholder="笔记标题"
                onChange={(event) => setDraftTitle(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter' && !event.nativeEvent.isComposing) void createNote(draftTitle).catch((cause) => setError(messageOf(cause)))
                  else if (event.key === 'Escape') { setCreating(false); setDraftTitle('') }
                }}
              />
              <div className="flex gap-1">
                <DesktopButton size="xs" variant="primary" onClick={() => void createNote(draftTitle).catch((cause) => setError(messageOf(cause)))}>创建</DesktopButton>
                <DesktopButton size="xs" variant="ghost" onClick={() => { setCreating(false); setDraftTitle('') }}>取消</DesktopButton>
              </div>
            </div>
          ) : (
            <div className="flex shrink-0 gap-1">
            <DesktopButton size="xs" variant="subtle" icon={<FolderOpen className="h-3 w-3" />} onClick={() => void chooseRoot()}>笔记目录</DesktopButton>
              <DesktopButton size="xs" variant="primary" icon={<FilePlus2 className="h-3 w-3" />} disabled={busy || pendingExecution} onClick={() => { setError(''); if (root) setCreating(true); else void chooseRoot() }}>新建笔记</DesktopButton>
              <DesktopButton size="xs" variant="ghost" icon={<RefreshCw className="h-3 w-3" />} disabled={busy || !root} onClick={() => void refreshNotes()}>刷新</DesktopButton>
            </div>
          )}
          <div className="flex shrink-0 gap-1">
            <DesktopInput value={filter} placeholder="筛选标题或路径" onChange={(event) => { setFilter(event.target.value); setFullTextPaths(null); setFullTextSearch(false) }} />
            <DesktopButton size="xs" variant={fullTextSearch ? 'primary' : 'ghost'} icon={<Search className="h-3 w-3" />} disabled={busy || !filter.trim()} title="在笔记正文中搜索" onClick={() => void runFullTextSearch()}>全文</DesktopButton>
          </div>
          <div className="flex shrink-0 gap-1">
            <DesktopSelect aria-label="笔记目录筛选" value={targetDirectory} onChange={setTargetDirectory} options={[{ value: '', label: '全部目录' }, ...directories.map((directory) => ({ value: directory, label: relativePath(root, directory) || '.' }))]} className="min-w-0 flex-1" />
            <DesktopSelect aria-label="笔记排序" value={sort} onChange={(value) => setSort(value as 'name' | 'modified')} options={[{ value: 'name', label: '名称' }, { value: 'modified', label: '修改时间' }]} />
          </div>
          <label className="flex shrink-0 items-center gap-1 text-xs"><input type="checkbox" checked={showTrash} onChange={(event) => setShowTrash(event.target.checked)} />显示回收区</label>
          <ThemeCollapsibleSection title="最近编辑" icon={<Clock3 className="h-3.5 w-3.5" />} badge={recentPaths.filter((path) => files.some((file) => samePath(file.path, path))).length} className={sectionDivider}>
            {recentPaths.filter((path) => files.some((file) => samePath(file.path, path))).slice(0, 5).map((path) => { const file = files.find((item) => samePath(item.path, path)); return file ? <DesktopButton key={path} type="button" size="sm" variant="ghost" active={samePath(path, activePath)} onClick={() => void openNote(file)} className="w-full justify-start"><span className="truncate"><FilePlus2 className="mr-1.5 inline h-3 w-3 opacity-70" />{file.title}</span></DesktopButton> : null })}
            {!recentPaths.length && <p className="px-2 py-1 text-xs text-[var(--ds-text-subtle)]">打开的笔记会显示在这里</p>}
          </ThemeCollapsibleSection>
          {(scanWarning || files.length >= MAX_FILES) && <p className="shrink-0 text-xs text-[var(--ds-status-warning)] dark:text-[var(--ds-status-warning)]">{scanWarning || `已达到扫描上限 ${MAX_FILES} 篇，部分笔记可能未显示`}</p>}
          <ThemeCollapsibleSection title="我的笔记" icon={<BookOpen className="h-3.5 w-3.5" />} badge={visibleFiles.length} className={`min-h-0 flex-1 overflow-hidden ${sectionDivider}`}>
            <div className="min-h-0 flex-1 space-y-0.5 overflow-auto">
              {visibleFiles.map((file) => <DesktopButton key={file.path} type="button" title={file.path} onClick={() => void openNote(file)} variant="ghost" active={activePath === file.path} className="block w-full justify-start truncate">
                <span className="block truncate">{file.title}</span><span className="block truncate text-xs opacity-60">{relativePath(root, file.path)}</span>
              </DesktopButton>)}
              {!visibleFiles.length && <p className="p-2 text-xs text-[var(--ds-text-subtle)]">{files.length ? '没有匹配的笔记' : root ? '此目录没有 Markdown 笔记' : '请选择笔记目录'}</p>}
            </div>
          </ThemeCollapsibleSection>
          <ThemeCollapsibleSection title="标签" icon={<Tags className="h-3.5 w-3.5" />} badge={tagStats.length || undefined} defaultOpen={false} className={sectionDivider}>
            <div className="max-h-32 overflow-auto">{!tagIndexLoaded ? <DesktopButton size="xs" variant="ghost" disabled={tagLoading || !files.length} onClick={() => void loadTagIndex()}>{tagLoading ? '正在读取标签…' : '扫描笔记 frontmatter 标签'}</DesktopButton> : <><div className="flex flex-wrap gap-1">{tagStats.map((item) => <DesktopTagPill key={item.tag} label={`# ${item.tag} · ${item.count}`} variant={tagFilter.split(',').map((tag) => tag.trim()).includes(item.tag) ? 'blue' : 'neutral'} onClick={() => toggleTagFilter(item.tag)} />)}</div>{!tagStats.length && <span className="text-xs text-[var(--ds-text-subtle)]">没有读取到标签</span>}{tagIndexCapped && <p className="text-xs text-[var(--ds-status-warning)]">扫描达到上限，聚合结果不完整</p>}<DesktopButton size="xs" variant="ghost" className="ml-1" onClick={() => { setTagFilter(''); setTagStats([]); setTagIndexLoaded(false) }}>清除</DesktopButton></>}</div>
          </ThemeCollapsibleSection>
          <div className="truncate text-xs text-[var(--ds-text-subtle)]" title={root}>{busy ? '正在读取…' : root || '未选择目录'}</div>
          </div>
        </ThemeSidebarPanel>
        <section className="flex min-w-0 flex-1 flex-col gap-2 bg-[var(--ds-workspace)] px-3 py-2">
          <div className="flex min-h-9 shrink-0 items-center gap-1.5 border-b border-[var(--ds-border)] pb-1">
            <DesktopIconButton size="xs" aria-label={leftCollapsed ? '展开笔记导航' : '收起笔记导航'} tooltip="切换笔记导航" onClick={() => setLeftCollapsed((value) => !value)} icon={leftCollapsed ? <PanelLeftOpen className="h-3.5 w-3.5" /> : <PanelLeftClose className="h-3.5 w-3.5" />} />
            <div className="min-w-0 flex-1 truncate"><div className="truncate text-xs text-[var(--ds-text-subtle)]">我的笔记{activeNote && `  /  ${relativePath(root, dirname(activeNote.path)) || '根目录'}`}</div><strong className="block truncate text-xs font-semibold text-[var(--ds-text-primary)] dark:text-white">{activeNote?.title ?? (activePath ? activePath.split(/[\\/]/).pop() : '未打开笔记')}</strong></div>
            <DesktopButton size="xs" variant="ghost" icon={<ImagePlus className="h-3 w-3" />} disabled={busy || !activePath} onClick={() => void insertResources()}>资源</DesktopButton>
            <DesktopButton size="xs" variant={sourceMode ? 'primary' : 'ghost'} disabled={!activePath} onClick={() => setSourceMode((value) => !value)}>{sourceMode ? '所见即所得' : '源码'}</DesktopButton>
            <DesktopButton size="xs" variant={readingMode ? 'primary' : 'ghost'} disabled={!activePath} onClick={() => setReadingMode((value) => !value)}>{readingMode ? '继续编辑' : '阅读'}</DesktopButton>
            <DesktopIconButton size="xs" aria-label={rightCollapsed ? '展开笔记检查器' : '收起笔记检查器'} tooltip="切换笔记检查器" onClick={() => setRightCollapsed((value) => !value)} icon={rightCollapsed ? <PanelRightOpen className="h-3.5 w-3.5" /> : <PanelRightClose className="h-3.5 w-3.5" />} />
            <details className="relative shrink-0"><summary className="flex cursor-pointer list-none items-center gap-1 rounded-md px-2 py-1.5 text-xs text-[var(--ds-text-secondary)] hover:bg-[var(--ds-surface-muted)] dark:text-[var(--ds-text-secondary)] dark:hover:bg-[var(--ds-surface-muted)]"><MoreHorizontal className="h-3.5 w-3.5" />更多</summary><div className="absolute right-0 z-30 mt-1 flex w-72 flex-col gap-2 rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-2 shadow-lg dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"><div className="flex items-center gap-2"><span className="w-16 shrink-0 text-xs text-[var(--ds-text-muted)]">Eagle 来源</span><DesktopInput value={eagleSourceInput} placeholder="eagle://item/<ID>" onChange={(event) => setEagleSourceInput(event.target.value)} /><DesktopButton size="xs" variant="primary" disabled={!eagleSourceInput.trim()} onClick={() => void linkEagleSource()}>登记</DesktopButton></div><div className="flex flex-col gap-1 border-t border-[var(--ds-border)] pt-2 dark:border-[var(--ds-border)]"><DesktopInput value={searchTerm} placeholder="查找文字" onChange={(event) => setSearchTerm(event.target.value)} /><DesktopInput value={replaceTerm} placeholder="替换为" onChange={(event) => setReplaceTerm(event.target.value)} /><div className="flex gap-1"><DesktopButton size="xs" variant="ghost" disabled={!searchTerm} onClick={() => setMessage(editorApi.current?.findNext?.(searchTerm) ? '已定位到匹配项' : '没有更多匹配项')}>下一个</DesktopButton><DesktopButton size="xs" variant="ghost" disabled={!searchTerm} onClick={() => setMessage(editorApi.current?.replaceCurrent?.(searchTerm, replaceTerm) ? '已替换当前匹配项' : '当前光标处没有匹配项')}>替换</DesktopButton><DesktopButton size="xs" variant="ghost" disabled={!searchTerm} onClick={() => { const count = editorApi.current?.replaceAll?.(searchTerm, replaceTerm) ?? 0; setMessage(`已替换 ${count} 处`) }}>全部</DesktopButton></div></div><div className="flex gap-1 border-t border-[var(--ds-border)] pt-2 dark:border-[var(--ds-border)]"><DesktopButton size="xs" variant="ghost" icon={<Download className="h-3 w-3" />} onClick={exportMarkdown}>导出 Markdown</DesktopButton><DesktopButton size="xs" variant="ghost" onClick={exportHtml}>导出 HTML</DesktopButton></div></div></details>
            {showTrash && activePath.toLowerCase().includes(`${root.replace(/[\\/]+$/, '').toLowerCase()}\\.trash\\`) ? <DesktopButton size="xs" variant="ghost" disabled={busy || dirty || pendingExecution} onClick={() => void restoreNote().catch((cause) => setError(messageOf(cause)))}>恢复</DesktopButton> : <DesktopButton size="xs" variant="ghost" icon={<Archive className="h-3 w-3" />} disabled={busy || !activePath || dirty || pendingExecution} onClick={() => void archiveNote().catch((cause) => setError(messageOf(cause)))}>归档</DesktopButton>}
            <span role="status" aria-live="polite" className={`shrink-0 px-1.5 py-1 text-xs ${autoSaveStatus === 'error' ? 'text-[var(--ds-status-danger)]' : 'text-[var(--ds-text-muted)]'}`}>{dirty ? (autoSaveStatus === 'saving' ? '保存中' : autoSaveStatus === 'error' ? '保存失败' : '待保存') : '已保存'}</span>
          </div>
          {recentPaths.filter((path) => files.some((file) => samePath(file.path, path))).length > 0 && <div role="tablist" aria-label="已打开笔记" className="flex max-h-7 shrink-0 gap-1 overflow-x-auto border-b border-[var(--ds-border)] dark:border-[var(--ds-border)]">
            {recentPaths.filter((path) => files.some((file) => samePath(file.path, path))).map((path) => {
              const file = files.find((item) => samePath(item.path, path))!
              const selected = samePath(path, activePath)
              return <DesktopButton key={path} type="button" role="tab" aria-selected={selected} size="xs" variant="pill" active={selected} title={path} onClick={() => void openNote(file)} className="max-w-40 shrink-0 truncate">{file.title}{dirty && selected ? ' •' : ''}</DesktopButton>
            })}
          </div>}
          {activeNote && <header className="shrink-0 px-5 pb-1 pt-3">
            <div className="mb-2 truncate text-xs text-[var(--ds-text-subtle)]">我的笔记 <span className="px-1 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">›</span> {relativePath(root, dirname(activeNote.path)) || '根目录'} <span className="px-1 text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-secondary)]">›</span> {activeNote.title}</div>
            <h1 data-ds-type="page-title" className="ds-type-page-title truncate">{activeNote.title}</h1>
            <div className="mt-2 flex flex-wrap items-center gap-1.5 text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">
              <span className="rounded-full bg-[var(--ds-surface-muted)] px-2 py-1">Markdown</span>
              <span className="rounded-full bg-[var(--ds-surface-muted)] px-2 py-1">{new Date(activeNote.modifiedAt).toLocaleString('zh-CN', { month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit' })}</span>
              {noteDoc.meta.tags.map((tag) => <DesktopTagPill key={tag} label={`# ${tag}`} variant="blue" onClick={() => { setTagFilter(tag); setTargetDirectory('') }} />)}
            </div>
          </header>}
          {externalChange && <div role="alert" className="flex flex-wrap items-center gap-2 rounded-[var(--ds-radius-control)] bg-[var(--ds-status-warning-soft)] px-2 py-1 text-xs text-[var(--ds-status-warning)]">磁盘内容已变化，当前编辑内容仍保留。<DesktopButton size="xs" variant="ghost" onClick={() => void reloadActive().catch((cause) => setError(messageOf(cause)))}>重新加载磁盘版本</DesktopButton><DesktopButton size="xs" variant="ghost" onClick={() => { setAllowOverwrite(true); setMessage('已选择覆盖，笔记将自动写入磁盘') }}>明确覆盖并自动保存</DesktopButton></div>}
          {wikiQuery !== null && <div className="flex items-center gap-1 rounded-[var(--ds-radius-control)] border border-[var(--ds-border)] p-1 text-xs"><span>双链候选</span>{wikiCandidates.map((candidate) => <DesktopButton key={`${candidate.target}:${candidate.label}`} size="xs" variant="ghost" className="max-w-44 truncate" title={candidate.label} onClick={() => { editorApi.current?.completeWikiLink?.(candidate); setWikiQuery(null) }}>{candidate.target}<span className="opacity-60"> · {candidate.label}</span></DesktopButton>)}{!wikiCandidates.length && <DesktopButton size="xs" variant="ghost" onClick={addWikiLink}>创建“{wikiQuery || '新笔记'}”链接</DesktopButton>}</div>}
          {wikiTarget && <div className="rounded border border-[var(--ds-status-warning)]/35 p-1 text-xs">目标“{wikiTarget}”有歧义；请在目录列表中按完整路径选择。</div>}
          <div className="min-h-0 flex-1 overflow-hidden rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] px-4 py-3 shadow-xs dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
            {activePath
              ? <NoteEditor key={`${activePath}#${revision}`} value={noteDoc.body} onChange={applyBody} readOnly={readingMode} resolveImageSrc={resolveImageSrc} uploadImage={uploadImage} onReady={handleEditorReady} onWikiLinkQuery={handleWikiQuery} onWikiLinkOpen={handleWikiOpen} sourceMode={sourceMode} />
              : <p className="p-3 text-xs text-[var(--ds-text-subtle)]">{busy ? '正在读取…' : '从左侧选择一篇笔记，或点击「新建」'}</p>}
          </div>
          <div className="flex min-h-4 items-center gap-2 text-xs">
            <span className={`min-w-0 flex-1 truncate ${error ? 'text-[var(--ds-status-danger)]' : 'text-[var(--ds-text-muted)]'}`} role={error ? 'alert' : undefined}>{error || message}</span>
            {backlinks.map((file) => <DesktopButton key={file.path} size="xs" variant="ghost" className="max-w-28 truncate" title={`反链：${file.path}`} onClick={() => void openNote(file)}>{file.title}</DesktopButton>)}
            <span className="shrink-0 text-[var(--ds-text-subtle)]">反链 {backlinks.length} · {wordStats.chars} 字符 · {wordStats.words} 词 · 约 {wordStats.minutes} 分钟</span>
          </div>
        </section>
        <ThemeSidebarPanel
          width={350}
          side="right"
          collapsed={rightCollapsed}
          onToggleCollapse={() => setRightCollapsed(true)}
          tabs={[
            { id: 'info', title: '文档信息', icon: <Info className="h-3.5 w-3.5" /> },
            { id: 'history', title: '版本历史', icon: <History className="h-3.5 w-3.5" /> }
          ]}
          activeTab={historyOpen ? 'history' : 'info'}
          onTabChange={(tabId) => { const showHistory = tabId === 'history'; setHistoryOpen(showHistory); if (showHistory) void refreshHistory() }}
        >
          <div className="flex h-full min-h-0 flex-col overflow-y-auto p-3">
            {historyOpen ? <>
              <div className="mb-2 flex gap-1"><DesktopInput value={historyTitle} placeholder="快照名称（可选）" onChange={(event) => setHistoryTitle(event.target.value)} /><DesktopButton size="xs" variant="subtle" disabled={busy || dirty} onClick={() => void createHistory().catch((cause) => setError(messageOf(cause)))}>创建</DesktopButton></div>
              <div className="space-y-1.5">{versions.map((version) => <div key={version.versionId} className="rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] p-2 text-xs"><div className="flex items-center gap-1.5"><span className={`h-2 w-2 rounded-full ${version.isCurrent ? 'bg-[var(--ds-accent)]' : 'border border-[var(--ds-border-strong)]'}`} /><strong className="text-[var(--ds-text-primary)]">v{version.revisionNumber} · {version.title}</strong>{version.isCurrent && <DesktopTagPill label="当前版本" variant="blue" />}</div><div className="mt-1 flex justify-between pl-3.5 text-xs text-[var(--ds-text-muted)]"><span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span><DesktopButton size="xs" variant="ghost" disabled={busy || dirty || version.isCurrent} onClick={() => void restoreHistory(version).catch((cause) => setError(messageOf(cause)))}>恢复</DesktopButton></div></div>)}{!versions.length && <p className="text-xs text-[var(--ds-text-subtle)]">此笔记还没有历史版本</p>}</div>
            </> : <>
              <ThemeCollapsibleSection title="目录" icon={<BookOpen className="h-3.5 w-3.5" />} badge={outline.length} className={sectionDivider}>
                {outline.length ? outline.map((heading, index) => <DesktopButton key={`${heading.offset}:${index}`} size="sm" variant="ghost" className="block w-full justify-start truncate" style={{ paddingLeft: `${8 + (heading.level - 1) * 10}px` }} onClick={() => jumpToHeading(heading)}>{heading.title}</DesktopButton>) : <p className="px-2 py-1 text-xs text-[var(--ds-text-subtle)]">暂无标题</p>}
              </ThemeCollapsibleSection>
              <ThemeCollapsibleSection title="反向链接" icon={<Link2 className="h-3.5 w-3.5" />} badge={backlinks.length} className={sectionDivider}>
                {backlinks.length ? backlinks.map((file) => <DesktopButton key={file.path} type="button" size="sm" variant="ghost" className="block w-full justify-start truncate" title={file.path} onClick={() => void openNote(file)}><Link2 className="mr-1.5 inline h-3 w-3" />{file.title}</DesktopButton>) : <p className="px-2 py-1 text-xs text-[var(--ds-text-subtle)]">暂无反向链接</p>}
              </ThemeCollapsibleSection>
              <ThemeCollapsibleSection title="标签" icon={<Tags className="h-3.5 w-3.5" />} badge={noteDoc.meta.tags.length} className={sectionDivider}>
                <div className="flex flex-wrap gap-1">{noteDoc.meta.tags.length ? noteDoc.meta.tags.map((tag) => <DesktopTagPill key={tag} label={`# ${tag}`} variant="blue" onClick={() => { setTagFilter(tag); setTargetDirectory('') }} />) : <p className="text-xs text-[var(--ds-text-subtle)]">暂无标签</p>}</div>
              </ThemeCollapsibleSection>
              <ThemeCollapsibleSection title="版本历史" icon={<History className="h-3.5 w-3.5" />} badge={versions.length} className={sectionDivider} action={<DesktopButton size="xs" variant="ghost" onClick={() => setHistoryOpen(true)}>全部</DesktopButton>}>
                <div className="relative ml-2 space-y-0 border-l border-[var(--ds-border)] pl-3 dark:border-[var(--ds-border)]">
                  {versions.slice(0, 4).map((version) => <div key={version.versionId} className="relative border-b border-[var(--ds-border)] py-2 last:border-0"><span className={`absolute -left-[17px] top-3 h-2 w-2 rounded-full ${version.isCurrent ? 'bg-[var(--ds-accent)] ring-2 ring-[var(--ds-accent-soft)]' : 'border border-[var(--ds-border-strong)] bg-[var(--ds-surface)]'}`} /><div className="flex items-center gap-1.5"><strong className="min-w-0 truncate text-xs text-[var(--ds-text-secondary)]">v{version.revisionNumber} · {version.title}</strong>{version.isCurrent && <DesktopTagPill label="当前版本" variant="blue" />}</div><div className="mt-1 flex items-center justify-between gap-2 text-xs text-[var(--ds-text-muted)]"><span>{new Date(version.createdAt).toLocaleString('zh-CN')}</span><DesktopButton type="button" size="xs" variant="ghost" disabled={busy || dirty || version.isCurrent} onClick={() => void restoreHistory(version).catch((cause) => setError(messageOf(cause)))}>恢复</DesktopButton></div></div>)}
                  {!versions.length && <p className="py-2 text-xs text-[var(--ds-text-subtle)]">暂无历史版本</p>}
                </div>
              </ThemeCollapsibleSection>
              <ThemeCollapsibleSection title="笔记属性" icon={<Info className="h-3.5 w-3.5" />} defaultOpen={false}>
                <div className="space-y-2"><label className="block text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">标题<DesktopInput value={attributes.title} placeholder="标题" onChange={(event) => setAttributes((value) => ({ ...value, title: event.target.value }))} /></label><label className="block text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">标签<DesktopInput value={attributes.tags} placeholder="以逗号分隔" onChange={(event) => setAttributes((value) => ({ ...value, tags: event.target.value }))} /></label><label className="block text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">分类<DesktopInput value={attributes.category} placeholder="分类" onChange={(event) => setAttributes((value) => ({ ...value, category: event.target.value }))} /></label><label className="block text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">状态<DesktopInput value={attributes.status} placeholder="状态" onChange={(event) => setAttributes((value) => ({ ...value, status: event.target.value }))} /></label><label className="block text-xs text-[var(--ds-text-muted)] dark:text-[var(--ds-text-subtle)]">日期<DesktopInput value={attributes.date} placeholder="YYYY-MM-DD" onChange={(event) => setAttributes((value) => ({ ...value, date: event.target.value }))} /></label><DesktopButton size="xs" variant="subtle" disabled={!activePath} onClick={applyAttributes}>应用属性</DesktopButton></div>
              </ThemeCollapsibleSection>
              <div className="mt-2 border-t border-[var(--ds-border)] pt-3 text-xs leading-5 text-[var(--ds-text-muted)] dark:border-[var(--ds-border)] dark:text-[var(--ds-text-subtle)]">{wordStats.chars} 字符 · {wordStats.words} 词<br />约 {wordStats.minutes} 分钟阅读</div>
            </>}
          </div>
        </ThemeSidebarPanel>
      </div>
    </ThemeFloatingPanel>
  )
}

function PlainNoteEditor({ value, onChange, readOnly, onReady }: NoteEditorProps): ReactElement {
  const ref = useRef<HTMLTextAreaElement>(null)
  useEffect(() => {
    onReady?.({
      getMarkdown: () => ref.current?.value ?? '',
      replaceMarkdown: async (markdown) => {
        if (ref.current) ref.current.value = markdown
        onChange(markdown)
      }
    })
    return () => onReady?.(null)
  }, [onChange, onReady])
  return <textarea ref={ref} defaultValue={value} onChange={(event) => onChange(event.target.value)} readOnly={readOnly} className="h-full min-h-0 w-full resize-none bg-transparent p-3 font-mono text-xs leading-relaxed text-[var(--ds-text-primary)] outline-none dark:text-[var(--ds-text-primary)]" data-note-editor />
}

function readNoteDocument(source: string): { front: string; meta: { tags: string[]; title?: string; category?: string; status?: string; date?: string }; body: string } {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (!match) return { front: '', meta: { tags: [] }, body: source }
  if (match[1].length > MAX_FRONTMATTER_CHARS) return { front: '', meta: { tags: [] }, body: source }
  let meta: z.infer<typeof noteFrontmatterSchema> = {}
  try {
    const parsed: unknown = parseYaml(match[1], { maxAliasCount: 100 })
    const validated = noteFrontmatterSchema.safeParse(parsed)
    if (validated.success) meta = validated.data
  } catch { /* The source remains editable when frontmatter YAML is incomplete. */ }
  const tags = Array.isArray(meta.tags) ? meta.tags : typeof meta.tags === 'string' ? [meta.tags] : []
  return { front: match[0], meta: {
    tags,
    title: typeof meta.title === 'string' ? meta.title : undefined,
    category: typeof meta.category === 'string' ? meta.category : undefined,
    status: typeof meta.status === 'string' ? meta.status : undefined,
    date: typeof meta.date === 'string' ? meta.date : undefined
  }, body: source.slice(match[0].length) }
}

function patchFrontmatter(source: string, attributes: NoteAttributes): string {
  const match = source.match(/^---\s*\r?\n([\s\S]*?)\r?\n---\s*(?:\r?\n|$)/)
  if (match && match[1].length > MAX_FRONTMATTER_CHARS) throw new Error('Frontmatter 超过 256 KiB，拒绝自动重写')
  const body = match ? source.slice(match[0].length) : source
  const document = parseDocument(match?.[1] ?? '{}')
  if (document.errors.length) throw new Error(`YAML frontmatter 无效：${document.errors[0].message}`)
  const root = document.contents
  if (root && !isMap(root)) throw new Error('YAML frontmatter 根节点必须是对象')
  const tags = attributes.tags.split(',').map((tag) => tag.trim()).filter(Boolean)
  const fields: Array<[string, string | string[]]> = [
    ['title', attributes.title.trim()], ['tags', tags], ['category', attributes.category.trim()],
    ['status', attributes.status.trim()], ['date', attributes.date.trim()]
  ]
  for (const [key, value] of fields) {
    if (typeof value === 'string' && !value) document.delete(key)
    else document.set(key, value)
  }
  const yaml = document.toString().trimEnd()
  return `---\n${yaml}\n---\n${body.startsWith('\n') ? '' : '\n'}${body}`
}
function attributesFromNoteDocument(meta: { title?: string; tags: string[]; category?: string; status?: string; date?: string }): NoteAttributes {
  return { title: meta.title ?? '', tags: meta.tags.join(', '), category: meta.category ?? '', status: meta.status ?? '', date: meta.date ?? '' }
}
function attributesFromInput(input: Partial<Omit<NoteAttributes, 'tags'>> & { tags?: string[] | string }, defaults: NoteAttributes): NoteAttributes {
  const tags = input.tags === undefined ? defaults.tags : Array.isArray(input.tags) ? input.tags.join(', ') : input.tags
  return {
    title: input.title ?? defaults.title,
    tags,
    category: input.category ?? defaults.category,
    status: input.status ?? defaults.status,
    date: input.date ?? defaults.date
  }
}

async function findBacklinks(files: NoteFile[], activePath: string, targetTitle: string): Promise<NoteFile[]> {
  const target = targetTitle.normalize('NFKC').toLocaleLowerCase()
  const candidates = files.filter((file) => file.path !== activePath && file.size <= 128 * 1024).slice(0, 500)
  const matches: NoteFile[] = []
  for (let index = 0; index < candidates.length; index += 12) {
    const batch = candidates.slice(index, index + 12)
    const results = await Promise.all(batch.map(async (file) => {
      try {
        const result = await readNoteText(file.path)
        const found = !result.truncated && extractWikiTargets(result.content).some((title) => title.normalize('NFKC').toLocaleLowerCase() === target)
        return found ? file : null
      } catch { return null }
    }))
    matches.push(...results.filter((file): file is NoteFile => file !== null))
  }
  return matches
}

function slug(value: string): string { return value.normalize('NFKD').toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, '-').replace(/^-|-$/g, '') || 'note' }
function joinPath(base: string, name: string): string { const sep = base.includes('\\') ? '\\' : '/'; return `${base.replace(/[\\/]+$/, '')}${sep}${name}` }
function dirname(path: string): string { const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\')); return index <= 0 ? path.slice(0, 1) : path.slice(0, index) }
function resolveRelative(base: string, relative: string): string {
  const sep = base.includes('\\') ? '\\' : '/'
  const pieces = `${base}${sep}${relative}`.split(/[\\/]+/)
  const resolved: string[] = []
  for (const piece of pieces) {
    if (!piece || piece === '.') continue
    if (piece === '..') resolved.pop()
    else resolved.push(piece)
  }
  const prefix = base.startsWith('\\\\') ? '\\\\' : base.startsWith('/') ? '/' : ''
  return `${prefix}${resolved.join(sep)}`
}
function isInside(root: string, path: string): boolean { const normalizedRoot = root.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase(); const normalizedPath = path.replaceAll('/', '\\').toLowerCase(); return normalizedPath.startsWith(`${normalizedRoot}\\`) }
function samePath(a: string, b: string): boolean { return a.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() === b.replaceAll('/', '\\').replace(/\\+$/, '').toLowerCase() }
function extractWikiTargets(source: string): string[] {
  const withoutFencedCode = source.replace(/^\s*(```|~~~)[\s\S]*?^\s*\1[^\S\r\n]*$/gm, '')
  const withoutInlineCode = withoutFencedCode.replace(/(`+)[^`]*?\1/g, '')
  const withoutEscapedBrackets = withoutInlineCode.replace(/\\\[/g, '[').replace(/\\\]/g, ']')
  return [...withoutEscapedBrackets.matchAll(/\[\[([^\]]+)\]\]/g)].map((match) => match[1].split('|')[0].split('#')[0].trim())
}
function relativePath(root: string, path: string): string {
  const normalizedRoot = root.replaceAll('/', '\\').replace(/\\+$/, '')
  const normalizedPath = path.replaceAll('/', '\\')
  if (samePath(normalizedRoot, normalizedPath)) return ''
  return normalizedPath.slice(normalizedRoot.length).replace(/^\\+/, '')
}
function escapeMarkdownLabel(value: string): string { return value.replace(/[\\\[\]]/g, '\\$&').replace(/\r?\n/g, ' ') }
function escapeHtml(value: string): string { return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;') }
function escapeAttribute(value: string): string { return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;') }
function downloadBlob(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob)
  const anchor = document.createElement('a'); anchor.href = url; anchor.download = filename; anchor.click()
  window.setTimeout(() => URL.revokeObjectURL(url), 0)
}
async function runVersionJob(start: () => Promise<unknown>): Promise<void> {
  const early: JobDone[] = []
  let jobId = ''
  let timer = 0
  let unsubscribe = (): void => {}
  const completed = new Promise<JobDone>((resolve, reject) => {
    unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'job:done') return
      const decoded = jobDoneSchema.safeParse(payload)
      if (!decoded.success) return
      const job = decoded.data
      if (jobId && job.id === jobId) { window.clearTimeout(timer); unsubscribe(); resolve(job) }
      else if (!jobId) early.push(job)
    })
    timer = window.setTimeout(() => { unsubscribe(); reject(new Error('等待 Lore 任务完成超时；任务可能仍在执行')) }, 120_000)
  })
  try {
    const started = versionJobStartSchema.parse(await start())
    jobId = started.jobId
    const alreadyDone = early.find((job) => job.id === jobId)
    if (alreadyDone) {
      window.clearTimeout(timer); unsubscribe()
      if (alreadyDone.state !== 'done') throw new Error(alreadyDone.error || `Lore 任务${alreadyDone.state}`)
      return
    }
    const result = await completed
    if (result.state !== 'done') throw new Error(result.error || `Lore 任务${result.state}`)
  } catch (cause) { window.clearTimeout(timer); unsubscribe(); throw cause }
}
function messageOf(error: unknown, fallback = '笔记操作失败'): string { return errorText(error, fallback) }

async function executeApprovedPlan(
  op: 'mkdir' | 'move',
  sources: string[],
  target: string,
  conflictPolicy: 'skip' | 'rename'
): Promise<void> {
  const plan = await call<{ planId: string }>('fileOps', 'plan', { op, sources, target, conflictPolicy })
  await call('fileOps', 'approve', plan.planId)
  const waiting = waitForPlanResult(plan.planId)
  try {
    await call('fileOps', 'execute', plan.planId)
    const completion = await waiting.promise
    const result = completion.results?.[0]
    if (result?.status !== 'completed' && !(op === 'mkdir' && result?.status === 'skipped')) {
      throw new Error(result?.message ?? completion.error ?? '文件操作未完成')
    }
  } catch (cause) {
    waiting.cancel()
    throw cause
  }
}

function waitForPlanResult(planId: string): { promise: Promise<{ results?: Array<{ status: string; message?: string }>; error?: string }>; cancel: () => void } {
  let unsubscribe = (): void => {}
  let timer = 0
  let settled = false
  let resolveResult: (result: { results?: Array<{ status: string; message?: string }>; error?: string }) => void = () => {}
  const promise = new Promise<{ results?: Array<{ status: string; message?: string }>; error?: string }>((resolve, reject) => {
    resolveResult = resolve
    unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel !== 'fileOps:done') return
      const event = payload as { planId?: string; results?: Array<{ status: string; message?: string }>; error?: string }
      if (event.planId !== planId) return
      settled = true
      window.clearTimeout(timer)
      unsubscribe()
      resolve(event)
    })
    timer = window.setTimeout(() => {
      settled = true
      unsubscribe()
      reject(new Error('等待文件操作完成超时'))
    }, 60_000)
  })
  return {
    promise,
    cancel: () => {
      if (settled) return
      settled = true
      window.clearTimeout(timer)
      unsubscribe()
      resolveResult({ error: '文件操作等待已取消' })
    }
  }
}
