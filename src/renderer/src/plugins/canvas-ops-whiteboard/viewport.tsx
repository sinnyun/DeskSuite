import { useCallback, useEffect, useRef, useState } from 'react'
import type { CSSProperties, ReactElement } from 'react'
import DOMPurify from 'dompurify'
import { Matrix } from 'leafer-ui'
import { getService, useUiKit } from '../../workbench/sdk'
import type { BoardNode, CanvasService, Snapshot } from './contract'
import { BoardEngine } from './engine'
import { dropPoint, dropSources } from './drop'

interface ResourceService {
  resolve(ref: string): Promise<{ url: string; available: boolean }>
}
function nativeNodeTransform(node: BoardNode): string {
  const { a, b, c, d } = new Matrix().setLayout({ x: 0, y: 0, rotation: node.rotation, scaleX: node.scaleX, scaleY: node.scaleY, skewX: node.skewX ?? 0, skewY: node.skewY ?? 0 })
  return `matrix(${a},${b},${c},${d},0,0)`
}
export function BoardViewport({ board, state }: { board: CanvasService; state: Snapshot }): ReactElement {
  const [size, setSize] = useState({ width: 600, height: 400 })
  const [draggingFiles, setDraggingFiles] = useState(false)
  const dragDepth = useRef(0)
  const root = useRef<HTMLDivElement>(null),
    mount = useRef<HTMLDivElement>(null)
  const latest = useRef(state)
  latest.current = state
  useEffect(() => {
    const reset = (): void => { dragDepth.current = 0; setDraggingFiles(false) }
    window.addEventListener('dragend', reset)
    window.addEventListener('blur', reset)
    reset()
    return () => { window.removeEventListener('dragend', reset); window.removeEventListener('blur', reset) }
  }, [state.id])
  const players = useRef(new Map<string, HTMLVideoElement>())
  useEffect(() => {
    const el = root.current
    if (!el) return
    const observer = new ResizeObserver(() => setSize(previous =>
      previous.width === el.clientWidth && previous.height === el.clientHeight
        ? previous : { width: el.clientWidth, height: el.clientHeight }))
    observer.observe(el)
    return () => observer.disconnect()
  }, [])
  useEffect(() => {
    if (!mount.current) return
    const engine = new BoardEngine(mount.current, board, root.current ?? mount.current)
    return () => engine.destroy()
  }, [board, state.id])
  useEffect(() => board.register('dropImport', async (args) => {
    const el = root.current
    if (!el) throw new Error('画板尚未就绪')
    const sources = dropSources(args)
    const snapshot = board.getSnapshot()
    const point = dropPoint(args, el.getBoundingClientRect(), snapshot.scene.view)
    if (snapshot.cropEditing) await board.command('cropClose')
    if (board.getSnapshot().id !== snapshot.id) throw new Error('画板已切换，已取消本次拖入')
    return board.command('import', { ...sources, ...point })
  }), [board])
  useEffect(() => {
    const el = root.current
    if (!el) return
    const keydown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement
      if (target.closest('input,textarea,select,[contenteditable="true"]') || !target.closest('.leafer-board')) return
      if (latest.current.cropEditing) {
        if (e.key === 'Escape') {
          e.preventDefault()
          void board.command('cropClose').catch((error) => board.report(error))
        }
        return
      }
      const ctrl = e.ctrlKey || e.metaKey
      const commands: Record<string, string> = { Delete: 'delete', Backspace: 'delete', Escape: 'escape' }
      let command = ctrl
        ? { z: e.shiftKey ? 'redo' : 'undo', y: 'redo', c: 'copy', v: 'paste', d: 'duplicate', a: 'selectAll' }[
            e.key.toLowerCase()
          ]
        : commands[e.key]
      if (command) {
        e.preventDefault()
        if (command === 'escape') {
          board.select([])
          board.setInteraction(false)
        } else if (command === 'selectAll') board.select(board.getSnapshot().scene.nodes.map((n) => n.id))
        else void board.command(command).catch((error) => board.report(error))
      }
    }
    window.addEventListener('keydown', keydown)
    return () => {
      window.removeEventListener('keydown', keydown)
    }
  }, [board])
  useEffect(
    () =>
      board.register('media', async (args) => {
        const id = String(args.id ?? board.getSnapshot().selection[0] ?? '')
        let player = players.current.get(id)
        const deadline = Date.now() + 6000
        while ((!player || player.readyState < 1) && Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 30))
          player = players.current.get(id)
        }
        if (!player) throw new Error('视频未展开或尚未载入')
        if (args.action === 'play') await player.play()
        if (args.action === 'pause') player.pause()
        if (args.action === 'seek') {
          const time = Number(args.time)
          if (!Number.isFinite(time) || time < 0 || time > player.duration) throw new Error('播放时间无效')
          player.currentTime = time
        }
        if (args.action === 'volume') {
          const value = Number(args.value)
          if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('音量无效')
          player.volume = value
        }
        return {
          readyState: player.readyState,
          duration: player.duration,
          currentTime: player.currentTime,
          paused: player.paused,
          volume: player.volume,
          error: player.error?.code ?? null
        }
      }),
    [board]
  )
  const view = state.scene.view
  const style: CSSProperties = {
    backgroundColor: 'var(--wb-canvas-bg)',
    backgroundPosition: `${view.x}px ${view.y}px`,
    backgroundSize: `${20 * view.zoom}px ${20 * view.zoom}px`,
    backgroundImage:
      state.scene.background === 'dots'
        ? 'radial-gradient(var(--wb-grid-dot) 1px, transparent 1px)'
        : state.scene.background === 'grid'
          ? 'linear-gradient(to right,var(--wb-grid-line) 1px,transparent 1px),linear-gradient(to bottom,var(--wb-grid-line) 1px,transparent 1px)'
          : 'none'
  }
  return (
    <div
      ref={root}
      tabIndex={0}
      className="absolute inset-0 min-h-0 min-w-0 overflow-hidden outline-none"
      style={style}
      data-whiteboard-canvas
      data-context-zone="canvas.board"
      data-whiteboard-id={state.id}
      onDoubleClick={() => {
        const snapshot = board.getSnapshot()
        if (snapshot.cropEditing) return
        const [id] = snapshot.selection
        const node = snapshot.scene.nodes.find((n) => n.id === id)
        // Leafer's own double-tap opens the crop inner editor for images.
        if (snapshot.selection.length === 1 && node?.type === 'image' && !node.locked) return
        void board.command('activateSelection').catch(error => board.report(error))
      }}
      onDragOver={(e) => {
        if (
          e.dataTransfer.types.includes('Files') ||
          e.dataTransfer.types.includes('application/x-desksuite-files') ||
          e.dataTransfer.types.includes('text/uri-list')
        ) {
          e.preventDefault()
          e.stopPropagation()
          e.dataTransfer.dropEffect = 'copy'
        }
      }}
      onDragEnter={(e) => {
        if (!['Files', 'application/x-desksuite-files', 'text/uri-list'].some(type => e.dataTransfer.types.includes(type))) return
        e.preventDefault()
        dragDepth.current++
        setDraggingFiles(true)
      }}
      onDragLeave={() => {
        dragDepth.current = Math.max(0, dragDepth.current - 1)
        if (!dragDepth.current) setDraggingFiles(false)
      }}
      onDrop={(e) => {
        e.preventDefault()
        e.stopPropagation()
        dragDepth.current = 0
        setDraggingFiles(false)
        // Read the transfer synchronously: browser access expires after this event.
        void board.command('dropImport', {
          payload: e.dataTransfer.getData('application/x-desksuite-files'),
          files: [...e.dataTransfer.files],
          uriList: e.dataTransfer.getData('text/uri-list'),
          clientX: e.clientX, clientY: e.clientY
        }).catch(error => board.report(error))
      }}
      onPaste={(e) => {
        if ((e.target as HTMLElement).closest('[contenteditable="true"]')) return
        if ([...e.clipboardData.items].some((item) => item.type.startsWith('image/'))) {
          e.preventDefault()
          void board.command('pasteImage').catch((error) => board.report(error))
        }
      }}
    >
      <div ref={mount} className="absolute inset-0" style={{ position: 'absolute', inset: 0 }} data-whiteboard-mount onPointerDown={() => root.current?.focus({ preventScroll: true })} />
      {draggingFiles && <div className="pointer-events-none absolute inset-2 z-30 flex items-center justify-center rounded-xl border-2 border-dashed border-[var(--ds-accent)] bg-[var(--ds-accent)]/10" data-whiteboard-drop-hint>
        <div className="rounded-xl bg-white px-5 py-3 text-sm text-slate-700 shadow-lg dark:bg-slate-900 dark:text-slate-200">松开以链接导入图片或文件 · 保留原文件</div>
      </div>}
      <div
        className="pointer-events-none absolute left-0 top-0"
        style={{ transform: `translate(${view.x}px,${view.y}px) scale(${view.zoom})`, transformOrigin: '0 0' }}
      >
        {state.scene.nodes
          .filter(
            (n) =>
              !n.collapsed &&
              (board.getContent(n.resourceKind ?? n.type) ||
                n.type === 'video' ||
                ((n.type === 'text' || n.type === 'note') && !!n.html && state.interaction && state.selection.includes(n.id)))
          )
          .map((n) => (
            <div
              key={state.id + n.id}
              data-canvas-content={n.id}
              style={{
                position: 'absolute',
                left: n.x,
                top: n.y,
                width: n.width,
                height: n.height,
                transform: nativeNodeTransform(n),
                transformOrigin: '0 0',
                pointerEvents: state.interaction && !n.locked ? 'auto' : 'none'
              }}
            >
              {board.getContent(n.resourceKind ?? n.type) ? (
                <ExtensionContent board={board} node={n} interactive={state.interaction && !n.locked} />
              ) : n.type === 'video' ? (
                <VideoCard
                  node={n}
                  board={board}
                  interactive={state.interaction && !n.locked}
                  players={players.current}
                />
              ) : (
                <RichText node={n} board={board} interactive={state.interaction && !n.locked} />
              )}
            </div>
          ))}
      </div>
      {state.scene.rulers && <Rulers board={board} state={state} root={root.current} />}
      <Minimap state={state} board={board} size={size} />
    </div>
  )
}
function ExtensionContent({
  board,
  node,
  interactive
}: {
  board: CanvasService
  node: BoardNode
  interactive: boolean
}): ReactElement | null {
  const Component = board.getContent(node.resourceKind ?? node.type)
  return Component ? <Component node={node} interactive={interactive} /> : null
}
function VideoCard({
  node,
  board,
  interactive,
  players
}: {
  node: BoardNode
  board: CanvasService
  interactive: boolean
  players: Map<string, HTMLVideoElement>
}): ReactElement {
  const [url, setUrl] = useState(''),
    [error, setError] = useState('')
  const playerRef = useRef<HTMLVideoElement | null>(null)
  const attachPlayer = useCallback(
    (el: HTMLVideoElement | null): void => {
      if (el) {
        players.set(node.id, el)
        playerRef.current = el
      } else {
        playerRef.current?.pause()
        playerRef.current = null
        players.delete(node.id)
      }
    },
    [node.id, players]
  )
  useEffect(() => {
    let frame = 0,
      disposed = false
    const paint = (): void => {
      cancelAnimationFrame(frame)
      const video = playerRef.current
      if (disposed || !video) return
      void board.command('videoFrame', { id: node.id, video }).catch(() => {})
      if (!video.paused) frame = requestAnimationFrame(paint)
    }
    const video = playerRef.current
    if (video) for (const event of ['loadeddata', 'seeked', 'play', 'pause']) video.addEventListener(event, paint)
    paint()
    const unsubscribe = board.subscribe(() => {
      if (playerRef.current?.paused) paint()
    })
    return () => {
      disposed = true
      cancelAnimationFrame(frame)
      unsubscribe()
      if (video) for (const event of ['loadeddata', 'seeked', 'play', 'pause']) video.removeEventListener(event, paint)
    }
  }, [url, node.id, board])
  useEffect(() => {
    let disposed = false
    const resources = getService<ResourceService>('resources')
    if (!resources || !node.resource) {
      setError('资源服务未启用')
      return
    }
    void resources
      .resolve(node.resource)
      .then((info) => {
        if (!disposed) {
          if (info.available) setUrl(info.url)
          else setError('原视频不可用')
        }
      })
      .catch((e) => {
        if (!disposed) setError(String(e))
      })
    return () => {
      disposed = true
      players.get(node.id)?.pause()
      players.delete(node.id)
    }
  }, [node.id, node.resource, players])
  return (
    <div
      className="h-full overflow-hidden rounded-lg bg-slate-900 text-white"
      style={{ opacity: interactive || error ? 1 : 0 }}
    >
      <div className="truncate px-2 py-1 text-xs">{node.name}</div>
      {url ? (
        <video
          ref={attachPlayer}
          crossOrigin="anonymous"
          src={url}
          controls
          preload="auto"
          style={{ width: '100%', height: 'calc(100% - 26px)', objectFit: 'contain' }}
          onError={() => setError('视频无法解码')}
        />
      ) : null}
      {error && <div className="p-3 text-xs text-amber-300">{error}</div>}
    </div>
  )
}
const sanitize = (html: string): string =>
  DOMPurify.sanitize(html, {
    ALLOWED_TAGS: ['p', 'br', 'div', 'span', 'b', 'strong', 'i', 'em', 'u', 's', 'ul', 'ol', 'li', 'font'],
    ALLOWED_ATTR: ['style', 'color', 'face', 'size']
  })
