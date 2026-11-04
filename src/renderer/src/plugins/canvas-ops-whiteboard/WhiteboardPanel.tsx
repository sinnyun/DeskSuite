import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import {
  AlignHorizontalDistributeCenter,
  AlignVerticalDistributeCenter,
  Bookmark,
  BringToFront,
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  ChevronsDownUp,
  ChevronsUpDown,
  Circle,
  ClipboardPaste,
  Copy,
  CopyPlus,
  Crop,
  Crosshair,
  FileImage,
  FileUp,
  FlipHorizontal2,
  FlipVertical2,
  Frame,
  Grid2X2,
  Group,
  Hand,
  Image as ImageIcon,
  ImagePlus,
  Layers3,
  LayoutGrid,
  Lock,
  LockOpen,
  Magnet,
  Maximize,
  Minus,
  MoreHorizontal,
  MousePointer2,
  MoveHorizontal,
  MoveUpRight,
  MoveVertical,
  PanelsTopLeft,
  Pencil,
  Plus,
  RotateCw,
  Redo2,
  Ruler,
  Search,
  SendToBack,
  SlidersHorizontal,
  Square,
  SquareDashed,
  StickyNote,
  Trash2,
  Type,
  Ungroup,
  Undo2,
  ZoomIn,
  ZoomOut
} from 'lucide-react'
import { call, getService, useLayoutShallow, useUiKit } from '../../workbench/sdk'
import type { ContextMenuEntry, ContextMenuService } from '../../workbench/sdk'
import { getCanvas } from './contract'
import type { BoardNode, CanvasService } from './contract'
import { BoardEngine } from './engine'
import { BoardViewport } from './viewport'
import './whiteboard.css'

type InspectorTab = 'layers' | 'properties'

type LayerRow =
  | { kind: 'group'; gid: string; count: number; depth: number }
  | { kind: 'node'; node: BoardNode; depth: number; expandable: boolean }

export function WhiteboardPanel(): ReactElement | null {
  const board = getCanvas()
  return board ? <Panel board={board} /> : null
}

