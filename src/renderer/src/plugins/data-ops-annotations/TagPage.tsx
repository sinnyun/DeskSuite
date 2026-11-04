import { useEffect, useMemo, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { ChevronDown, ChevronRight, Merge, Pencil, Plus, Star, Tags, Trash2 } from 'lucide-react'
import {
  call,
  callValidated,
  errorText,
  getService,
  useUiKit,
  type ContextMenuEntry,
  type ContextMenuService,
  type SelectionService,
  type SelectionSnapshot
} from '../../workbench/sdk'
import { annotationStore, type AnnotationEntry, type TagItem } from './service'
import { annotationTagListSchema, annotationsChangedSchema, entriesByPathSchema, tagCountsSchema } from './schemas'

const NOOP_SUBSCRIBE = (): (() => void) => () => {}
const EMPTY_SELECTION = (): SelectionSnapshot => ({ path: null, entries: [], selected: [] })

interface PanesViewService {
  showTagAggregate(tag: { tagId: number; name: string }): void
  clearTagFocus(): void
}

export function TagPage(): ReactElement {
  const { DesktopButton, DesktopInput, DesktopSelect, DesktopTagPill, DesktopCard, prompt } = useUiKit()
  const selectionService = getService<SelectionService>('selection')
  const selection = useSyncExternalStore(
    selectionService?.subscribe ?? NOOP_SUBSCRIBE,
    selectionService?.getSnapshot ?? EMPTY_SELECTION
  )
  const selectedPaths = useMemo(() => selection.selected.map((item) => item.path), [selection])
  const selectedKey = selectedPaths.join('\u0000')
  const annotationSnapshot = useSyncExternalStore(annotationStore.subscribe, annotationStore.getSnapshot)
  const [tree, setTree] = useState<TagItem[]>([])
  const [entries, setEntries] = useState<Record<string, AnnotationEntry>>({})
  const [counts, setCounts] = useState<Record<string, number>>({})
  const [collapsedIds, setCollapsedIds] = useState<ReadonlySet<number>>(new Set())
  const [activeTagId, setActiveTagId] = useState<number | null>(null)
  const [draft, setDraft] = useState('')
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const panes = getService<PanesViewService>('panes')

  async function refreshTree(): Promise<void> {
    try {
      const [nextTree, nextCounts] = await Promise.all([
        callValidated(annotationTagListSchema, 'annotations', 'tree'),
        callValidated(tagCountsSchema, 'annotations', 'counts').catch(() => ({}))
      ])
      setTree(nextTree)
      setCounts(nextCounts)
      setError('')
      setActiveTagId((current) => {
        if (current === null) return null
        return findTag(nextTree, current) ? current : null
      })
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function refreshEntries(paths = selectedPaths): Promise<void> {
    if (paths.length === 0) {
      setEntries({})
      return
    }
    try {
      setEntries(await callValidated(entriesByPathSchema, 'annotations', 'forPaths', paths))
      await annotationStore.prime(paths)
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  useEffect(() => {
    void refreshTree()
    const unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel === 'annotations:changed' && annotationsChangedSchema.safeParse(payload).success) {
        void refreshTree()
        void refreshEntries()
      }
    })
    return unsubscribe
  }, [selectedKey])

  useEffect(() => {
    void refreshEntries(selectedPaths)
  }, [selectedKey])

  useEffect(() => {
    const contextMenu = getService<ContextMenuService>('contextMenu')
    if (!contextMenu) return
    return contextMenu.register('annotations.tags', (context) => {
      const el = context.target.closest('[data-tag-id]')
      const tag = el ? findTag(tree, Number(el.getAttribute('data-tag-id'))) : undefined
      if (!tag) {
        return [
          {
            id: 'tag-new-root',
            label: '新建根标签…',
            onSelect: () => {
              void prompt({ title: '新建根标签', placeholder: '标签名称', confirmText: '创建' })
                .then((answer) => {
                  const name = answer?.trim()
                  if (!name) return
                  return call('annotations', 'create', { name }).then(refreshTree)
                })
                .catch((cause) => setError(messageOf(cause)))
            }
          },
          { id: 'tag-refresh', label: '刷新标签树', onSelect: () => { void refreshTree() } }
        ]
      }
      const assigned = selectedPaths.length > 0 && selectedPaths.every((path) => entries[path]?.tags.some((entry) => entry.id === tag.id))
      const siblings = siblingTags(tree, tag)
      const items: ContextMenuEntry[] = [
        { id: 'tag-view', label: '查看标签聚合', onSelect: () => selectTag(tag) }
      ]
      if (selectedPaths.length > 0) {
        items.push({ id: 'tag-assign', label: assigned ? '从所选移除' : '应用到所选', disabled: busy, onSelect: () => { void assign(tag, !assigned) } })
      }
      items.push(
        { id: 'tag-add-child', label: '添加子标签…', onSelect: () => { void createChild(tag) } },
        { id: 'tag-rename', label: '重命名…', onSelect: () => { void rename(tag) } }
      )
      if (siblings.length > 0) {
        items.push({
          id: 'tag-merge',
          label: '合并到…',
          submenu: siblings.map((sibling) => ({
            id: `tag-merge-${sibling.id}`,
            label: sibling.name,
            onSelect: () => { void mergeTo(tag, sibling.id) }
          }))
        })
      }
      items.push({ id: 'tag-remove', label: '删除标签', danger: true, onSelect: () => { void remove(tag) } })
      return items
    }, { order: 10 })
    // 处理器闭包引用本渲染的状态函数，依赖覆盖其读取的全部状态。
  }, [tree, selectedKey, entries, activeTagId, busy, prompt])

  const inclusiveCounts = useMemo(() => buildInclusiveCounts(tree, counts), [tree, counts])
  const tagRows = flatten(tree)

  function toggleCollapse(tag: TagItem): void {
    setCollapsedIds((current) => {
      const next = new Set(current)
      if (next.has(tag.id)) next.delete(tag.id)
      else next.add(tag.id)
      return next
    })
  }

  function selectTag(tag: TagItem): void {
    if (!panes) {
      setError('文件浏览器插件未启用，无法显示标签聚合视图')
      return
    }
    if (activeTagId === tag.id) {
      setActiveTagId(null)
      panes.clearTagFocus()
      return
    }
    setActiveTagId(tag.id)
    panes.showTagAggregate({ tagId: tag.id, name: tag.name })
  }

  async function createTag(parentId: number | null = null): Promise<void> {
    const name = draft.trim()
    if (!name) return
    setBusy(true)
    try {
      await call('annotations', 'create', { name, parentId })
      setDraft('')
      await refreshTree()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function assign(tag: TagItem, shouldAssign: boolean): Promise<void> {
    if (selectedPaths.length === 0) return
    setBusy(true)
    try {
      await call('annotations', shouldAssign ? 'assignTag' : 'unassignTag', {
        paths: selectedPaths,
        tagId: tag.id
      })
      await refreshEntries()
    } catch (cause) {
      setError(messageOf(cause))
    } finally {
      setBusy(false)
    }
  }

  async function rename(tag: TagItem): Promise<void> {
    const answer = await prompt({ title: '重命名标签', value: tag.name, confirmText: '保存' })
    const name = answer?.trim()
    if (!name || name === tag.name) return
    try {
      await call('annotations', 'rename', { tagId: tag.id, name })
      await refreshTree()
      await refreshEntries()
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function mergeTo(tag: TagItem, targetId: number): Promise<void> {
    try {
      await call('annotations', 'merge', { sourceId: tag.id, targetId })
      await refreshTree()
      await refreshEntries()
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function merge(tag: TagItem): Promise<void> {
    const candidates = flatten(tree).filter((item) => item.id !== tag.id)
    if (candidates.length === 0) return
    const answer = await prompt({
      title: `合并标签「${tag.name}」`,
      label: `输入合并目标标签编号：\n${candidates.map((item) => `${item.id}：${item.name}`).join('\n')}`,
      multiline: true,
      confirmText: '合并'
    })
    if (!answer) return
    const targetId = Number(answer)
    if (!candidates.some((item) => item.id === targetId)) {
      setError('目标标签编号无效')
      return
    }
    await mergeTo(tag, targetId)
  }

  async function createChild(parent: TagItem): Promise<void> {
    const answer = await prompt({ title: `在「${parent.name}」下新建子标签`, placeholder: '标签名称', confirmText: '创建' })
    const name = answer?.trim()
    if (!name) return
    try {
      await call('annotations', 'create', { name, parentId: parent.id })
      await refreshTree()
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  async function remove(tag: TagItem): Promise<void> {
    if (!window.confirm(`删除标签“${tag.name}”？该标签在文件上的分配会移除，子标签会提升到上一级。`)) return
    try {
      await call('annotations', 'remove', tag.id)
      await refreshTree()
      await refreshEntries()
    } catch (cause) {
      setError(messageOf(cause))
    }
  }

  const activeEntry = selectedPaths.length === 1 ? entries[selectedPaths[0]] : undefined
  const cachedMeta = selectedPaths.length === 1 ? annotationSnapshot[selectedPaths[0]] : undefined

  return (
    <div data-context-zone="annotations.tags" className="flex h-full min-h-0 flex-col gap-3 overflow-auto p-3 text-xs">
      <DesktopCard className="p-3">
        <div className="mb-2 flex items-center justify-between">
          <h2 className="flex items-center gap-1.5 font-semibold">
            <Tags className="h-3.5 w-3.5 text-[var(--ds-accent)] dark:text-[var(--ds-accent-strong)]" />
            标签树
          </h2>
          <span className="text-xs tabular-nums text-[var(--ds-text-subtle)]">{tagRows.length} 个标签</span>
        </div>
        <div className="mb-2 flex gap-1.5">
          <DesktopInput placeholder="新建根标签" value={draft} onChange={(event) => setDraft(event.target.value)} onKeyDown={(event) => { if (event.key === 'Enter') void createTag() }} />
          <DesktopButton size="xs" variant="primary" icon={<Plus className="h-3 w-3" />} disabled={!draft.trim() || busy} onClick={() => void createTag()}>新建</DesktopButton>
        </div>
        {tree.length === 0 ? (
          <p className="py-4 text-center text-[var(--ds-text-subtle)]">暂无标签，先在上方输入名称创建</p>
        ) : (
          <div className="-mx-1 space-y-0.5">
            {tree.map((tag) => (
              <TagRow
                key={tag.id}
                tag={tag}
                expanded={collapsedIds}
                activeId={activeTagId}
                inclusiveCounts={inclusiveCounts}
                selectedPaths={selectedPaths}
                entries={entries}
                busy={busy}
                onToggleCollapse={toggleCollapse}
                onSelect={selectTag}
                onAssign={assign}
                onCreateChild={(parent) => { void createChild(parent) }}
                onRename={rename}
                onMerge={merge}
                onRemove={remove}
              />
            ))}
          </div>
        )}
        <p className="mt-2 border-t border-[var(--ds-border)] pt-2 text-xs leading-5 text-[var(--ds-text-subtle)] dark:border-[var(--ds-border)]">
          点击标签名称，中间文件区会聚合显示该标签（含子标签）下的全部文件。
        </p>
      </DesktopCard>

      <DesktopCard className="p-3">
        <div className="mb-2 font-semibold">当前选择</div>
        {selectedPaths.length === 0 ? <p className="text-[var(--ds-text-muted)]">在文件浏览器中选择条目后，可批量设置标签、收藏和评分。</p> : (
          <>
            <p className="mb-2 text-[var(--ds-text-muted)]">已选 {selectedPaths.length} 项</p>
            {activeEntry && (
              <div className="space-y-2">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate" title={activeEntry.path}>{activeEntry.path}</span>
                  <DesktopButton size="xs" variant={activeEntry.favorite ? 'primary' : 'subtle'} icon={<Star className={`h-3 w-3 ${activeEntry.favorite ? 'fill-current' : ''}`} />} onClick={() => void call('annotations', 'setFavorite', { path: activeEntry.path, favorite: !activeEntry.favorite }).then(() => refreshEntries())}>收藏</DesktopButton>
                </div>
                <div className="flex items-center gap-2">
                  <span className="shrink-0 text-[var(--ds-text-muted)]">评分</span>
                  <DesktopSelect title="设置评分" value={String(activeEntry.rating)} options={[0, 1, 2, 3, 4, 5].map((rating) => ({ value: String(rating), label: rating ? `${'★'.repeat(rating)} ${rating} 星` : '未评分' }))} onChange={(value) => void call('annotations', 'setRating', { path: activeEntry.path, rating: Number(value) }).then(() => refreshEntries())} />
                </div>
                <div className="flex flex-wrap gap-1">{activeEntry.tags.map((tag) => <DesktopTagPill key={tag.id} label={tag.name} variant="blue" />)}</div>
                <DesktopInput placeholder="备注" value={activeEntry.note} onChange={(event) => { const note = event.target.value; setEntries((current) => ({ ...current, [activeEntry.path]: { ...activeEntry, note } })) }} onBlur={(event) => void call('annotations', 'setNote', { path: activeEntry.path, note: event.target.value }).catch((cause) => setError(messageOf(cause)))} />
              </div>
            )}
            {selectedPaths.length > 1 && <p className="mt-2 text-[var(--ds-text-muted)]">点击标签行上的“应用”可将标签分配给全部选中项。</p>}
            {!activeEntry && cachedMeta && <p className="text-[var(--ds-text-muted)]">正在读取标注…</p>}
          </>
        )}
      </DesktopCard>
      {error && <p role="alert" className="rounded-[var(--ds-radius-control)] border border-[var(--ds-status-danger)]/30 bg-[var(--ds-status-danger-soft)] p-2 text-[var(--ds-status-danger)]">{error}</p>}
    </div>
  )
}

function TagRow({
  tag,
  expanded,
  activeId,
  inclusiveCounts,
  selectedPaths,
  entries,
  busy,
  onToggleCollapse,
  onSelect,
  onAssign,
  onCreateChild,
  onRename,
  onMerge,
  onRemove
}: {
  tag: TagItem
  expanded: ReadonlySet<number>
  activeId: number | null
  inclusiveCounts: Map<number, number>
  selectedPaths: string[]
  entries: Record<string, AnnotationEntry>
  busy: boolean
  onToggleCollapse: (tag: TagItem) => void
  onSelect: (tag: TagItem) => void
  onAssign: (tag: TagItem, assign: boolean) => Promise<void>
  onCreateChild: (tag: TagItem) => void
  onRename: (tag: TagItem) => Promise<void>
  onMerge: (tag: TagItem) => Promise<void>
  onRemove: (tag: TagItem) => Promise<void>
}): ReactElement {
  const { DesktopButton, DesktopIconButton } = useUiKit()
  const hasChildren = tag.children.length > 0
  const isExpanded = !expanded.has(tag.id)
  const isActive = activeId === tag.id
  const assigned = selectedPaths.length > 0 && selectedPaths.every((path) => entries[path]?.tags.some((entry) => entry.id === tag.id))
  const count = inclusiveCounts.get(tag.id) ?? 0
  return (
    <div>
      <div className="group flex min-w-0 items-center gap-1 pr-1 pl-1">
        <DesktopIconButton
          size="xs"
          tooltip={isExpanded ? '折叠子标签' : '展开子标签'}
          disabled={!hasChildren}
          onClick={() => onToggleCollapse(tag)}
          className={!hasChildren ? 'opacity-0' : ''}
          icon={isExpanded ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
        />
        <DesktopButton size="xs" variant="ghost" active={isActive} data-tag-id={tag.id} data-tag-name={tag.name} onClick={() => onSelect(tag)} title={tag.path} className="min-w-0 flex-1 justify-start gap-1.5 px-1.5 text-left">
          <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${isActive ? 'bg-[var(--ds-accent)] dark:bg-[var(--ds-accent-strong)]' : 'bg-[var(--ds-border-strong)]'}`} />
          <span className={`min-w-0 flex-1 truncate ${isActive ? 'font-semibold' : ''}`}>{tag.name}</span>
          {count > 0 && (
            <span className={`shrink-0 rounded-full px-1.5 py-px text-xs tabular-nums ${isActive ? 'bg-[var(--ds-surface-raised)] text-[var(--ds-accent)]' : 'bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)] dark:bg-[var(--ds-surface-muted)] dark:text-[var(--ds-text-subtle)]'}`}>
              {count}
            </span>
          )}
        </DesktopButton>
        <div className={`flex shrink-0 items-center gap-0.5 ${isActive ? '' : 'opacity-0 transition-opacity group-hover:opacity-100 focus-within:opacity-100'}`}>
          {selectedPaths.length > 0 && (
            <DesktopButton size="xs" variant={assigned ? 'primary' : 'subtle'} disabled={busy} onClick={() => void onAssign(tag, !assigned)}>{assigned ? '已应用' : '应用'}</DesktopButton>
          )}
          <DesktopIconButton size="xs" tooltip="添加子标签" icon={<Plus className="h-3 w-3" />} onClick={() => onCreateChild(tag)} />
          <DesktopIconButton size="xs" tooltip="重命名标签" icon={<Pencil className="h-3 w-3" />} onClick={() => void onRename(tag)} />
          <DesktopIconButton size="xs" tooltip="合并标签" icon={<Merge className="h-3 w-3" />} onClick={() => void onMerge(tag)} />
          <DesktopIconButton size="xs" tooltip="删除标签" icon={<Trash2 className="h-3 w-3" />} onClick={() => void onRemove(tag)} />
        </div>
      </div>
      {hasChildren && isExpanded && (
        <div className="ml-3 border-l border-[var(--ds-border)]">
          {tag.children.map((child) => (
            <TagRow
              key={child.id}
              tag={child}
              expanded={expanded}
              activeId={activeId}
              inclusiveCounts={inclusiveCounts}
              selectedPaths={selectedPaths}
              entries={entries}
              busy={busy}
              onToggleCollapse={onToggleCollapse}
              onSelect={onSelect}
              onAssign={onAssign}
              onCreateChild={onCreateChild}
              onRename={onRename}
              onMerge={onMerge}
              onRemove={onRemove}
            />
          ))}
        </div>
      )}
    </div>
  )
}

function findTag(nodes: TagItem[], id: number): TagItem | undefined {
  for (const node of nodes) {
    if (node.id === id) return node
    const nested = findTag(node.children, id)
    if (nested) return nested
  }
  return undefined
}

function siblingTags(nodes: TagItem[], tag: TagItem): TagItem[] {
  const walk = (list: TagItem[], parent: TagItem | null): TagItem[] | null => {
    for (const node of list) {
      if (node.id === tag.id) {
        return (parent ? parent.children : list).filter((item) => item.id !== tag.id)
      }
      const found = walk(node.children, node)
      if (found) return found
    }
    return null
  }
  return walk(nodes, null) ?? []
}

function buildInclusiveCounts(nodes: TagItem[], counts: Record<string, number>): Map<number, number> {
  const result = new Map<number, number>()
  const visit = (node: TagItem): number => {
    let total = counts[String(node.id)] ?? 0
    for (const child of node.children) total += visit(child)
    result.set(node.id, total)
    return total
  }
  for (const node of nodes) visit(node)
  return result
}

function flatten(nodes: TagItem[]): TagItem[] {
  return nodes.flatMap((node) => [node, ...flatten(node.children)])
}

function messageOf(error: unknown): string {
  return errorText(error, '标注操作失败')
}