function RichText({
  node,
  board,
  interactive
}: {
  node: BoardNode
  board: CanvasService
  interactive: boolean
}): ReactElement {
  const ref = useRef<HTMLDivElement>(null)
  const focused = useRef(false)
  const { DesktopButton } = useUiKit()
  useEffect(() => {
    if (ref.current && !focused.current) {
      if (node.html) ref.current.innerHTML = sanitize(node.html)
      else ref.current.textContent = node.text ?? ''
    }
  }, [node.html, node.text])
  const save = (): void => {
    const el = ref.current
    if (!el) return
    const html = sanitize(el.innerHTML),
      text = el.innerText
    board.edit((scene) => {
      const n = scene.nodes.find((n) => n.id === node.id)
      if (n && !n.locked) {
        n.html = html
        n.text = text
      }
    })
  }
  return (
    <div
      className="relative h-full"
      style={{ background: node.type === 'note' ? node.fill : '#f8fafc', color: '#1e293b' }}
    >
      {interactive && (
        <div
          className="absolute -top-8 left-0 z-10 flex h-8 items-center rounded bg-white shadow"
          onPointerDown={(e) => e.preventDefault()}
        >
          {(
            [
              ['粗', 'bold'],
              ['斜', 'italic'],
              ['下划线', 'underline'],
              ['• 列表', 'insertUnorderedList'],
              ['1. 列表', 'insertOrderedList']
            ] as const
          ).map(([label, cmd]) => (
            <DesktopButton
              key={cmd}
              size="xs"
              onClick={() => {
                ref.current?.focus()
                document.execCommand(cmd)
                save()
              }}
            >
              {label}
            </DesktopButton>
          ))}
          <input
            aria-label="文字颜色"
            type="color"
            defaultValue="#1e293b"
            onChange={(e) => {
              ref.current?.focus()
              document.execCommand('foreColor', false, e.target.value)
              save()
            }}
          />
        </div>
      )}
      <div
        ref={ref}
        className="canvas-richtext h-full overflow-auto p-3 text-lg outline-none"
        contentEditable={interactive}
        suppressContentEditableWarning
        onFocus={() => {
          focused.current = true
        }}
        onBlur={() => {
          focused.current = false
          save()
        }}
        onInput={() => {
          save()
        }}
      />
    </div>
  )
}
function Rulers({
  board,
  state,
  root
}: {
  board: CanvasService
  state: Snapshot
  root: HTMLDivElement | null
}): ReactElement {
  const v = state.scene.view
  const dragging = useRef<{ id: string; axis: 'x' | 'y' } | null>(null)
  const [preview, setPreview] = useState<{ id: string; axis: 'x' | 'y'; value: number } | null>(null)
  const start =
    (axis: 'x' | 'y', id?: string) =>
    (e: React.PointerEvent<HTMLElement>): void => {
      e.stopPropagation()
      e.preventDefault()
      dragging.current = { axis, id: id ?? crypto.randomUUID() }
      e.currentTarget.setPointerCapture(e.pointerId)
    }
  const move = (e: React.PointerEvent<HTMLElement>): void => {
    const d = dragging.current,
      box = root?.getBoundingClientRect()
    if (!d || !box) return
    const value = d.axis === 'x' ? (e.clientX - box.left - v.x) / v.zoom : (e.clientY - box.top - v.y) / v.zoom
    setPreview({ ...d, value })
  }
  const end = (e: React.PointerEvent<HTMLElement>): void => {
    if (dragging.current) {
      const d = dragging.current,
        box = root?.getBoundingClientRect()
      if (box) {
        const value = d.axis === 'x' ? (e.clientX - box.left - v.x) / v.zoom : (e.clientY - box.top - v.y) / v.zoom
        void board.command('guide', { ...d, value }).catch((err) => board.report(err))
      }
      dragging.current = null
      setPreview(null)
      e.currentTarget.releasePointerCapture(e.pointerId)
    }
  }
  return (
    <>
      <div
        className="absolute left-5 right-0 top-0 h-5 cursor-crosshair overflow-hidden bg-white/90 dark:bg-[var(--ds-surface-raised)]/90"
        style={{ background: 'transparent' }}
        title="拖出水平参考线"
        onPointerDown={start('y')}
        onPointerMove={move}
        onPointerUp={end}
      />
      <div
        className="absolute bottom-0 left-0 top-5 w-5 cursor-crosshair overflow-hidden bg-white/90 dark:bg-[var(--ds-surface-raised)]/90"
        style={{ background: 'transparent' }}
        title="拖出垂直参考线"
        onPointerDown={start('x')}
        onPointerMove={move}
        onPointerUp={end}
      />
      {(preview ? [...state.scene.guides.filter((g) => g.id !== preview.id), preview] : state.scene.guides).map((g) => (
        <div
          key={g.id}
          title="拖动调整；双击删除参考线"
          className={`absolute z-10 ${g.axis === 'x' ? 'bottom-0 top-5 w-1 cursor-ew-resize border-l' : 'left-5 right-0 h-1 cursor-ns-resize border-t'} border-cyan-500`}
          style={g.axis === 'x' ? { left: v.x + g.value * v.zoom } : { top: v.y + g.value * v.zoom }}
          onPointerDown={start(g.axis, g.id)}
          onPointerMove={move}
          onPointerUp={end}
          onDoubleClick={() => {
            void board.command('guide', { id: g.id, remove: true })
          }}
        />
      ))}
    </>
  )
}
function Minimap({
  state,
  board,
  size
}: {
  state: Snapshot
  board: CanvasService
  size: { width: number; height: number }
}): ReactElement | null {
  const nodes = state.scene.nodes
  if (!nodes.length) return null
  const minX = Math.min(0, ...nodes.map((n) => n.x)),
    minY = Math.min(0, ...nodes.map((n) => n.y)),
    maxX = Math.max(800, ...nodes.map((n) => n.x + n.width)),
    maxY = Math.max(500, ...nodes.map((n) => n.y + n.height))
  const w = maxX - minX + 100,
    h = maxY - minY + 100
  return (
    <svg
      aria-label="画板小地图"
      className="absolute bottom-3 right-3 h-24 w-40 cursor-crosshair rounded border border-slate-300 bg-white/90 shadow dark:border-slate-700 dark:bg-[var(--ds-surface-raised)]/90"
      viewBox={`${minX - 50} ${minY - 50} ${w} ${h}`}
      preserveAspectRatio="none"
      onPointerDown={(e) => {
        const box = e.currentTarget.getBoundingClientRect()
        const x = minX - 50 + ((e.clientX - box.left) / box.width) * w,
          y = minY - 50 + ((e.clientY - box.top) / box.height) * h
        board.setView({
          ...state.scene.view,
          x: size.width / 2 - x * state.scene.view.zoom,
          y: size.height / 2 - y * state.scene.view.zoom
        })
      }}
    >
      {nodes.map((n) => (
        <rect
          key={n.id}
          x={n.x}
          y={n.y}
          width={n.width}
          height={n.height}
          fill={state.selection.includes(n.id) ? '#6366f1' : n.type === 'image' ? '#14b8a6' : n.fill}
          stroke="#94a3b8"
          strokeWidth={3}
        />
      ))}
      <rect
        x={-state.scene.view.x / state.scene.view.zoom}
        y={-state.scene.view.y / state.scene.view.zoom}
        width={size.width / state.scene.view.zoom}
        height={size.height / state.scene.view.zoom}
        fill="none"
        stroke="#6366f1"
        strokeWidth={5}
      />
    </svg>
  )
}
