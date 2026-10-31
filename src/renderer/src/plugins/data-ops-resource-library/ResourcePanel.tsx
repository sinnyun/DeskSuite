import { useCallback, useEffect, useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { FolderOpen, Link2, RefreshCw, Trash2 } from 'lucide-react'
import { call, errorText, getService, useLayoutShallow, useUiKit } from '../../workbench/sdk'

// Public service contract is structural: no imports from the providing plugin.
interface ResourceInfo {
  id: string; name: string; path: string; kind: string; mimeType: string; uri: string; url: string
  available: boolean; size: number | null; revision: string | null
}
interface ImageLease { leaseId: string; url: string; width: number; height: number }
interface ResourceClient {
  list(): Promise<ResourceInfo[]>; choose(): Promise<ResourceInfo[]>; resolve(reference: string): Promise<ResourceInfo>
  register(path: string): Promise<ResourceInfo>; forget(reference: string): Promise<boolean>
  readText(reference: string): Promise<{ text: string }>
  acquireImage(reference: string): Promise<ImageLease>; releaseImage(leaseId: string): Promise<void>
  getImageCacheState(): { entries: number; leases: number }
}
interface Action {
  requestId: string; action: string; reference?: string; time?: number
  url?: string; range?: string; method?: string; etag?: string; ifRange?: string
}

export function ResourceActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeFloatingPanel, toggleFloatingPanel } = useLayoutShallow((state) => ({ activeFloatingPanel: state.activeFloatingPanel, toggleFloatingPanel: state.toggleFloatingPanel }))
  return <ActivityButton icon={<Link2 className="h-4 w-4" />} label="资源" active={activeFloatingPanel === 'resources'} onClick={() => toggleFloatingPanel('resources')} />
}

