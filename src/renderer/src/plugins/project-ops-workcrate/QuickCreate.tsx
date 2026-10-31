import { useRef, useState } from 'react'
import type { ReactElement } from 'react'
import { callValidated, errorText, useUiKit } from '../../workbench/sdk'
import { quickTableSchema } from './schemas'

export interface QuickTable { columns: string[]; rows: string[][] }
const empty = (): QuickTable => ({ columns: ['页面名称', '物料类别', '物料名称', '尺寸标签', '尺寸', '数量'], rows: [Array(6).fill('')] })

export function QuickCreate({ initial, busy, onBack, onCreate }: { initial: QuickTable | null; busy: boolean; onBack: () => void; onCreate: (table: QuickTable, reuseInitial: boolean) => Promise<void> }): ReactElement {
  const { DesktopButton, DesktopTextarea } = useUiKit()
  const [table, setTable] = useState<QuickTable>(initial ?? empty)
  const [text, setText] = useState('')
  const [error, setError] = useState('')
  const [parsing, setParsing] = useState(false)
  const [reuse, setReuse] = useState(true)
  const request = useRef(0)
  const count = table.rows.filter((row) => row.some((cell) => cell.trim())).length
  const parse = async (value: string): Promise<void> => {
    const id = ++request.current
    setText(value); setParsing(true); setError('')
    try {
      const next = await callValidated(quickTableSchema, 'workcrateBoards', 'previewQuickCreate', value)
      if (id === request.current) { setTable(next); setText('') }
    } catch (cause) { if (id === request.current) setError(errorText(cause, '表格解析失败')) }
    finally { if (id === request.current) setParsing(false) }
  }
  return <section data-quick-create className="flex min-h-0 flex-1 flex-col gap-3 p-4">
    <header className="flex shrink-0 items-center gap-3"><DesktopButton disabled={busy} onClick={onBack}>返回页面管理</DesktopButton><h2 data-ds-type="title" className="ds-type-title">快速创建画布与物料</h2><span data-ds-type="data" className="ds-type-data ml-auto text-[var(--ds-accent)]">{count} 行物料 → {count} 张画布</span></header>
    <p data-ds-type="body" className="ds-type-body shrink-0">从 Excel / WPS 复制后粘贴，或直接在下表逐格输入。每个有效行生成一张 A3 横向空白画布及物料栏，数量列表示物料数量。空行自动忽略，每次最多 200 行。</p>
    <div className="flex shrink-0 items-start gap-2"><DesktopTextarea aria-label="粘贴物料表格" disabled={busy || parsing} value={text} onChange={(event) => setText(event.target.value)} onPaste={(event) => { event.preventDefault(); void parse(event.clipboardData.getData('text/plain')) }} placeholder="在此粘贴表格（自动解析）。有表头时支持任意列顺序和自定义扩展字段；无表头时按下表六列顺序。" className="h-20 min-w-0 flex-1"/><DesktopButton disabled={busy || parsing || !text.trim()} onClick={() => void parse(text)}>解析表格</DesktopButton><DesktopButton disabled={busy || parsing} onClick={() => { setTable(empty()); setText(''); setError('') }}>清空</DesktopButton></div>
    <div className="min-h-0 flex-1 overflow-auto rounded-[var(--ds-radius-panel)] border border-[var(--ds-border)]"><table className="w-full border-collapse text-xs"><thead className="sticky top-0 z-10 bg-[var(--ds-accent-soft)]"><tr><th className="p-2">行</th>{table.columns.map((column) => <th key={column} className="min-w-36 border-l border-[var(--ds-border)] p-2 text-left">{column}</th>)}<th className="p-2">操作</th></tr></thead><tbody>{table.rows.map((row, rowIndex) => <tr key={rowIndex} data-quick-row className="border-t border-[var(--ds-border)]"><td className="px-2 text-center text-[var(--ds-text-muted)]">{rowIndex + 1}</td>{table.columns.map((column, columnIndex) => <td key={column} className="border-l border-[var(--ds-border)]"><input aria-label={`第 ${rowIndex + 1} 行${column}`} value={row[columnIndex] ?? ''} disabled={busy || parsing} maxLength={column === '页面名称' ? 120 : 1024} onChange={(event) => setTable((current) => ({ ...current, rows: current.rows.map((item, index) => index === rowIndex ? current.columns.map((_, cell) => cell === columnIndex ? event.target.value : item[cell] ?? '') : item) }))} className="w-full min-w-36 bg-transparent px-2 py-2 text-[var(--ds-text-primary)] outline-none focus:bg-[var(--ds-accent-soft)]"/></td>)}<td className="px-2"><DesktopButton size="xs" variant="ghost" type="button" disabled={busy || parsing} onClick={() => setTable((current) => ({ ...current, rows: current.rows.filter((_, index) => index !== rowIndex) }))} className="!h-auto !px-1 !py-0.5 whitespace-nowrap">删除行</DesktopButton></td></tr>)}</tbody></table></div>
    {error && <p role="alert" className="shrink-0 text-xs text-[var(--ds-status-danger)]">{error}</p>}
    <footer className="flex shrink-0 items-center gap-3"><DesktopButton disabled={busy || parsing || table.rows.length >= 200} onClick={() => setTable((current) => ({ ...current, rows: [...current.rows, current.columns.map(() => '')] }))}>＋ 添加一行</DesktopButton><label className="flex items-center gap-2 text-xs text-[var(--ds-text-muted)]"><input type="checkbox" checked={reuse} disabled={busy} onChange={(event) => setReuse(event.target.checked)}/>复用空白初始画板（已有内容时自动追加）</label><DesktopButton variant="primary" disabled={busy || parsing || Boolean(text) || !count || count > 200} className="ml-auto" onClick={() => void onCreate(table, reuse)}>{busy ? '正在批量创建…' : `创建 ${count} 张画布及物料`}</DesktopButton></footer>
  </section>
}