function Panel({ board }: { board: CanvasService }): ReactElement | null {
  const state = useSyncExternalStore(board.subscribe, board.getSnapshot)
  const { ThemeFloatingPanel, DesktopButton, DesktopInput, DesktopSelect, prompt } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, openFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, openFloatingPanel: state.openFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'whiteboard'
  const [search, setSearch] = useState('')
  const [rename, setRename] = useState('')
  const [renameOpen, setRenameOpen] = useState(false)
  const [moreOpen, setMoreOpen] = useState(false)
  const [confirmDelete, setConfirmDelete] = useState(false)
  const [inspectorTab, setInspectorTab] = useState<InspectorTab>('layers')
  const [inspectorCollapsed, setInspectorCollapsed] = useState(false)
  const [expandedRows, setExpandedRows] = useState<Record<string, boolean>>({})
  const thumbCacheRef = useRef(new Map<string, { key: string; url: string }>())
  const [, setThumbVersion] = useState(0)
  useEffect(() => board.register('inspector', args => {
    if (args.tab !== 'layers' && args.tab !== 'properties') throw new Error('属性页签无效')
    setInspectorTab(args.tab)
    setInspectorCollapsed(false)
    return args.tab
  }), [board])

  const execute = (name: string, args: Record<string, unknown> = {}): void => {
    void board.command(name, args).catch((e) => board.report(e))
  }
  useEffect(() => {
    if (isOpen && !board.getSnapshot().id) void board.open().catch((e) => board.report(e))
    if (!isOpen) void board.flush().catch(() => {})
  }, [isOpen, board])
  useEffect(() => setRename(state.scene.title), [state.id, state.scene.title])
  useEffect(() => {
    thumbCacheRef.current.clear()
    setThumbVersion((value) => value + 1)
  }, [state.id])
  useEffect(() => {
    if (!isOpen || inspectorCollapsed || inspectorTab !== 'layers') return
    let cancelled = false
    const thumbKey = (node: BoardNode): string =>
      JSON.stringify([
        node.type,
        node.fill,
        node.width,
        node.height,
        node.rotation,
        node.scaleX,
        node.scaleY,
        node.text ?? '',
        node.resource ?? '',
        node.crop ?? null,
        node.clip ?? null,
        node.collapsed
      ])
    const run = async (): Promise<void> => {
      for (const node of state.scene.nodes) {
        const key = thumbKey(node)
        const cached = thumbCacheRef.current.get(node.id)
        if (cached && cached.key === key) continue
        try {
          const data = await board.command('thumbnail', { id: node.id, size: 48 })
          if (cancelled) return
          if (typeof data === 'string' && data.startsWith('data:image')) {
            thumbCacheRef.current.set(node.id, { key, url: data })
            setThumbVersion((value) => value + 1)
          }
        } catch {
          if (cancelled) return
        }
      }
    }
    const timer = window.setTimeout(() => void run(), 250)
    return () => {
      cancelled = true
      window.clearTimeout(timer)
    }
  }, [board, isOpen, inspectorCollapsed, inspectorTab, state.id, state.scene.nodes])
  useEffect(
    () =>
      window.bridge.onEvent((channel, payload) => {
        if (channel !== 'whiteboard:action') return
        const args = payload as {
          requestId: string
          action: string
          boardId?: string
          sceneJson?: string
          deferSave?: boolean
          command?: string
          args?: Record<string, unknown>
        }
        void (async () => {
          try {
            let value: unknown = true
            if (args.action === 'open' || args.action === 'replace') {
              await board.open(args.boardId)
              openFloatingPanel('whiteboard')
              if (args.action === 'replace') {
                if (!args.sceneJson) throw new Error('缺少场景')
                await board.replace(args.sceneJson)
              }
            } else if (args.action === 'flush') await board.flush()
            else if (args.action === 'inspect') value = { ...board.getSnapshot(), engine: 'LeaferJS' }
            else if (args.action === 'command') {
              if (args.command === 'new') {
                await board.create(String(args.args?.title ?? '新画板'))
                value = board.getSnapshot().id
              } else if (args.command === 'removeBoard') await board.remove()
              else {
                if (!board.getSnapshot().id) throw new Error('请先打开画板')
                value = await board.command(args.command ?? '', args.args)
              }
              if (!args.deferSave) await board.flush()
            }
            await call('whiteboard', 'complete', args.requestId, { value: value ?? true })
          } catch (error) {
            await call('whiteboard', 'complete', args.requestId, { error: String(error) })
          }
        })()
      }),
    [board, openFloatingPanel]
  )
  useEffect(
    () => () => {
      void board.flush().catch(() => {})
    },
    [board]
  )
  useEffect(() => {
    const cm = getService<ContextMenuService>('contextMenu')
    if (!cm) return
    return cm.register('canvas.board', ({ target, clientX, clientY }) => {
      const snapshot = board.getSnapshot()
      const scene = snapshot.scene
      if (!snapshot.id) return null
      const domHit =
        target instanceof Element
          ? target.closest<HTMLElement>('[data-canvas-content]')?.dataset.canvasContent
          : undefined
      const hit = domHit ? { kind: 'node' as const, id: domHit } : BoardEngine.active?.hitAtClient(clientX, clientY)
      let ids: string[] = []
      if (hit?.kind === 'group') {
        const groups = new Map((scene.groups ?? []).map((g) => [g.id, g]))
        for (const node of scene.nodes) {
          let gid: string | undefined = node.group
          while (gid) {
            if (gid === hit.id) {
              ids.push(node.id)
              break
            }
            gid = groups.get(gid)?.parent
          }
        }
      } else if (hit) ids = [hit.id]
      if (!ids.length) ids = snapshot.selection
      const act = (command: string, args: Record<string, unknown> = {}): (() => void) => () => {
        board.select(ids, false)
        execute(command, args)
      }
      if (ids.length) {
        const nodes = scene.nodes.filter((n) => ids.includes(n.id))
        const allLocked = nodes.length > 0 && nodes.every((n) => n.locked)
        const single = ids.length === 1 ? nodes[0] : undefined
        const hasGroup = nodes.some((n) => n.group)
        const hasFrame = nodes.some((n) => n.frame)
        const isEagle = typeof single?.resource === 'string' && single.resource.startsWith('eagle:')
        const menu: ContextMenuEntry[] = []
        if (single && (single.type === 'text' || single.type === 'note') && !allLocked)
          menu.push({
            id: 'edit-text',
            label: '编辑文本',
            onSelect: () => {
              board.select(ids, false)
              if (single.html) execute('richText')
              else execute('textEdit', { action: 'open', id: single.id })
            }
          })
        if (single?.type === 'image' && !allLocked) menu.push({ id: 'crop', label: '裁剪', onSelect: act('cropOpen') })
        if (menu.length) menu.push({ id: 'sep-top', separator: true })
        menu.push(
          { id: 'copy', label: '复制', shortcut: 'Ctrl+C', onSelect: act('copy') },
          { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', onSelect: () => execute('paste') },
          { id: 'duplicate', label: '创建副本', onSelect: act('duplicate') },
          { id: 'delete', label: '删除', danger: true, shortcut: 'Del', onSelect: () => {
            if (!window.confirm(`删除选中的 ${ids.length} 个元素？`)) return
            board.select(ids, false)
            execute('delete')
          } },
          { id: 'lock', label: allLocked ? '解锁' : '锁定', checked: allLocked, onSelect: act('lock', { value: !allLocked }) },
          {
            id: 'order',
            label: '层级',
            submenu: [
              { id: 'order-top', label: '置于顶层', onSelect: act('order', { direction: 'top' }) },
              { id: 'order-bottom', label: '置于底层', onSelect: act('order', { direction: 'bottom' }) }
            ]
          },
          {
            id: 'grouping',
            label: '组合',
            submenu: [
              { id: 'group-new', label: '创建组合', disabled: ids.length < 2 ? '需要选中至少 2 个元素' : false, onSelect: act('group') },
              { id: 'group-remove', label: '取消组合', disabled: hasGroup ? false : '所选元素不在组合内', onSelect: act('ungroup') }
            ]
          },
          {
            id: 'framing',
            label: '分区',
            submenu: [
              { id: 'frame-new', label: '用分区包住所选元素', onSelect: act('frameSelection') },
              { id: 'frame-remove', label: '从所在分区移出', disabled: hasFrame ? false : '所选元素不在分区内', onSelect: act('detachFrame') }
            ]
          },
          {
            id: 'transform',
            label: '变换',
            submenu: [
              { id: 'rotate', label: '旋转 90°', onSelect: act('rotate', { angle: 90 }) },
              { id: 'rotate-neg', label: '旋转 -90°', onSelect: act('rotate', { angle: -90 }) },
              { id: 'flip-x', label: '水平镜像', onSelect: act('flip', { axis: 'x' }) },
              { id: 'flip-y', label: '垂直镜像', onSelect: act('flip', { axis: 'y' }) }
            ]
          },
          {
            id: 'arrange',
            label: '排列',
            submenu: [
              { id: 'arrange-grid', label: '网格排列', disabled: ids.length < 2 ? '需要选中至少 2 个元素' : false, onSelect: act('arrange', { mode: 'grid' }) },
              { id: 'arrange-h', label: '横向排列', disabled: ids.length < 2 ? '需要选中至少 2 个元素' : false, onSelect: act('arrange', { mode: 'horizontal' }) },
              { id: 'arrange-v', label: '纵向排列', disabled: ids.length < 2 ? '需要选中至少 2 个元素' : false, onSelect: act('arrange', { mode: 'vertical' }) },
              { id: 'dist-x', label: '等距分布（横向）', disabled: ids.length < 3 ? '需要至少 3 个元素' : false, onSelect: act('distribute', { axis: 'x' }) },
              { id: 'dist-y', label: '等距分布（纵向）', disabled: ids.length < 3 ? '需要至少 3 个元素' : false, onSelect: act('distribute', { axis: 'y' }) }
            ]
          }
        )
        if (single && isEagle)
          menu.push(
            { id: 'sep-eagle', separator: true },
            { id: 'eagle-open', label: '在 Eagle 中定位', onSelect: () => { board.select(ids, false); execute('eagleOpen', { id: single.id }) } },
            { id: 'eagle-refresh', label: '刷新 Eagle 信息', onSelect: () => { board.select(ids, false); execute('eagleInspect', { id: single.id, refresh: true }) } }
          )
        return menu
      }
      const point = BoardEngine.active?.clientToBoard(clientX, clientY) ?? { x: 140, y: 100 }
      const addShape = (type: string): ContextMenuEntry => ({
        id: `add-${type}`,
        label: ({ rect: '矩形', ellipse: '椭圆', line: '直线', arrow: '箭头', text: '文本', note: '便签', frame: '分区' } as Record<string, string>)[type] ?? type,
        onSelect: () => execute('add', { type, x: point.x, y: point.y })
      })
      return [
        { id: 'paste', label: '粘贴', shortcut: 'Ctrl+V', onSelect: () => execute('paste') },
        {
          id: 'add',
          label: '添加元素',
          submenu: ['rect', 'ellipse', 'line', 'arrow', 'text', 'note', 'frame'].map(addShape)
        },
        { id: 'import', label: '导入文件…', onSelect: () => execute('import') },
        { id: 'paste-image', label: '粘贴剪贴板图片', onSelect: () => execute('pasteImage') },
        {
          id: 'select-all',
          label: '全选',
          shortcut: 'Ctrl+A',
          disabled: scene.nodes.some((n) => !n.locked) ? false : '画板是空的',
          onSelect: () => execute('select', { ids: scene.nodes.filter((n) => !n.locked).map((n) => n.id) })
        },
        { id: 'fit', label: '缩放适应内容', shortcut: 'Shift+1', onSelect: () => execute('fit') },
        {
          id: 'bookmark',
          label: '保存视图书签…',
          onSelect: () => {
            void prompt({ title: '保存视图书签', label: '书签名称', value: '视图书签', confirmText: '保存' }).then((name) => {
              if (!name) return
              execute('bookmark', { name })
            })
          }
        },
        {
          id: 'background',
          label: '背景',
          submenu: (['dots', 'grid', 'none'] as const).map((bg) => ({
            id: `bg-${bg}`,
            label: bg === 'dots' ? '点阵' : bg === 'grid' ? '网格' : '无',
            checked: scene.background === bg,
            onSelect: () => execute('settings', { background: bg })
          }))
        },
        { id: 'snap', label: '吸附对齐', checked: scene.snap, onSelect: () => execute('settings', { snap: !scene.snap }) },
        { id: 'rulers', label: '显示标尺', checked: scene.rulers, onSelect: () => execute('settings', { rulers: !scene.rulers }) },
        {
          id: 'export',
          label: '导出画板',
          submenu: [
            { id: 'export-png', label: '导出为 PNG', onSelect: () => execute('export', { format: 'png' }) },
            { id: 'export-jpeg', label: '导出为 JPEG', onSelect: () => execute('export', { format: 'jpeg' }) }
          ]
        },
        {
          id: 'search',
          label: '搜索节点…',
          onSelect: () => {
            void prompt({ title: '搜索节点', label: '按名称 / 文本 / 标签搜索', placeholder: '输入关键词', confirmText: '搜索' }).then((query) => {
              if (!query) return
              void board
                .command('search', { query })
                .then((rows) => {
                  const found = Array.isArray(rows) ? rows.map((row) => String((row as { id?: unknown }).id)) : []
                  if (!found.length) {
                    board.report(`没有找到「${query}」相关的元素`)
                    return
                  }
                  board.select(found)
                  execute('fit', { selection: true })
                })
                .catch((e) => board.report(e))
            })
          }
        },
        { id: 'sep-del', separator: true },
        {
          id: 'remove-board',
          label: '删除画板…',
          danger: true,
          onSelect: () => {
            if (!window.confirm(`删除画板「${scene.title}」？`)) return
            void board.remove().catch((e) => board.report(e))
          }
        }
      ]
    }, { order: 10 })
  }, [board, execute, prompt])
  if (!isOpen) return null

  const selection = state.scene.nodes.filter((n) => state.selection.includes(n.id))
  const selected = selection[0]
  const results = search
    ? state.scene.nodes.filter((n) =>
        [n.name, n.text ?? '', ...n.tags].join(' ').toLocaleLowerCase().includes(search.toLocaleLowerCase())
      )
    : []
  const button = (
    label: string,
    command: string,
    args: Record<string, unknown> = {},
    disabled = false,
    icon?: ReactElement
  ): ReactElement => (
    <DesktopButton
      key={label}
      size="xs"
      variant="ghost"
      icon={icon}
      disabled={disabled}
      className="wb-button"
      title={label}
      aria-label={label}
      onClick={() => execute(command, args)}
    >
      {label}
    </DesktopButton>
  )
  const iconButton = (
    label: string,
    command: string,
    args: Record<string, unknown> = {},
    disabled = false,
    icon?: ReactElement
  ): ReactElement => (
    <DesktopButton
      key={label}
      size="xs"
      variant="ghost"
      icon={icon}
      disabled={disabled}
      className="wb-icon-button"
      title={label}
      aria-label={label}
      onClick={() => execute(command, args)}
    />
  )
  const add = (label: string, type: 'rect' | 'ellipse' | 'line' | 'arrow' | 'text' | 'note' | 'frame', icon: ReactElement): ReactElement => (
    <DesktopButton
      key={type}
      size="xs"
      variant="ghost"
      icon={icon}
      className="wb-icon-button"
      title={label}
      aria-label={label}
      onClick={() =>
        execute('add', {
          type,
          x: (140 - state.scene.view.x) / state.scene.view.zoom,
          y: (100 - state.scene.view.y) / state.scene.view.zoom
        })
      }
    />
  )
  const zoomBy = (factor: number): void =>
    void board
      .command('zoom', { value: Math.min(8, Math.max(0.05, state.scene.view.zoom * factor)) })
      .catch((error) => board.report(error))
  const cycleBackground = (): void => {
    const order: Array<'dots' | 'grid' | 'none'> = ['dots', 'grid', 'none']
    const next = order[(order.indexOf(state.scene.background) + 1) % order.length]
    execute('settings', { background: next })
  }
  const backgroundLabel = state.scene.background === 'dots' ? '点阵' : state.scene.background === 'grid' ? '网格' : '纯色'
  const groupOpen = (gid: string): boolean => expandedRows[gid] ?? false
  const frameOpen = (fid: string): boolean => expandedRows[fid] ?? true
  const layerRows: LayerRow[] = (() => {
    const ordered = [...state.scene.nodes].reverse(), rows: LayerRow[] = []
    const parents = new Map((state.scene.groups ?? []).map(g => [g.id, g.parent]))
    for (const node of ordered) if (node.group && !parents.has(node.group)) parents.set(node.group, undefined)
    const ancestorAt = (id: string, parent?: string): string => {
      while (parents.get(id) !== parent && parents.get(id)) id = parents.get(id)!
      return id
    }
    const emit = (members: BoardNode[], depth: number, parentGroup?: string): void => {
      const seen = new Set<string>()
      for (const node of members) {
        const gid = node.group && node.group !== parentGroup ? ancestorAt(node.group, parentGroup) : undefined
        if (gid) {
          if (seen.has(gid)) continue
          seen.add(gid)
          const children = members.filter(n => n.group && ancestorAt(n.group, parentGroup) === gid)
          rows.push({ kind: 'group', gid, count: children.length, depth })
          if (groupOpen(gid)) emit(children, depth + 1, gid)
        } else {
          rows.push({ kind: 'node', node, depth, expandable: ordered.some(n => n.frame === node.id) })
          if (node.type === 'frame' && frameOpen(node.id)) emit(ordered.filter(n => n.frame === node.id), depth + 1)
        }
      }
    }
    emit(ordered.filter(n => !n.frame), 0)
    return rows
  })()
  const rowAction = (node: BoardNode, label: string, command: string, args: Record<string, unknown>, icon: ReactElement): ReactElement => (
    <DesktopButton
      key={label}
      size="xs"
      variant="ghost"
      icon={icon}
      className="wb-layer-action"
      title={label}
      aria-label={label}
      onClick={(event) => {
        event.stopPropagation()
        board.select([node.id], false)
        execute(command, args)
      }}
    />
  )

  return (
    <ThemeFloatingPanel
      className="wb-panel"
      title="画板"
      badge={state.error ? '保存异常' : state.textEditing ? '编辑中' : state.saving ? '保存中' : '已保存'}
      icon={<PanelsTopLeft className="h-3.5 w-3.5" />}
      isOpen
      onClose={() => {
        void board.flush().then(closeFloatingPanel).catch((e) => board.report(e))
      }}
      initialX={70}
      initialY={48}
      initialWidth={1120}
      initialHeight={760}
      minWidth={820}
      minHeight={560}
    >
      <div className="leafer-board relative flex h-full min-h-0 flex-col" data-whiteboard-id={state.id}>
        {state.error && (
          <div role="alert" className="wb-error absolute left-1/2 top-2 z-40 -translate-x-1/2 rounded-lg px-3 py-1.5 text-xs">
            {state.error}
          </div>
        )}

        <div className="wb-stage relative min-h-0 flex-1 overflow-hidden rounded-xl" data-whiteboard-stage>
          <BoardViewport board={board} state={state} />

          <div className="wb-board-controls absolute left-3 top-3 z-20 flex items-center gap-1.5 rounded-xl p-1.5" aria-label="画板管理">
            <DesktopSelect
              className="wb-board-select"
              title="选择画板"
              value={state.id}
              options={state.boards.map((b) => ({ value: b.id, label: b.title }))}
              onChange={(value) => {
                setConfirmDelete(false)
                setMoreOpen(false)
                void board.open(value).catch((err) => board.report(err))
              }}
            />
            <DesktopButton
              size="xs"
              variant="ghost"
              icon={<Plus className="h-4 w-4" />}
              className="wb-icon-button"
              title="新建画板"
              aria-label="新建画板"
              onClick={() => void board.create().catch((e) => board.report(e))}
            />
            <DesktopButton
              size="xs"
              variant="ghost"
              active={renameOpen}
              icon={<Pencil className="h-4 w-4" />}
              className="wb-icon-button"
              title="重命名画板"
              aria-label="重命名画板"
              aria-expanded={renameOpen}
              onClick={() => setRenameOpen((value) => !value)}
            />
            {renameOpen && (
              <div className="wb-rename">
                <DesktopInput
                  autoFocus
                  aria-label="画板名称"
                  value={rename}
                  onChange={(e) => setRename(e.target.value)}
                  onBlur={() => {
                    if (rename.trim()) execute('settings', { title: rename.trim() })
                    setRenameOpen(false)
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Escape') {
                      setRename(state.scene.title)
                      setRenameOpen(false)
                    }
                  }}
                />
              </div>
            )}
            <DesktopButton
              size="xs"
              variant="pill"
              active={!state.error && !state.saving && !state.textEditing}
              className={`wb-status-pill${state.error ? ' wb-status-error' : ''}`}
              title="保存 / 重试"
              aria-label={state.error ? '保存异常，点击重试' : state.textEditing ? '编辑中' : state.saving ? '保存中' : '已保存'}
              onClick={() => void board.flush().then(() => board.refresh()).catch((e) => board.report(e))}
            >
              {state.error ? '保存异常' : state.textEditing ? '编辑中' : state.saving ? '保存中' : '已保存'}
            </DesktopButton>
            <span className="wb-toolbar-divider" />
            {iconButton('撤销', 'undo', {}, !state.canUndo, <Undo2 className="h-4 w-4" />)}
            {iconButton('重做', 'redo', {}, !state.canRedo, <Redo2 className="h-4 w-4" />)}
            <span className="wb-toolbar-divider" />
            <DesktopButton size="xs" variant="ghost" icon={<ZoomOut className="h-4 w-4" />} className="wb-icon-button" title="缩小" aria-label="缩小" onClick={() => zoomBy(1 / 1.2)} />
            <DesktopButton
              size="xs"
              variant="ghost"
              className="wb-zoom-value"
              title="重置为 100%"
              aria-label="重置为 100%"
              onClick={() => execute('zoom', { value: 1 })}
            >
              {Math.round(state.scene.view.zoom * 100)}%
            </DesktopButton>
            <DesktopButton size="xs" variant="ghost" icon={<ZoomIn className="h-4 w-4" />} className="wb-icon-button" title="放大" aria-label="放大" onClick={() => zoomBy(1.2)} />
            <span className="wb-toolbar-divider" />
            {iconButton('适应全部', 'fit', {}, false, <Maximize className="h-4 w-4" />)}
            {iconButton('聚焦所选', 'fit', { selection: true }, false, <Crosshair className="h-4 w-4" />)}
            <span className="wb-toolbar-divider" />
            <DesktopButton
              size="xs"
              variant="ghost"
              active={state.scene.background !== 'none'}
              icon={<Grid2X2 className="h-4 w-4" />}
              className="wb-icon-button"
              title={`背景：${backgroundLabel}`}
              aria-label={`背景：${backgroundLabel}`}
              onClick={cycleBackground}
            />
            <DesktopButton
              size="xs"
              variant="ghost"
              active={state.scene.snap}
              icon={<Magnet className="h-4 w-4" />}
              className="wb-icon-button"
              title="吸附"
              aria-label="吸附"
              aria-pressed={state.scene.snap}
              onClick={() => execute('settings', { snap: !state.scene.snap })}
            />
            <DesktopButton
              size="xs"
              variant="ghost"
              active={state.scene.rulers}
              icon={<Ruler className="h-4 w-4" />}
              className="wb-icon-button"
              title="标尺"
              aria-label="标尺"
              aria-pressed={state.scene.rulers}
              onClick={() => execute('settings', { rulers: !state.scene.rulers })}
            />
            <span className="wb-toolbar-divider" />
            <DesktopButton
              size="xs"
              variant="ghost"
              icon={<ImageIcon className="h-4 w-4" />}
              className="wb-button"
              title="导出 PNG"
              aria-label="导出 PNG"
              onClick={() => execute('export', { format: 'png' })}
            >
              导出 PNG
            </DesktopButton>
            {iconButton('导出 JPEG', 'export', { format: 'jpeg' }, false, <FileImage className="h-4 w-4" />)}
            <div className="wb-more-wrap">
              <DesktopButton
                size="xs"
                variant="ghost"
                active={moreOpen}
                icon={<MoreHorizontal className="h-4 w-4" />}
                className="wb-icon-button"
                title="更多"
                aria-label="更多"
                aria-expanded={moreOpen}
                onClick={() => setMoreOpen((value) => !value)}
              />
              {moreOpen && (
                <div className="wb-more-popover" role="menu" aria-label="画板更多操作">
                  <label className="wb-search-field">
                    <Search className="h-3.5 w-3.5 shrink-0" />
                    <DesktopInput
                      aria-label="搜索画板"
                      placeholder="名称、标签或文字"
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                    />
                  </label>
                  {search && (
                    <div className="wb-popover-scroll">
                      {results.map((node) => (
                        <DesktopButton
                          key={node.id}
                          size="xs"
                          variant="ghost"
                          className="w-full justify-start truncate"
                          title={node.name}
                          onClick={() => {
                            board.select([node.id])
                            execute('fit', { selection: true })
                            setMoreOpen(false)
                          }}
                        >
                          {node.name}
                        </DesktopButton>
                      ))}
                      {!results.length && <p className="wb-muted px-1 py-2">没有匹配的对象</p>}
                    </div>
                  )}
                  <div className="wb-popover-section">
                    <div className="wb-section-title flex items-center gap-1.5"><Bookmark className="h-3.5 w-3.5" />视图书签</div>
                    {button('保存当前视图', 'bookmark', { name: `视图 ${state.scene.bookmarks.length + 1}` })}
                    {state.scene.bookmarks.map((bookmark) => (
                      <DesktopButton key={bookmark.id} size="xs" variant="ghost" className="mt-1 w-full justify-start" onClick={() => execute('bookmark', { go: bookmark.id })}>
                        {bookmark.name}
                      </DesktopButton>
                    ))}
                  </div>
                  <DesktopButton
                    size="xs"
                    variant="ghost"
                    className="w-full justify-start"
                    icon={<FileUp className="h-3.5 w-3.5" />}
                    onClick={() => {
                      const paths =
                        getService<{ getSnapshot(): { selected: { path: string; isDirectory?: boolean }[] } }>('selection')
                          ?.getSnapshot()
                          .selected.filter((node) => !node.isDirectory)
                          .map((node) => node.path) ?? []
                      if (paths.length) execute('import', { paths })
                      else board.report('请先在文件浏览器中选择文件')
                    }}
                  >
                    添加浏览器选中文件
                  </DesktopButton>
                  <div className="wb-popover-section">
                    <span className="wb-node-count">{state.scene.nodes.length} 个元素</span>
                    <DesktopButton
                      size="xs"
                      variant={confirmDelete ? 'danger' : 'ghost'}
                      className="w-full justify-start"
                      title={confirmDelete ? '确认删除此画板' : '删除画板'}
                      onClick={() => {
                        if (!confirmDelete) setConfirmDelete(true)
                        else {
                          setConfirmDelete(false)
                          setMoreOpen(false)
                          void board.remove().catch((e) => board.report(e))
                        }
                      }}
                    >
                      {confirmDelete ? '确认删除' : '删除画板'}
                    </DesktopButton>
                  </div>
                </div>
              )}
            </div>
          </div>

          <div className="wb-tool-palette absolute left-3 top-[76px] z-20 flex flex-col items-center gap-1 rounded-xl p-1.5" role="toolbar" aria-label="画板工具">
            <DesktopButton
              size="xs"
              variant={state.interaction ? 'primary' : 'ghost'}
              icon={<MousePointer2 className="h-4 w-4" />}
              className="wb-icon-button"
              title={state.interaction ? '内容模式' : '画布模式'}
              aria-label={state.interaction ? '内容模式' : '画布模式'}
              onClick={() => execute('interaction', { value: !state.interaction })}
            />
            <span className="wb-tool-divider" />
            <span className="wb-tool-hint" title="按住空格或中键拖动画布" aria-label="按住空格或中键拖动画布">
              <Hand className="h-4 w-4" />
            </span>
            <span className="wb-tool-divider" />
            {add('矩形', 'rect', <Square className="h-4 w-4" />)}
            {add('圆形', 'ellipse', <Circle className="h-4 w-4" />)}
            {add('直线', 'line', <Minus className="h-4 w-4" />)}
            {add('箭头', 'arrow', <MoveUpRight className="h-4 w-4" />)}
            {add('文本', 'text', <Type className="h-4 w-4" />)}
            {add('便签', 'note', <StickyNote className="h-4 w-4" />)}
            {add('分区', 'frame', <Frame className="h-4 w-4" />)}
            <span className="wb-tool-divider" />
            {iconButton('导入文件', 'import', {}, false, <FileUp className="h-4 w-4" />)}
            {iconButton('粘贴图片', 'pasteImage', {}, false, <ImagePlus className="h-4 w-4" />)}
          </div>

          <aside
            className={`wb-inspector absolute right-3 top-3 z-20 flex h-[min(620px,calc(100%-96px))] flex-col overflow-hidden rounded-xl transition-[width] duration-200 ${inspectorCollapsed ? 'wb-inspector-collapsed' : ''}`}
            aria-label="画板侧栏"
          >
            <div className="wb-inspector-tabs flex shrink-0 items-center gap-1 p-1.5" role="tablist" aria-label="侧栏分页">
              {!inspectorCollapsed && (
                <>
                  <DesktopButton
                    size="xs"
                    variant={inspectorTab === 'layers' ? 'primary' : 'ghost'}
                    icon={<Layers3 className="h-4 w-4" />}
                    className="wb-tab-button"
                    role="tab"
                    aria-selected={inspectorTab === 'layers'}
                    title="图层"
                    onClick={() => setInspectorTab('layers')}
                  >图层</DesktopButton>
                  <DesktopButton
                    size="xs"
                    variant={inspectorTab === 'properties' ? 'primary' : 'ghost'}
                    icon={<SlidersHorizontal className="h-4 w-4" />}
                    className="wb-tab-button"
                    role="tab"
                    aria-selected={inspectorTab === 'properties'}
                    title="属性"
                    onClick={() => setInspectorTab('properties')}
                  >属性</DesktopButton>
                </>
              )}
              <DesktopButton
                size="xs"
                variant="ghost"
                icon={inspectorCollapsed ? <ChevronLeft className="h-4 w-4" /> : <ChevronRight className="h-4 w-4" />}
                className={`wb-collapse-button${inspectorCollapsed ? '' : ' ml-auto'}`}
                title={inspectorCollapsed ? '展开侧栏' : '折叠侧栏'}
                aria-label={inspectorCollapsed ? '展开侧栏' : '折叠侧栏'}
                aria-expanded={!inspectorCollapsed}
                onClick={() => setInspectorCollapsed((value) => !value)}
              />
            </div>

            {!inspectorCollapsed && (
              <div className="wb-inspector-content min-h-0 min-w-0 flex-1 overflow-y-auto p-3">
                {inspectorTab === 'layers' && (
                  <section role="tabpanel" aria-label="图层">
                    <div className="wb-inspector-heading flex items-center justify-between">
                      <span>图层（{state.scene.nodes.length}）</span>
                      <span className="wb-muted">点击选择，Shift 多选</span>
                    </div>
                    <div className="mt-2">
                      {layerRows.map((row) =>
                        row.kind === 'group' ? (
                          <div key={row.gid} className="wb-layer-row" style={{ paddingLeft: 4 + row.depth * 14 }}
                            role="button" tabIndex={0} aria-label="选择组合"
                            onClick={() => execute('groupEdit', { id: row.gid, select: true })}
                            onDoubleClick={() => execute('groupEdit', { id: row.gid, open: true, select: true })}
                            onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); execute('groupEdit', { id: row.gid, select: true }) } }}>
                            <button
                              type="button"
                              className="wb-layer-chevron"
                              title={groupOpen(row.gid) ? '收起组合' : '展开组合'}
                              aria-label={groupOpen(row.gid) ? '收起组合' : '展开组合'}
                              aria-expanded={groupOpen(row.gid)}
                              onClick={event => { event.stopPropagation(); setExpandedRows((map) => ({ ...map, [row.gid]: !groupOpen(row.gid) })) }}
                            >
                              {groupOpen(row.gid) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                            </button>
                            <Group className="wb-layer-type h-3.5 w-3.5" />
                            <span className="min-w-0 flex-1 truncate text-left">组合（{row.count}）</span>
                          </div>
                        ) : (
                          <div
                            key={row.node.id}
                            className={`wb-layer-row${state.selection.includes(row.node.id) ? ' wb-layer-active' : ''}`}
                            style={{ paddingLeft: 4 + row.depth * 14 }}
                            role="button"
                            tabIndex={0}
                            title={row.node.name}
                            onClick={(event) =>
                              execute('deepSelect', { ids: event.shiftKey ? [...state.selection, row.node.id] : [row.node.id] })
                            }
                            onKeyDown={(event) => {
                              if (event.key === 'Enter' || event.key === ' ') board.select([row.node.id])
                            }}
                          >
                            {row.expandable ? (
                              <button
                                type="button"
                                className="wb-layer-chevron"
                                title={frameOpen(row.node.id) ? '收起分区内容' : '展开分区内容'}
                                aria-label={frameOpen(row.node.id) ? '收起分区内容' : '展开分区内容'}
                                aria-expanded={frameOpen(row.node.id)}
                                onClick={(event) => {
                                  event.stopPropagation()
                                  setExpandedRows((map) => ({ ...map, [row.node.id]: !frameOpen(row.node.id) }))
                                }}
                              >
                                {frameOpen(row.node.id) ? <ChevronDown className="h-3.5 w-3.5" /> : <ChevronRight className="h-3.5 w-3.5" />}
                              </button>
                            ) : (
                              <span className="wb-layer-chevron" />
                            )}
                            {thumbCacheRef.current.get(row.node.id)?.url ? (
                              <img className="wb-layer-thumb" src={thumbCacheRef.current.get(row.node.id)!.url} alt="" />
                            ) : row.node.type === 'frame' ? (
                              <Frame className="wb-layer-type h-3.5 w-3.5" />
                            ) : (
                              <span className="wb-layer-dot" />
                            )}
                            <span className="min-w-0 flex-1 truncate text-left">{row.node.name}</span>
                            <span className="wb-layer-actions">
                              {rowAction(row.node, '置顶', 'order', { direction: 'top' }, <BringToFront className="h-3.5 w-3.5" />)}
                              {rowAction(row.node, '置底', 'order', { direction: 'bottom' }, <SendToBack className="h-3.5 w-3.5" />)}
                              {rowAction(
                                row.node,
                                row.node.locked ? '解锁' : '锁定',
                                'lock',
                                { value: !row.node.locked },
                                row.node.locked ? <LockOpen className="h-3.5 w-3.5" /> : <Lock className="h-3.5 w-3.5" />
                              )}
                              {rowAction(row.node, '删除', 'delete', {}, <Trash2 className="h-3.5 w-3.5" />)}
                            </span>
                          </div>
                        )
                      )}
                      {!layerRows.length && <p className="wb-muted px-1 py-2">画布为空，用左侧工具添加元素。</p>}
                    </div>
                  </section>
                )}

                {inspectorTab === 'properties' && (
                  <section role="tabpanel" aria-label="属性" className="space-y-3">
                    <div className="wb-inspector-heading">已选 {selection.length} 项</div>
                    {selected ? (
                      <>
                        <label className="wb-field">
                          名称
                          <DesktopInput key={`${selected.id}-name`} defaultValue={selected.name} onBlur={(e) => execute('update', { patch: { name: e.target.value } })} />
                        </label>
                        <label className="wb-field">
                          标签（逗号分隔）
                          <DesktopInput
                            key={`${selected.id}-tags`}
                            defaultValue={selected.tags.join(',')}
                            onBlur={(e) => execute('update', { patch: { tags: e.target.value.split(',').map((tag) => tag.trim()).filter(Boolean) } })}
                          />
                        </label>
                        <p className="wb-muted">复制、排列等对象操作请使用底部工具栏。</p>
                        {board.getInspectors().map(([id, Component]) => <Component key={`${id}-${selected.id}`} node={selected} />)}
                      </>
                    ) : (
                      <p className="wb-muted">选择画布中的对象，查看和编辑属性。</p>
                    )}
                  </section>
                )}
              </div>
            )}
          </aside>

          <div className="wb-bottom-toolbar absolute bottom-3 left-1/2 z-20 flex max-w-[calc(100%-40px)] -translate-x-1/2 flex-wrap items-center justify-center gap-1 rounded-xl p-1.5" role="toolbar" aria-label="对象操作">
            {!selected ? (
              <span className="wb-muted px-2">选择画布对象后在此操作</span>
            ) : (
              <>
                {selection.length === 1 && (selected.type === 'text' || selected.type === 'note') && iconButton('富文本编辑', 'richText', {}, selected.locked, <Type className="h-4 w-4" />)}
                {iconButton('复制', 'copy', {}, false, <Copy className="h-4 w-4" />)}
                {iconButton('粘贴', 'paste', {}, false, <ClipboardPaste className="h-4 w-4" />)}
                {iconButton('副本', 'duplicate', {}, false, <CopyPlus className="h-4 w-4" />)}
                {iconButton('删除', 'delete', {}, false, <Trash2 className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('旋转90°', 'rotate', {}, false, <RotateCw className="h-4 w-4" />)}
                {iconButton('水平翻转', 'flip', { axis: 'x' }, false, <FlipHorizontal2 className="h-4 w-4" />)}
                {iconButton('垂直翻转', 'flip', { axis: 'y' }, false, <FlipVertical2 className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('组合', 'group', {}, false, <Group className="h-4 w-4" />)}
                {iconButton('取消组合', 'ungroup', {}, false, <Ungroup className="h-4 w-4" />)}
                {iconButton(selected.locked ? '解锁' : '锁定', 'lock', { value: !selected.locked }, false, selected.locked ? <LockOpen className="h-4 w-4" /> : <Lock className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('置顶', 'order', { direction: 'top' }, false, <BringToFront className="h-4 w-4" />)}
                {iconButton('置底', 'order', { direction: 'bottom' }, false, <SendToBack className="h-4 w-4" />)}
                {iconButton(selected.collapsed ? '展开' : '折叠', 'collapse', {}, false, selected.collapsed ? <ChevronsUpDown className="h-4 w-4" /> : <ChevronsDownUp className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('横排', 'arrange', { mode: 'horizontal' }, false, <MoveHorizontal className="h-4 w-4" />)}
                {iconButton('竖排', 'arrange', { mode: 'vertical' }, false, <MoveVertical className="h-4 w-4" />)}
                {iconButton('网格排列', 'arrange', { mode: 'grid' }, false, <LayoutGrid className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('水平等距', 'distribute', { axis: 'x' }, false, <AlignHorizontalDistributeCenter className="h-4 w-4" />)}
                {iconButton('垂直等距', 'distribute', { axis: 'y' }, false, <AlignVerticalDistributeCenter className="h-4 w-4" />)}
                <span className="wb-toolbar-divider" />
                {iconButton('收进新分区', 'frameSelection', {}, false, <Frame className="h-4 w-4" />)}
                {iconButton('移出分区', 'detachFrame', {}, false, <SquareDashed className="h-4 w-4" />)}
                {selected.type === 'image' && (
                  <DesktopButton
                    size="xs"
                    variant="ghost"
                    active={state.cropEditing === selected.id}
                    icon={<Crop className="h-4 w-4" />}
                    className="wb-icon-button"
                    title={state.cropEditing === selected.id ? '退出裁剪' : '图片裁剪'}
                    aria-label={state.cropEditing === selected.id ? '退出裁剪' : '图片裁剪'}
                    onClick={() => execute('cropOpen')}
                  />
                )}
              </>
            )}
          </div>

          <div className="wb-canvas-hint absolute bottom-3 left-3 z-10" aria-label="画布快捷操作">
            空格 / 中键拖动 · 滚轮平移 · Ctrl+滚轮缩放 · Shift 多选 · 双击文字进入编辑 · 双击图片进入裁剪
          </div>
        </div>
      </div>
    </ThemeFloatingPanel>
  )
}