export function ResourcePanel(): ReactElement | null {
  const client = getService<ResourceClient>('resources')
  const { ThemeFloatingPanel, DesktopButton, DesktopInput, DesktopCardButton } = useUiKit()
  const { activeFloatingPanel, floatingPanelOpen, openFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ activeFloatingPanel: state.activeFloatingPanel, floatingPanelOpen: state.floatingPanelOpen, openFloatingPanel: state.openFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'resources'
  const [items, setItems] = useState<ResourceInfo[]>([])
  const [selected, setSelected] = useState<ResourceInfo | null>(null)
  const [path, setPath] = useState('')
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const current = useRef<ResourceInfo | null>(null)
  const media = useRef<HTMLVideoElement | HTMLAudioElement | null>(null)
  const imageState = useRef<{ ready: boolean; width?: number; height?: number; error?: string }>({ ready: false })
  const generation = useRef(0)

  const refresh = useCallback(async (): Promise<void> => { if (client) setItems(await client.list()) }, [client])
  const preview = useCallback(async (reference: string): Promise<ResourceInfo> => {
    if (!client) throw new Error('统一资源服务未启用')
    const version = ++generation.current
    const resource = await client.resolve(reference)
    if (version !== generation.current) return resource
    current.current = resource
    imageState.current = { ready: false }
    media.current = null
    setSelected(resource)
    setText('')
    setError('')
    openFloatingPanel('resources')
    if (resource.available && ['text', 'markdown'].includes(resource.kind)) {
      try {
        const value = await client.readText(resource.url)
        if (version === generation.current) setText(value.text)
      } catch (cause) { if (version === generation.current) setError(errorText(cause, '资源文本预览失败')) }
    }
    return resource
  }, [client, openFloatingPanel])

  const run = (task: Promise<unknown>): void => { void task.catch((cause) => setError(errorText(cause, '资源操作失败'))) }
  useEffect(() => { if (isOpen) void refresh().catch((cause) => setError(errorText(cause, '资源列表读取失败'))) }, [isOpen, refresh])
  useEffect(() => {
    if (!isOpen) media.current?.pause()
  }, [isOpen])

  useEffect(() => window.bridge.onEvent((channel, payload) => {
    if (channel === 'resources:changed') { void refresh().catch((cause) => setError(errorText(cause, '资源列表刷新失败'))); return }
    if (channel !== 'resources:action') return
    const args = payload as Action
    void (async () => {
      try {
        if (!client) throw new Error('统一资源服务未启用')
        let value: unknown = true
        if (args.action === 'open') { openFloatingPanel('resources'); await refresh() }
        if (args.action === 'preview') {
          if (!args.reference) throw new Error('缺少资源引用')
          value = await preview(args.reference)
        }
        if (args.action === 'inspect') value = {
          resource: current.current,
          image: imageState.current,
          cache: client.getImageCacheState(),
          media: media.current ? {
            readyState: media.current.readyState, duration: Number.isFinite(media.current.duration) ? media.current.duration : null,
            currentTime: media.current.currentTime, paused: media.current.paused, error: media.current.error?.code ?? null
          } : null
        }
        if (['play', 'pause', 'seek'].includes(args.action)) {
          const player = media.current
          if (!player) throw new Error('请先预览音视频资源')
          if (args.action === 'play') await player.play()
          if (args.action === 'pause') player.pause()
          if (args.action === 'seek') {
            if (!Number.isFinite(args.time) || args.time! < 0 || args.time! > player.duration) throw new Error('播放时间超出范围')
            player.currentTime = args.time!
          }
        }
        if (args.action === 'leafer') {
          if (!args.reference) throw new Error('缺少资源引用')
          const lease = await client.acquireImage(args.reference)
          try { value = { width: lease.width, height: lease.height, url: lease.url, cache: client.getImageCacheState() } }
          finally { await client.releaseImage(lease.leaseId) }
        }
        if (args.action === 'fetch') {
          const url = args.url ?? (args.reference ? (await client.resolve(args.reference)).url : '')
          if (new URL(url).protocol !== 'desksuite-resource:') throw new Error('只能读取统一资源链接')
          const headers: Record<string, string> = {}
          if (args.range) headers.Range = args.range
          if (args.etag) headers['If-None-Match'] = args.etag
          if (args.ifRange) headers['If-Range'] = args.ifRange
          const response = await fetch(url, { method: args.method ?? 'GET', headers })
          const reader = response.body?.getReader()
          const parts: Uint8Array[] = []
          let size = 0
          let truncated = false
          try {
            while (reader) {
              const part = await reader.read()
              if (part.done) break
              const remaining = 1024 * 1024 - size
              parts.push(part.value.subarray(0, remaining))
              size += Math.min(remaining, part.value.length)
              if (part.value.length > remaining || size === 1024 * 1024) { truncated = true; await reader.cancel(); break }
            }
          } finally { reader?.releaseLock() }
          let binary = ''
          for (const part of parts) for (let i = 0; i < part.length; i += 8192) binary += String.fromCharCode(...part.subarray(i, i + 8192))
          value = { status: response.status, headers: Object.fromEntries(response.headers.entries()), base64: btoa(binary), truncated }
        }
        await call('resources', 'complete', args.requestId, { value })
      } catch (cause) {
        await call('resources', 'complete', args.requestId, { error: errorText(cause, '资源操作失败') })
      }
    })()
  }), [client, openFloatingPanel, preview, refresh])

  if (!isOpen) return null
  return <ThemeFloatingPanel title="统一资源" badge={`${items.length} 项`} icon={<Link2 className="h-3.5 w-3.5" />} isOpen onClose={closeFloatingPanel} initialX={110} initialY={70} initialWidth={920} initialHeight={620} minWidth={720} minHeight={520}>
    <div className="flex h-full min-h-0 flex-col gap-3" data-resource-panel>
      <div className="flex shrink-0 gap-2">
        <DesktopInput aria-label="本地资源路径" value={path} onChange={(event) => setPath(event.target.value)} placeholder="本地文件的绝对路径" className="min-w-0 flex-1" />
        <DesktopButton size="sm" disabled={!client || !path.trim()} onClick={() => client && run(client.register(path.trim()).then((resource) => preview(resource.uri)))}>登记链接</DesktopButton>
        <DesktopButton size="sm" icon={<FolderOpen className="h-3 w-3" />} disabled={!client} onClick={() => client && run(client.choose().then(async (added) => { if (added[0]) await preview(added[0].uri) }))}>选择文件</DesktopButton>
        <DesktopButton size="sm" icon={<RefreshCw className="h-3 w-3" />} onClick={() => run(refresh().then(async () => { if (current.current) await preview(current.current.uri) }))}>刷新</DesktopButton>
      </div>
      {!client && <p role="alert" className="text-sm text-[var(--ds-status-danger)]">统一资源服务未启用</p>}
      {error && <p role="alert" className="shrink-0 text-xs text-[var(--ds-status-danger)]">{error}</p>}
      <div className="grid min-h-0 flex-1 grid-cols-[220px_minmax(0,1fr)] gap-3">
        <div className="min-h-0 overflow-auto rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)] bg-[var(--ds-surface)] p-1">
          {!items.length && <p className="p-4 text-xs text-[var(--ds-text-muted)]">登记文件后，画布和其他插件可以使用同一链接。</p>}
          {items.map((resource) => <DesktopCardButton key={resource.id} data-resource-entry={resource.id} selected={selected?.id === resource.id} onClick={() => run(preview(resource.uri))} className="mb-1 !w-full !rounded-[var(--ds-radius-control)] px-3 py-2.5 last:mb-0">
            <span className="block truncate text-xs font-medium" title={resource.name}>{resource.name}</span>
            <span className="mt-1 block text-xs text-[var(--ds-text-muted)]">{resource.kind} · {resource.available ? formatSize(resource.size) : '原文件不可用'}</span>
          </DesktopCardButton>)}
        </div>
        <div className="flex min-h-0 min-w-0 flex-col gap-2" data-resource-preview={selected?.id}>
          {selected ? <>
            <div className="flex shrink-0 items-center justify-between gap-2">
              <span className="truncate text-sm font-medium">{selected.name}</span>
              <DesktopButton size="xs" variant="ghost" icon={<Trash2 className="h-3 w-3" />} onClick={() => client && run(client.forget(selected.uri).then(() => { current.current = null; setSelected(null) }))}>取消登记</DesktopButton>
            </div>
            <code className="shrink-0 break-all text-xs text-[var(--ds-accent-active)] dark:text-[var(--ds-accent-strong)]" data-resource-uri>{selected.uri}</code>
            <div className="min-h-0 flex-1 overflow-auto rounded-[var(--ds-radius-panel)] bg-[var(--ds-surface-inset)] p-3">
              {!selected.available ? <p className="text-sm">原文件不存在或无法读取，资源链接仍保留。</p> : selected.kind === 'image' && client ? <LeaferPreview key={selected.url} resource={selected} client={client} onState={(state) => { imageState.current = state }} /> : selected.kind === 'video' ?
                <video key={selected.url} ref={(node) => { media.current = node }} src={selected.url} controls preload="metadata" className="h-full max-h-full w-full object-contain" /> : selected.kind === 'audio' ?
                <audio key={selected.url} ref={(node) => { media.current = node }} src={selected.url} controls preload="metadata" className="w-full" /> : ['text', 'markdown'].includes(selected.kind) ?
                <pre className="whitespace-pre-wrap break-words text-xs">{text}</pre> : <p className="text-sm text-[var(--ds-text-muted)]">已提供统一链接与原始字节。此格式的内容阅读器将在后续接入。</p>}
            </div>
            <p className="shrink-0 truncate text-xs text-[var(--ds-text-muted)]" title={selected.path}>{selected.path}</p>
          </> : <div className="flex flex-1 items-center justify-center text-sm text-[var(--ds-text-muted)]">选择资源查看</div>}
        </div>
      </div>
      <p className="shrink-0 text-xs text-[var(--ds-text-muted)]">只登记原文件，不复制、不转码。取消登记不会删除原文件。</p>
    </div>
  </ThemeFloatingPanel>
}

function LeaferPreview({ resource, client, onState }: { resource: ResourceInfo; client: ResourceClient; onState: (state: { ready: boolean; width?: number; height?: number; error?: string }) => void }): ReactElement {
  const view = useRef<HTMLDivElement>(null)
  const stateCallback = useRef(onState)
  stateCallback.current = onState
  useEffect(() => {
    let disposed = false
    let lease: ImageLease | undefined
    let engine: { destroy(): void } | undefined
    const mount = view.current
    void (async () => {
      try {
        lease = await client.acquireImage(resource.uri)
        if (disposed || !mount) { await client.releaseImage(lease.leaseId); lease = undefined; return }
        const { Leafer, Image } = await import('leafer-ui')
        if (disposed) { await client.releaseImage(lease.leaseId); lease = undefined; return }
        const width = mount.clientWidth || 480
        const height = mount.clientHeight || 320
        const scale = Math.min(width / lease.width, height / lease.height, 1)
        const leafer = new Leafer({ view: mount, width, height })
        engine = leafer
        leafer.add(new Image({ url: lease.url, x: (width - lease.width * scale) / 2, y: (height - lease.height * scale) / 2, width: lease.width * scale, height: lease.height * scale }))
        stateCallback.current({ ready: true, width: lease.width, height: lease.height })
      } catch (cause) { if (!disposed) stateCallback.current({ ready: false, error: errorText(cause, '图片资源预览失败') }) }
    })()
    return () => {
      disposed = true
      engine?.destroy()
      if (lease) void client.releaseImage(lease.leaseId)
    }
  }, [client, resource.uri])
  return <div ref={view} className="h-full min-h-48 w-full" data-resource-leafer />
}

function formatSize(size: number | null): string { return size === null ? '—' : size < 1024 ? `${size} B` : size < 1024 * 1024 ? `${(size / 1024).toFixed(1)} KiB` : `${(size / 1024 / 1024).toFixed(1)} MiB` }
