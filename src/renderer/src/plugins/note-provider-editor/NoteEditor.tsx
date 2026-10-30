import { useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { Crepe, CrepeFeature } from '@milkdown/crepe'
import { replaceAll } from '@milkdown/kit/utils'
import { editorViewCtx } from '@milkdown/kit/core'
import { TextSelection } from '@milkdown/kit/prose/state'
// frame.css 只提供 --crepe-* 主题变量；每个功能的组件样式要按特性逐个引入。
import '@milkdown/crepe/theme/frame.css'
import '@milkdown/crepe/theme/common/style.css'
import '@milkdown/crepe/theme/common/reset.css'
import '@milkdown/crepe/theme/common/prosemirror.css'
import '@milkdown/crepe/theme/common/cursor.css'
import '@milkdown/crepe/theme/common/placeholder.css'
import '@milkdown/crepe/theme/common/list-item.css'
import '@milkdown/crepe/theme/common/code-mirror.css'
import '@milkdown/crepe/theme/common/table.css'
import '@milkdown/crepe/theme/common/image-block.css'
import '@milkdown/crepe/theme/common/link-tooltip.css'
import '@milkdown/crepe/theme/common/latex.css'
import '@milkdown/crepe/theme/common/block-edit.css'
import '@milkdown/crepe/theme/common/toolbar.css'
import './crepe-theme.css'

/** 编辑器就绪后交还给调用方的命令句柄，用于读取/替换当前文档（程序化写入与 MCP 验收走这条路）。 */
export interface NoteEditorApi {
  getMarkdown: () => string
  replaceMarkdown: (markdown: string) => Promise<void>
  completeWikiLink: (candidate: WikiLinkCandidate) => void
  getOutline: () => NoteHeading[]
  getStats: () => NoteDocumentStats
  findNext: (query: string) => boolean
  replaceCurrent: (query: string, replacement: string) => boolean
  replaceAll: (query: string, replacement: string) => number
}

export interface WikiLinkCandidate { target: string; label?: string }
export interface NoteHeading { level: number; text: string; line: number }
export interface NoteDocumentStats { characters: number; words: number; readingMinutes: number }

export interface NoteEditorProps {
  /** Markdown 正文（不含 frontmatter）。只在挂载时读取，切换笔记请由调用方更换 key 重挂载。 */
  value: string
  onChange: (markdown: string) => void
  readOnly?: boolean
  /** 把笔记里的相对图片引用解析成可显示的地址；返回 null 表示保持原样。 */
  resolveImageSrc?: (src: string) => Promise<string | null>
  /** 粘贴或拖入图片时决定写回的引用，默认写回 assets/ 下的相对路径。 */
  uploadImage?: (file: File) => Promise<string>
  onWikiLinkQuery?: (query: string | null) => void
  onWikiLinkOpen?: (target: string, label?: string) => void
  /** Switches between Crepe and editable raw Markdown while keeping the same body. */
  sourceMode?: boolean
  /** 编辑器创建完成时收到句柄，卸载时收到 null。 */
  onReady?: (api: NoteEditorApi | null) => void
}

export function NoteEditor({ value, onChange, readOnly = false, resolveImageSrc, uploadImage, onWikiLinkQuery, onWikiLinkOpen, sourceMode = false, onReady }: NoteEditorProps): ReactElement {
  const hostRef = useRef<HTMLDivElement>(null)
  const sourceRef = useRef<HTMLTextAreaElement>(null)
  const crepeRef = useRef<Crepe | null>(null)
  // The parent owns persistence snapshots, while this mounted editor owns its live document,
  // selection and undo history. Only a new path#revision mount may initialize the document.
  const initialDocument = useRef({ value, resolveImageSrc })
  const sourceDraftRef = useRef(value)
  const sourceModeRef = useRef(sourceMode)
  const lastSourceMode = useRef(sourceMode)
  const [sourceDraft, setSourceDraft] = useState(value)
  const [preparedValue, setPreparedValue] = useState<string | null>(null)
  const previewToSource = useRef(new Map<string, string>())
  sourceModeRef.current = sourceMode
  const handlers = useRef({ onChange, resolveImageSrc, uploadImage, onWikiLinkQuery, onWikiLinkOpen })
  handlers.current = { onChange, resolveImageSrc, uploadImage, onWikiLinkQuery, onWikiLinkOpen }
  const onReadyRef = useRef(onReady)
  onReadyRef.current = onReady

  useEffect(() => {
    let disposed = false
    previewToSource.current.clear()
    void prepareDisplayMarkdown(initialDocument.current.value, initialDocument.current.resolveImageSrc, previewToSource.current).then((markdown) => {
      if (!disposed) setPreparedValue(markdown)
    })
    return () => { disposed = true }
  }, [])

  useEffect(() => {
    const host = hostRef.current
    if (!host || preparedValue === null) return
    const crepe = new Crepe({
      root: host,
      defaultValue: preparedValue,
      features: { [CrepeFeature.AI]: false, [CrepeFeature.TopBar]: false },
      featureConfigs: {
        [CrepeFeature.Placeholder]: { text: '开始写作，输入 / 查看可用操作…' },
        [CrepeFeature.Toolbar]: { boldLabel: '加粗', codeLabel: '行内代码', italicLabel: '斜体', linkLabel: '链接', strikethroughLabel: '删除线', latexLabel: '公式', aiLabel: 'AI' },
        [CrepeFeature.LinkTooltip]: { editButton: '编辑链接', removeButton: '移除链接', confirmButton: '确认', inputPlaceholder: '输入链接地址' },
        [CrepeFeature.CodeMirror]: { previewToggleText: (previewOnlyMode) => previewOnlyMode ? '编辑代码' : '预览代码' },
        [CrepeFeature.BlockEdit]: {
          textGroup: { label: '文本', text: { label: '正文' }, h1: { label: '标题 1' }, h2: { label: '标题 2' }, h3: { label: '标题 3' }, h4: { label: '标题 4' }, h5: { label: '标题 5' }, h6: { label: '标题 6' }, quote: { label: '引用' }, divider: { label: '分隔线' } },
          listGroup: { label: '列表', bulletList: { label: '无序列表' }, orderedList: { label: '有序列表' }, taskList: { label: '任务列表' } },
          advancedGroup: { label: '更多', image: { label: '图片' }, codeBlock: { label: '代码块' }, table: { label: '表格' }, math: { label: '公式' } }
        },
        [CrepeFeature.ImageBlock]: {
          inlineConfirmButton: '确认', inlineUploadButton: '选择图片', inlineUploadPlaceholderText: '输入图片地址…',
          blockConfirmButton: '确认', blockUploadButton: '选择图片', blockCaptionPlaceholderText: '添加图片说明…', blockUploadPlaceholderText: '拖入图片或点击选择',
          maxWidth: 960, maxHeight: 720,
          onUpload: async (file) => (await handlers.current.uploadImage?.(file)) ?? `assets/${file.name}`,
          proxyDomURL: async (src) => (await handlers.current.resolveImageSrc?.(src)) ?? src
        }
      }
    })
    crepe.on((listener) => {
      listener.markdownUpdated((_ctx, markdown) => { handlers.current.onChange(restoreSourceMarkdown(markdown, previewToSource.current)) })
    })
    crepeRef.current = crepe
    // create() 是异步的，卸载必须等它就绪后再 destroy，否则 StrictMode 的双挂载会留下孤儿实例。
    const created = crepe.create()
    let disposed = false
    void created.then(
      () => { if (!disposed) onReadyRef.current?.({
        getMarkdown: () => sourceModeRef.current ? sourceDraftRef.current : restoreSourceMarkdown(crepe.getMarkdown(), previewToSource.current),
        // 程序化替换要自己回报一次：listener.markdownUpdated 依赖 ProseMirror 事务加 200ms 防抖，
        // 整篇替换这条路径上不可靠，而调用方（面板）必须立刻拿到新的序列化结果才能进入待保存状态。
        replaceMarkdown: async (markdown) => {
          if (sourceModeRef.current) {
            sourceDraftRef.current = markdown
            setSourceDraft(markdown)
            handlers.current.onChange(markdown)
          } else {
            const displayMarkdown = await prepareDisplayMarkdown(markdown, handlers.current.resolveImageSrc, previewToSource.current)
            if (!crepeRef.current) return
            crepe.editor.action(replaceAll(displayMarkdown))
            handlers.current.onChange(restoreSourceMarkdown(crepe.getMarkdown(), previewToSource.current))
          }
        },
        completeWikiLink: (candidate) => {
          const target = candidate.target.trim()
          if (!target) return
          const label = candidate.label?.trim()
          const token = `[[${target}${label && label !== target ? `|${label}` : ''}]]`
          if (sourceModeRef.current && sourceRef.current) {
            const field = sourceRef.current
            const before = sourceDraftRef.current.slice(0, field.selectionStart)
            const match = /\[\[[^\]]*$/.exec(before)
            const start = match ? field.selectionStart - match[0].length : field.selectionStart
            const next = `${sourceDraftRef.current.slice(0, start)}${token}${sourceDraftRef.current.slice(field.selectionEnd)}`
            sourceDraftRef.current = next
            setSourceDraft(next)
            handlers.current.onChange(next)
            requestAnimationFrame(() => field.setSelectionRange(start + token.length, start + token.length))
            handlers.current.onWikiLinkQuery?.(null)
            return
          }
          crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { state } = view
            const { $from, empty } = state.selection
            if (!empty) return
            const before = $from.parent.textContent.slice(0, $from.parentOffset)
            const match = /\[\[[^\]]*$/.exec(before)
            const start = match ? $from.pos - match[0].length : $from.pos
            view.dispatch(state.tr.insertText(token, start, $from.pos))
          })
          handlers.current.onWikiLinkQuery?.(null)
        },
        getOutline: () => getOutline(sourceModeRef.current ? sourceDraftRef.current : crepe.getMarkdown()),
        getStats: () => getStats(sourceModeRef.current ? sourceDraftRef.current : crepe.getMarkdown()),
        findNext: (query) => {
          if (!query) return false
          if (sourceModeRef.current && sourceRef.current) {
            const field = sourceRef.current
            const start = field.selectionEnd > field.selectionStart ? field.selectionEnd : field.selectionEnd + 1
            const found = sourceDraftRef.current.indexOf(query, start) >= 0
              ? sourceDraftRef.current.indexOf(query, start)
              : sourceDraftRef.current.indexOf(query)
            if (found < 0) return false
            field.focus()
            field.setSelectionRange(found, found + query.length)
            return true
          }
          return crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { state } = view
            const matches: Array<{ from: number; to: number }> = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              let offset = 0
              while (true) {
                const index = node.text.indexOf(query, offset)
                if (index < 0) break
                matches.push({ from: pos + index, to: pos + index + query.length })
                offset = index + Math.max(1, query.length)
              }
            })
            if (!matches.length) return false
            const next = matches.find((item) => item.from >= state.selection.to) ?? matches[0]
            view.dispatch(state.tr.setSelection(TextSelection.create(state.doc, next.from, next.to)).scrollIntoView())
            return true
          })
        },
        replaceCurrent: (query, replacement) => {
          if (!query) return false
          if (sourceModeRef.current && sourceRef.current) {
            const field = sourceRef.current
            if (sourceDraftRef.current.slice(field.selectionStart, field.selectionEnd) !== query) return false
            const next = `${sourceDraftRef.current.slice(0, field.selectionStart)}${replacement}${sourceDraftRef.current.slice(field.selectionEnd)}`
            const caret = field.selectionStart + replacement.length
            sourceDraftRef.current = next
            setSourceDraft(next)
            handlers.current.onChange(next)
            requestAnimationFrame(() => field.setSelectionRange(caret, caret))
            return true
          }
          return crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { state } = view
            if (state.selection.empty || state.doc.textBetween(state.selection.from, state.selection.to) !== query) return false
            view.dispatch(state.tr.insertText(replacement, state.selection.from, state.selection.to))
            return true
          })
        },
        replaceAll: (query, replacement) => {
          if (!query) return 0
          if (sourceModeRef.current) {
            const current = sourceDraftRef.current
            const count = current.split(query).length - 1
            if (!count) return 0
            const next = current.split(query).join(replacement)
            sourceDraftRef.current = next
            setSourceDraft(next)
            handlers.current.onChange(next)
            return count
          }
          return crepe.editor.action((ctx) => {
            const view = ctx.get(editorViewCtx)
            const { state } = view
            const matches: Array<{ from: number; to: number }> = []
            state.doc.descendants((node, pos) => {
              if (!node.isText || !node.text) return
              let offset = 0
              while (true) {
                const index = node.text.indexOf(query, offset)
                if (index < 0) break
                matches.push({ from: pos + index, to: pos + index + query.length })
                offset = index + query.length
              }
            })
            if (!matches.length) return 0
            let transaction = state.tr
            for (const match of matches.reverse()) transaction = transaction.insertText(replacement, match.from, match.to)
            view.dispatch(transaction)
            return matches.length
          })
        }
      }) },
      () => undefined
    )
    const queryAtSelection = (): string | null => {
      const selection = window.getSelection()
      const node = selection?.anchorNode
      if (!selection || !node || node.nodeType !== Node.TEXT_NODE) return null
      const before = node.textContent?.slice(0, selection.anchorOffset) ?? ''
      const match = /\[\[([^\]]*)$/.exec(before)
      return match ? match[1] : null
    }
    const onKeyUp = (): void => handlers.current.onWikiLinkQuery?.(queryAtSelection())
    const onClick = (): void => {
      const selection = window.getSelection()
      const node = selection?.anchorNode
      if (!selection || !node || node.nodeType !== Node.TEXT_NODE) return
      const text = node.textContent ?? ''
      const offset = selection.anchorOffset
      for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
        const start = match.index ?? 0
        if (offset < start || offset > start + match[0].length) continue
        const [target, ...labelParts] = match[1].split('|')
        handlers.current.onWikiLinkOpen?.(target.trim(), labelParts.join('|').trim() || undefined)
        return
      }
    }
    host.addEventListener('keyup', onKeyUp, true)
    host.addEventListener('click', onClick, true)
    return () => {
      disposed = true
      host.removeEventListener('keyup', onKeyUp, true)
      host.removeEventListener('click', onClick, true)
      crepeRef.current = null
      onReadyRef.current?.(null)
      void created.then(() => crepe.destroy(), () => undefined)
    }
  }, [preparedValue])

  useEffect(() => {
    if (sourceMode === lastSourceMode.current) return
    const crepe = crepeRef.current
    if (sourceMode) {
      const markdown = crepe ? restoreSourceMarkdown(crepe.getMarkdown(), previewToSource.current) : sourceDraftRef.current
      sourceDraftRef.current = markdown
      setSourceDraft(markdown)
    } else {
      const markdown = sourceDraftRef.current
      if (crepe) void prepareDisplayMarkdown(markdown, handlers.current.resolveImageSrc, previewToSource.current).then((displayMarkdown) => {
        if (crepeRef.current === crepe) crepe.editor.action(replaceAll(displayMarkdown))
      })
      handlers.current.onChange(markdown)
    }
    lastSourceMode.current = sourceMode
  }, [sourceMode])

  useEffect(() => {
    crepeRef.current?.setReadonly(readOnly)
  }, [readOnly])

  const updateSource = (markdown: string): void => {
    sourceDraftRef.current = markdown
    setSourceDraft(markdown)
    handlers.current.onChange(markdown)
  }

  return (
    <div className="flex h-full min-h-0 flex-col" data-note-editor>
      <div ref={hostRef} className={`min-h-0 flex-1 overflow-auto ${sourceMode ? 'hidden' : ''}`} data-note-editor-wysiwyg />
      {sourceMode && <textarea
        ref={sourceRef}
        className="h-full min-h-0 flex-1 resize-none overflow-auto bg-transparent p-4 font-mono text-sm leading-6 text-foreground outline-none"
        aria-label="Markdown 源码"
        spellCheck={false}
        readOnly={readOnly}
        value={sourceDraft}
        onChange={(event) => updateSource(event.currentTarget.value)}
        onKeyUp={() => {
          const before = sourceDraftRef.current.slice(0, sourceRef.current?.selectionStart ?? 0)
          const match = /\[\[([^\]]*)$/.exec(before)
          handlers.current.onWikiLinkQuery?.(match ? match[1] : null)
        }}
        onClick={() => {
          const field = sourceRef.current
          if (!field) return
          const offset = field.selectionStart
          const text = sourceDraftRef.current
          for (const match of text.matchAll(/\[\[([^\]]+)\]\]/g)) {
            const start = match.index ?? 0
            if (offset < start || offset > start + match[0].length) continue
            const [target, ...labelParts] = match[1].split('|')
            handlers.current.onWikiLinkOpen?.(target.trim(), labelParts.join('|').trim() || undefined)
            return
          }
        }}
        data-note-editor-source
      />}
    </div>
  )
}

