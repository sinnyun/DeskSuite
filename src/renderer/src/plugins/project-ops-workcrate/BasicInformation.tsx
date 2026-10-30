import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { useUiKit } from '../../workbench/sdk'

export interface FieldPreset { key: string; label: string; values: string[] }
export interface FieldPresets { fields: FieldPreset[] }
export const materialFields = [
  { key: 'materialCategory', label: '物料类别', placeholder: '如：舞台区' },
  { key: 'material', label: '物料名称', placeholder: '如：签到处' },
  { key: 'sizeLabel', label: '尺寸标签', placeholder: '如：成品尺寸' },
  { key: 'size', label: '尺寸', placeholder: '如：400×300cm' },
  { key: 'quantity', label: '数量', placeholder: '如：20 套' }
] as const

export function PresetInput({ label, value, options, busy, placeholder, onChange }: { label: string; value: string; options: string[]; busy: boolean; placeholder?: string; onChange: (value: string) => void }): ReactElement {
  const { DesktopInput, DesktopSelect } = useUiKit()
  return <fieldset disabled={busy} className="flex min-w-0 items-center gap-1 border-0 p-0">
    <DesktopInput aria-label={label} value={value} onChange={(event) => onChange(event.target.value)} placeholder={placeholder} className="min-w-0 flex-1 !px-2 !text-xs"/>
    <DesktopSelect value="" title={`${label}基础信息`} className="w-[68px] shrink-0 !rounded-md !text-xs" options={[{ value: '', label: '选填' }, ...options.map((item) => ({ value: item, label: item }))]} onChange={(next) => { if (next) onChange(next) }}/>
  </fieldset>
}

export function BasicInformation({ presets, busy, onSave }: { presets: FieldPresets; busy: boolean; onSave: (value: FieldPresets) => Promise<void> }): ReactElement {
  const { DesktopButton, DesktopInput, DesktopTextarea } = useUiKit()
  const [fields, setFields] = useState<Array<{ key: string; label: string; text: string }>>([])
  const [newLabel, setNewLabel] = useState('')
  const [validation, setValidation] = useState('')
  useEffect(() => {
    const merged = [...presets.fields]
    for (const field of materialFields) if (!merged.some((item) => item.key === field.key)) merged.push({ ...field, values: [] })
    setFields(merged.map((field) => ({ key: field.key, label: field.label, text: field.values.join('\n') })))
  }, [presets])
  const save = (): void => {
    const next = fields.map((field) => ({ key: field.key, label: field.label.trim(), values: [...new Set(field.text.split(/\r?\n/).map((value) => value.trim()).filter(Boolean))] }))
    if (next.some((field) => !field.label || field.label.length > 120 || field.values.length > 200 || field.values.some((value) => value.length > 240))) { setValidation('每项最多 200 个选项，单项内容不超过 240 字，字段名称不超过 120 字。'); return }
    if (new Set(next.map((field) => field.label)).size !== next.length) { setValidation('字段名称不能重复。'); return }
    setValidation(''); void onSave({ fields: next })
  }
  const addField = (): void => {
    const label = newLabel.trim()
    if (!label || label.length > 120 || fields.some((field) => field.label === label) || fields.length >= 100) { setValidation('请输入不重复的字段名称（最多 120 字、100 个字段）。'); return }
    setFields((current) => [...current, { key: `extra_${crypto.randomUUID()}`, label, text: '' }]); setNewLabel(''); setValidation('')
  }
  return <div data-basic-information className="flex min-h-0 flex-1 flex-col">
    <p className="mb-4 shrink-0 text-xs text-[var(--ds-text-muted)]">为各项物料维护常用内容，每行一个选项。保存后，可在物料输入框旁的“选填”中快速使用，也可继续手动输入。</p>
    <div className="grid min-h-0 flex-1 grid-cols-1 gap-3 overflow-y-auto pr-1 md:grid-cols-2">
      {fields.map((field, index) => <section key={field.key} className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3 dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface-raised)]">
        <div className="mb-2 flex items-center gap-2"><h3 className="flex-1 text-xs font-medium">{field.label}</h3><span className="text-xs text-[var(--ds-text-muted)]">{field.text.split(/\r?\n/).filter((value) => value.trim()).length} 项</span>{!materialFields.some((item) => item.key === field.key) && <DesktopButton size="xs" variant="ghost" disabled={busy} onClick={() => setFields((current) => current.filter((_, row) => row !== index))}>删除字段</DesktopButton>}</div>
        <DesktopTextarea aria-label={`${field.label}基础信息选项`} value={field.text} disabled={busy} onChange={(event) => setFields((current) => current.map((item, row) => row === index ? { ...item, text: event.target.value } : item))} rows={5} placeholder="每行输入一个常用选项" className="w-full resize-y leading-6"/>
      </section>)}
    </div>
    <div className="mt-3 flex shrink-0 items-center gap-2 border-t border-[var(--ds-border)] pt-3 dark:border-[var(--ds-border)]"><DesktopInput aria-label="新增基础信息字段" value={newLabel} maxLength={120} disabled={busy} onChange={(event) => setNewLabel(event.target.value)} placeholder="自定义物料字段名称" className="min-w-0 flex-1"/><DesktopButton disabled={busy || !newLabel.trim()} onClick={addField}>添加字段</DesktopButton><DesktopButton variant="primary" disabled={busy} onClick={save}>保存基础信息</DesktopButton></div>
    {validation && <p role="alert" className="mt-2 shrink-0 text-xs text-[var(--ds-status-danger)]">{validation}</p>}
  </div>
}
