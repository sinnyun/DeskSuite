export const quickColumns = ['页面名称', '物料类别', '物料名称', '尺寸标签', '尺寸', '数量']
const keys = ['title', 'materialCategory', 'material', 'sizeLabel', 'size', 'quantity']
const aliases: Record<string, string> = { 名称: 'title', 画布名称: 'title', 页面名称: 'title', 物料类别: 'materialCategory', 物料名称: 'material', 材质: 'material', 尺寸标签: 'sizeLabel', 尺寸: 'size', 数量: 'quantity' }

export interface QuickTable { columns: string[]; rows: string[][] }

// Excel/WPS TSV and CSV use doubled quotes for quotes inside a quoted cell.
export function parseQuickTable(text: string): QuickTable {
  if (text.length > 1_000_000) throw new Error('表格内容不能超过 100 万字符')
  const delimiter = text.includes('\t') ? '\t' : ','
  const rows: string[][] = []
  let row: string[] = [], cell = '', quoted = false, closed = false
  const pushCell = (): void => { row.push(cell.trim()); cell = ''; closed = false }
  for (let i = 0; i < text.length; i++) {
    const char = text[i]
    if (quoted) {
      if (char === '"') {
        if (text[i + 1] === '"') { cell += '"'; i++ } else { quoted = false; closed = true }
      } else cell += char
    } else if (char === '"' && !cell && !closed) quoted = true
    else if (char === delimiter) pushCell()
    else if (char === '\r' || char === '\n') {
      if (char === '\r' && text[i + 1] === '\n') i++
      pushCell(); rows.push(row); row = []
    } else {
      if (closed && char.trim()) throw new Error('引号后存在无效字符')
      cell += char
    }
  }
  if (quoted) throw new Error('表格引号未闭合')
  pushCell(); rows.push(row)
  const nonempty = rows.filter((item) => item.some(Boolean))
  if (!nonempty.length) throw new Error('请粘贴或输入至少一行物料')
  const first = nonempty[0]
  const hasHeader = first.some((value) => aliases[value] || keys.includes(value))
  const columns = hasHeader ? first : quickColumns
  return validateQuickTable({ columns, rows: hasHeader ? nonempty.slice(1) : nonempty })
}

export function validateQuickTable(table: QuickTable): QuickTable {
  const columns = table.columns.map((value) => value.trim())
  if (!columns.length || columns.length > 30 || columns.some((value) => !value || value.length > 80)) throw new Error('表头须为 1–30 个非空字段（每项最多 80 字）')
  const mapped = columns.map((value) => aliases[value] ?? value)
  if (new Set(mapped).size !== mapped.length) throw new Error('表头字段不能重复')
  if (mapped.filter((value) => !keys.includes(value)).length > 24) throw new Error('扩展字段不能超过 24 项')
  const rows = table.rows.map((row) => row.map((value) => value.trim())).filter((row) => row.some(Boolean))
  if (!rows.length || rows.length > 200) throw new Error('每次请输入 1–200 行有效物料')
  for (const [index, row] of rows.entries()) {
    if (row.length > columns.length && row.slice(columns.length).some(Boolean)) throw new Error(`第 ${index + 1} 行超出表头列数`)
    if (row.some((value) => value.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value))) throw new Error(`第 ${index + 1} 行含过长内容或控制字符`)
    const title = row[mapped.indexOf('title')] ?? ''
    if (title.length > 120) throw new Error(`第 ${index + 1} 行页面名称最多 120 字`)
  }
  return { columns, rows: rows.map((row) => columns.map((_, index) => row[index] ?? '')) }
}

export function quickEntries(table: QuickTable) {
  return validateQuickTable(table).rows.map((row) => {
    const info = { materialCategory: '', material: '', sizeLabel: '', size: '', quantity: '', extra: {} as Record<string, string> }
    let title = ''
    table.columns.forEach((column, index) => {
      const key = aliases[column.trim()] ?? column.trim()
      if (key === 'title') title = row[index]
      else if (keys.includes(key)) info[key as keyof Omit<typeof info, 'extra'>] = row[index]
      else if (row[index]) Object.defineProperty(info.extra, column.trim(), { value: row[index], enumerable: true })
    })
    return { title, info }
  })
}
