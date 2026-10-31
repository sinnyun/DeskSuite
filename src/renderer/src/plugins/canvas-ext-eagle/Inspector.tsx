import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Copy, ExternalLink, RefreshCw } from 'lucide-react'
import { call, errorText, useUiKit } from '../../workbench/sdk'
import type { EagleSource, Node } from './contract'

export function EagleInspector({ node }: { node: Node }): ReactElement | null {
  const { DesktopButton } = useUiKit()
  const [source, setSource] = useState<EagleSource | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  useEffect(() => {
    let disposed = false
    setSource(null); setError('')
    const load = (): void => {
      if (!node.resource || node.type !== 'image') return
      void call<EagleSource | null>('eagleLinks', 'get', node.resource).then(value => {
        if (!disposed) setSource(value)
      }).catch(cause => { if (!disposed) setError(errorText(cause, 'Eagle 信息读取失败')) })
    }
    load()
    const unsubscribe = window.bridge.onEvent((channel, payload) => {
      if (channel === 'eagleLinks:changed' && (payload as { reference?: string })?.reference === node.resource) load()
    })
    return () => { disposed = true; unsubscribe() }
  }, [node.resource, node.type])
  if (!source) return error ? <p className="wb-muted">Eagle 信息读取失败：{error}</p> : null
  const run = async (fn: () => Promise<unknown>): Promise<void> => {
    setBusy(true); setError('')
    try { await fn() } catch (cause) { setError(errorText(cause, 'Eagle 操作失败')) } finally { setBusy(false) }
  }
  const row = (label: string, value: string): ReactElement => <div className="min-w-0" key={label}>
    <div className="flex items-center justify-between gap-2"><span className="wb-muted">{label}</span>
      <DesktopButton size="xs" variant="ghost" icon={<Copy className="h-3 w-3" />} title={`复制${label}`} aria-label={`复制${label}`} onClick={() => void run(() => call('clipboard', 'writeText', value))} />
    </div>
    <div className="break-all text-xs" title={value}>{value || '—'}</div>
  </div>
  return <section className="space-y-3 border-t border-slate-200 pt-3 dark:border-slate-700" aria-label="Eagle 图片信息" data-eagle-item={source.itemId}>
    <div className="wb-inspector-heading">Eagle 图片来源</div>
    <div className="flex flex-wrap gap-2">
      <DesktopButton size="xs" disabled={busy} icon={<ExternalLink className="h-3.5 w-3.5" />} onClick={() => void run(() => call('eagleLinks', 'open', source.itemId))}>在 Eagle 中定位</DesktopButton>
      <DesktopButton size="xs" variant="ghost" disabled={busy} icon={<RefreshCw className="h-3.5 w-3.5" />} onClick={() => void run(async () => setSource(await call<EagleSource>('eagleLinks', 'inspect', source.resourceUri, true)))}>刷新信息</DesktopButton>
    </div>
    {error && <p className="text-xs text-red-500" role="alert">{error}</p>}
    {row('条目名称', source.name)}
    {row('条目 ID', source.itemId)}
    {row('所属文件夹', source.folders.map(f => f.name).join(' / ') || '未分类')}
    {row('Eagle 标签', source.tags.join('、') || '无标签')}
    <p className="wb-muted">{source.width} × {source.height} · {(source.size / 1024).toFixed(1)} KB · 评分 {source.rating}/5</p>
    {source.annotation && row('备注', source.annotation)}
    {source.url && row('来源网址', source.url)}
    <details className="space-y-2"><summary className="cursor-pointer text-xs">文件链接与路径</summary>
      {row('本地原图', source.originalPath)}
      {row('统一资源链接', source.resourceUri)}
      {row('Eagle 缩略图', source.thumbnailPath)}
      {row('Eagle API', source.apiUrl)}
    </details>
    <p className="wb-muted">原文件由 Eagle 管理；画板仅保存链接。信息更新于 {new Date(source.updatedAt).toLocaleString('zh-CN')}。</p>
  </section>
}