async function prepareDisplayMarkdown(markdown: string, resolve: NoteEditorProps['resolveImageSrc'], previewToSource: Map<string, string>): Promise<string> {
  const lines = markdown.split(/\r?\n/)
  let fence: string | null = null
  for (let index = 0; index < lines.length; index += 1) {
    const marker = /^\s*(```+|~~~+)/.exec(lines[index])?.[1]
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = null; continue }
    if (fence || !resolve) continue
    const images = [...lines[index].matchAll(/(!\[[^\]]*\]\()([^()\s]+)(\))/g)]
    for (const image of images) {
      const src = image[2]
      if (/^(?:[a-z][a-z0-9+.-]*:|\/\/)/i.test(src)) continue
      try {
        const display = await resolve(src)
        if (display) {
          previewToSource.set(display, src)
          lines[index] = lines[index].replace(image[0], `${image[1]}${display}${image[3]}`)
        }
      } catch { /* Keep the original URI visible when the source is unavailable. */ }
    }
  }
  return lines.join('\n')
}

function restoreSourceMarkdown(markdown: string, previewToSource: Map<string, string>): string {
  let restored = markdown
  for (const [preview, source] of previewToSource) restored = restored.split(preview).join(source)
  return restored
}

function getOutline(markdown: string): NoteHeading[] {
  const headings: NoteHeading[] = []
  let fence: string | null = null
  const lines = markdown.split(/\r?\n/)
  lines.forEach((line, index) => {
    const marker = /^\s*(```+|~~~+)/.exec(line)?.[1]
    if (marker) { if (!fence) fence = marker[0]; else if (marker[0] === fence) fence = null; return }
    if (fence) return
    const match = /^ {0,3}(#{1,6})\s+(.+?)\s*#*\s*$/.exec(line)
    if (match) {
      headings.push({ level: match[1].length, text: plainHeadingText(match[2]), line: index + 1 })
      return
    }
    const underline = /^ {0,3}(=+|-+)\s*$/.exec(lines[index + 1] ?? '')
    if (line.trim() && underline) headings.push({ level: underline[1][0] === '=' ? 1 : 2, text: plainHeadingText(line.trim()), line: index + 1 })
  })
  return headings
}

function plainHeadingText(value: string): string {
  return value
    .replace(/\\([\\`*_{}\[\]()#+\-.!>])/g, '$1')
    .replace(/!\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
    .replace(/`([^`]+)`/g, '$1')
    .replace(/[*_~]/g, '')
}

/** Unicode code points excluding whitespace; CJK characters count individually, Latin/digit runs as words. */
function getStats(markdown: string): NoteDocumentStats {
  const characters = [...markdown.replace(/\s/gu, '')].length
  const cjkPattern = /[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu
  const cjkCount = markdown.match(cjkPattern)?.length ?? 0
  const words = markdown.replace(cjkPattern, ' ').match(/[\p{L}\p{N}]+/gu)?.length ?? 0
  return { characters, words, readingMinutes: Math.max(1, Math.ceil(cjkCount / 400 + words / 80)) }
}
