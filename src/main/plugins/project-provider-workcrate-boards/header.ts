import { z } from 'zod'

type Json = Record<string, unknown>

export interface NativeBoard {
  nativeId: number
  index: number
  title: string
  widthPt: number
  heightPt: number
}

export interface BoardFields {
  materialCategory: string
  material: string
  size: string
  sizeLabel: string
  quantity: string
  extra: Record<string, string>
}

export interface HeaderClient {
  command(id: string, params?: Json): Promise<unknown>
}

const NS = 'fileatlas.workcrate'
const NOTE_BYTES_LIMIT = 64 * 1024
const ownedNoteSchema = z.object({ namespace: z.literal(NS), version: z.literal(1) }).passthrough()
const FONT = 'Microsoft YaHei'
const COLOR_TEXT = '#000000'
const COLOR_BAND = '#eef4fd'
const COLOR_CHIP = '#ffffff'
const COLOR_CHIP_EDGE = '#d8e5f4'
const ROLE_NUMBER = 'page_number'
const ROLE_CATEGORY = 'project_name'
const ROLE_DETAILS = 'details'
const LAYOUT = 2

interface OwnedField { id: number; text: string; note: Json; fill?: string }
interface OwnedPage {
  fields: Map<string, OwnedField>
  band?: number
  chip?: number
  legacyGroup?: number
  pageGroup?: number
  layout: number
}
interface OwnedDocument { pages: Map<number, OwnedPage>; headerRoot?: number }

function object(value: unknown): Json { return value && typeof value === 'object' && !Array.isArray(value) ? value as Json : {} }
function number(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined }
function textOf(node: Json): string {
  const kind = object(node.kind)
  if (!Array.isArray(kind.runs)) return ''
  return kind.runs.map((run) => typeof object(run).text === 'string' ? object(run).text as string : '').join('')
}
function parseNote(node: Json): Json | null {
  const raw = object(node.attrs).note
  if (typeof raw !== 'string' || Buffer.byteLength(raw, 'utf8') > NOTE_BYTES_LIMIT) return null
  try {
    const parsed = ownedNoteSchema.safeParse(JSON.parse(raw))
    return parsed.success ? parsed.data : null
  } catch { return null }
}
export function hasOwnedNote(node: unknown): boolean { return parseNote(object(node)) !== null }
function scanDocument(documentValue: unknown): OwnedDocument {
  const document = object(documentValue)
  if (!Array.isArray(document.layers)) throw new Error('VectorCraft 文档缺少图层目录')
  const owned: OwnedDocument = { pages: new Map() }
  let count = 0
  const visit = (raw: unknown, depth: number): void => {
    count++
    if (count > 100_000 || depth > 128) throw new Error('VectorCraft 文档节点过多或嵌套过深')
    const node = object(raw)
    const kind = object(node.kind)
    const note = parseNote(node)
    const id = number(node.id)
    if (note && id !== undefined) {
      const role = typeof note.role === 'string' ? note.role : ''
      const board = number(note.board) ?? number(note.artboardId)
      if (role === 'header_root') owned.headerRoot = id
      if (board !== undefined) {
        const page = owned.pages.get(board) ?? { fields: new Map<string, OwnedField>(), layout: 0 }
        if (kind.type === 'text') {
          if (page.fields.has(role)) throw new Error('原生物料栏存在重复字段，请在 VectorCraft 中修复后同步')
          page.fields.set(role, { id, text: textOf(node), note, fill: typeof node.fill === 'string' ? node.fill : undefined })
        } else if (kind.type === 'path' && role === 'band') page.band = id
        else if (kind.type === 'path' && role === 'page_number_chip') page.chip = id
        else if (kind.type === 'group' && role === 'header') page.legacyGroup = id
        else if (kind.type === 'group' && role === 'header_page') { page.pageGroup = id; page.layout = number(note.layout) ?? 0 }
        owned.pages.set(board, page)
      }
    }
    if (Array.isArray(kind.children)) for (const child of kind.children) visit(child, depth + 1)
  }
  for (const layer of document.layers) visit(layer, 0)
  return owned
}

function emptyFields(): BoardFields { return { materialCategory: '', material: '', size: '', sizeLabel: '', quantity: '', extra: {} } }
function note(board: number, role: string, extras: Json = {}): Json { return { namespace: NS, version: 1, layout: LAYOUT, board, role, ...extras } }
function visible(value: string): string { const normalized = value.split(/\s+/u).filter(Boolean).join(' '); return normalized || ' ' }
function detailsFromInfo(info: BoardFields): Json {
  const extra = Object.fromEntries(Object.entries(info.extra).sort(([left], [right]) => left.localeCompare(right)))
  return { version: 1, material: info.material, size: info.size, sizeLabel: info.sizeLabel, quantity: info.quantity, extra }
}
function detailsText(info: BoardFields): string {
  const extras = Object.entries(info.extra).sort(([left], [right]) => left.localeCompare(right)).map(([, value]) => value)
  return [info.material, info.size, info.quantity, ...extras]
    .map((value) => value.split(/\s+/u).filter(Boolean).join(' ')).filter(Boolean).join(' | ')
}

function fieldsFromOwned(owned: OwnedPage | undefined): BoardFields {
  const info = emptyFields()
  const category = owned?.fields.get(ROLE_CATEGORY)?.note
  if (typeof category?.value === 'string') info.materialCategory = category.value
  const details = owned?.fields.get(ROLE_DETAILS)?.note.details
  if (details !== undefined) {
    const value = object(details)
    if (value.version !== 1 || typeof value.material !== 'string' || typeof value.size !== 'string' || (value.sizeLabel !== undefined && typeof value.sizeLabel !== 'string') || typeof value.quantity !== 'string' || !value.extra || typeof value.extra !== 'object' || Array.isArray(value.extra)) {
      throw new Error('原生物料栏字段数据损坏或版本不支持，请先备份文档再修复')
    }
    const extra: Record<string, string> = {}
    for (const [key, item] of Object.entries(value.extra)) {
      if (typeof item !== 'string') throw new Error('原生物料栏扩展字段数据无效')
      extra[key] = item
    }
    info.material = value.material
    info.size = value.size
    info.sizeLabel = typeof value.sizeLabel === 'string' ? value.sizeLabel : ''
    info.quantity = value.quantity
    info.extra = extra
  }
  return info
}

export function readAllBoardFields(document: unknown): Map<number, BoardFields> {
  const owned = scanDocument(document)
  return new Map([...owned.pages].map(([nativeId, page]) => [nativeId, fieldsFromOwned(page)]))
}

async function command(client: HeaderClient, id: string, params: Json = {}): Promise<Json> {
  return object(await client.command(id, params))
}
function finite(value: unknown, label: string): number {
  const result = number(value)
  if (result === undefined) throw new Error(`VectorCraft 未返回有效的${label}`)
  return result
}
async function tag(client: HeaderClient, id: number, value: Json): Promise<void> {
  const result = await command(client, 'attributes.set', { id, note: JSON.stringify(value) })
  if (result.changed !== 1) throw new Error('VectorCraft 未能写入材料栏元数据')
}
async function headerLayer(client: HeaderClient): Promise<void> {
  const document = object(await client.command('document.json'))
  const layers = Array.isArray(document.layers) ? document.layers.map(object) : []
  const existing = layers.filter((layer) => layer.name === 'WorkCrate header').map((layer) => number(layer.id)).filter((id): id is number => id !== undefined).at(-1)
  const id = existing ?? finite((await command(client, 'layer.new', { name: 'WorkCrate header', top: true, locked: false, visible: true })).id, '材料栏图层 ID')
  await command(client, 'layer.setCurrent', { id })
}
async function rectangle(client: HeaderClient, board: number, role: string, rect: Json, fill: string, stroke?: string): Promise<number> {
  const id = finite((await command(client, 'shape.rectangle', rect)).id, '矩形 ID')
  await command(client, 'paint.setFill', { id, color: fill })
  await command(client, 'paint.setStroke', stroke ? { id, color: stroke } : { id, none: true })
  await tag(client, id, note(board, role))
  return id
}
async function textNode(client: HeaderClient, board: NativeBoard, role: string, value: string, nodeNote: Json, geometry: { x: number; y: number; width: number; height: number }): Promise<number> {
  const anchors: Record<string, { x: number; size: number; justify: string; style: string }> = {
    [ROLE_NUMBER]: { x: geometry.x + 36, size: 12, justify: 'center', style: 'bold' },
    [ROLE_CATEGORY]: { x: geometry.x + 68, size: 20, justify: 'left', style: 'bold' },
    [ROLE_DETAILS]: { x: geometry.x + geometry.width - 24, size: 13, justify: 'right', style: 'regular' }
  }
  const anchor = anchors[role]
  const id = finite((await command(client, 'text.create', {
    x: anchor.x, y: geometry.y + 34, text: value, size: anchor.size, font: FONT,
    style: anchor.style, color: COLOR_TEXT, justify: anchor.justify
  })).id, '文字 ID')
  const bounds = object((await command(client, 'document.node', { id, summary: true })).bounds)
  const y = finite(bounds.y, '文字边界 y')
  const height = finite(bounds.height, '文字边界高度')
  const delta = geometry.y + 34 - y - height / 2
  if (Math.abs(delta) > 0.01) await command(client, 'object.transform', { ids: [id], matrix: [1, 0, 0, 1, 0, delta] })
  const nextBounds = object((await command(client, 'document.node', { id, summary: true })).bounds)
  const left = finite(nextBounds.x, '文字左边界')
  const right = left + finite(nextBounds.width, '文字宽度')
  const split = geometry.x + geometry.width * 0.33
  const fits = role === ROLE_DETAILS ? left >= split && right <= geometry.x + geometry.width - 23.9
    : role === ROLE_CATEGORY ? left >= geometry.x + 67.9 && right <= split - 12
      : left >= geometry.x + 16 && right <= geometry.x + 56
  if (value.trim() && !fits) throw new Error(role === ROLE_DETAILS ? '材料信息太长，右侧单行放不下，请缩短内容' : '页码或材料类别太长，请缩短内容')
  await tag(client, id, nodeNote)
  return id
}

export async function writeBoardFields(client: HeaderClient, board: NativeBoard, info: BoardFields, manageUndo = true): Promise<void> {
  const serialized = JSON.stringify(info)
  if (Buffer.byteLength(serialized, 'utf8') > 16_384 || Object.keys(info.extra).length > 24) throw new Error('材料字段过多，请减少扩展项后重试')
  for (const value of [info.materialCategory, info.material, info.size, info.quantity, ...Object.keys(info.extra), ...Object.values(info.extra)]) {
    if (value.length > 1024 || /[\u0000-\u0008\u000b\u000c\u000e-\u001f]/u.test(value)) throw new Error('材料字段过长或含控制字符')
  }
  if (board.widthPt < 200 || board.heightPt < 100) throw new Error('画板尺寸不足以容纳材料栏')
  const document = await client.command('document.json')
  const layout = scanDocument(document)
  const owned = layout.pages.get(board.nativeId) ?? { fields: new Map<string, OwnedField>(), layout: 0 }
  const numberText = String(board.index + 1).padStart(2, '0')
  const categoryText = visible(info.materialCategory)
  const display = visible(detailsText(info))
  const categoryNote = note(board.nativeId, ROLE_CATEGORY, { value: info.materialCategory })
  const detailsNote = note(board.nativeId, ROLE_DETAILS, { details: detailsFromInfo(info) })
  const inspect = object(await client.command('doc_inspect', { depth: 0 }))
  if (inspect.isolation != null) throw new Error('请先退出 VectorCraft 隔离模式，再保存材料字段')
  const artboards = Array.isArray(inspect.artboards) ? inspect.artboards.map(object) : []
  const artboard = artboards[board.index]
  if (!artboard) throw new Error('VectorCraft 未返回当前画板几何')
  const geometry = {
    x: finite(artboard.x, '画板 x'), y: finite(artboard.y, '画板 y'),
    width: board.widthPt, height: board.heightPt
  }
  const initialized = owned.layout === LAYOUT && !!owned.pageGroup && !!layout.headerRoot && !!owned.band && !!owned.chip &&
    [ROLE_NUMBER, ROLE_CATEGORY, ROLE_DETAILS].every((role) => owned.fields.has(role))
  if (manageUndo) await command(client, 'edit.undoGroup.begin', { label: 'WorkCrate material header' })
  try {
    if (initialized) {
      const page = owned.fields.get(ROLE_NUMBER)!
      const category = owned.fields.get(ROLE_CATEGORY)!
      const details = owned.fields.get(ROLE_DETAILS)!
      await command(client, 'text.setStyle', { ids: [page.id, category.id, details.id], fill: COLOR_TEXT })
      await patchText(client, page, numberText, null, geometry, ROLE_NUMBER)
      await patchText(client, category, categoryText, categoryNote, geometry, ROLE_CATEGORY)
      await patchText(client, details, display, detailsNote, geometry, ROLE_DETAILS)
    } else {
      await installLayout(client, board, owned, layout.headerRoot, geometry, numberText, categoryText, display, categoryNote, detailsNote)
    }
  } catch (error) {
    if (manageUndo) await command(client, 'edit.undoGroup.end', { cancel: true }).catch(() => undefined)
    throw error
  }
  if (manageUndo) await command(client, 'edit.undoGroup.end')
}

async function patchText(client: HeaderClient, field: OwnedField, value: string, updatedNote: Json | null, geometry: { x: number; y: number; width: number }, role: string): Promise<void> {
  if (field.text !== value) {
    await command(client, 'text.setText', { id: field.id, text: value })
    const bounds = object((await command(client, 'document.node', { id: field.id, summary: true })).bounds)
    const left = finite(bounds.x, '文字左边界')
    const right = left + finite(bounds.width, '文字宽度')
    const split = geometry.x + geometry.width * 0.33
    const fits = role === ROLE_DETAILS ? left >= split && right <= geometry.x + geometry.width - 23.9
      : role === ROLE_CATEGORY ? left >= geometry.x + 67.9 && right <= split - 12
        : left >= geometry.x + 16 && right <= geometry.x + 56
    if (!fits) throw new Error(role === ROLE_DETAILS ? '材料信息太长，右侧单行放不下，请缩短内容' : '页码或材料类别太长，请缩短内容')
  }
  if (updatedNote && JSON.stringify(updatedNote) !== JSON.stringify(field.note)) await tag(client, field.id, updatedNote)
}

async function installLayout(client: HeaderClient, board: NativeBoard, old: OwnedPage, rootId: number | undefined, geometry: { x: number; y: number; width: number; height: number }, numberText: string, category: string, details: string, categoryNote: Json, detailsNote: Json): Promise<void> {
  if (rootId !== undefined) await command(client, 'object.setProps', { id: rootId, locked: false })
  await headerLayer(client)
  const band = await rectangle(client, board.nativeId, 'band', { x: geometry.x + 8, y: geometry.y + 8, width: board.widthPt - 16, height: 52, radius: 10 }, COLOR_BAND)
  const chip = await rectangle(client, board.nativeId, 'page_number_chip', { x: geometry.x + 16, y: geometry.y + 22, width: 40, height: 24, radius: 7 }, COLOR_CHIP, COLOR_CHIP_EDGE)
  const pageNo = await textNode(client, board, ROLE_NUMBER, numberText, note(board.nativeId, ROLE_NUMBER), geometry)
  const categoryNode = await textNode(client, board, ROLE_CATEGORY, category, categoryNote, geometry)
  const detailNode = await textNode(client, board, ROLE_DETAILS, details, detailsNote, geometry)
  const order = [band, chip, pageNo, categoryNode, detailNode]
  const group = finite((await command(client, 'object.group', { ids: order })).id, '材料栏分组 ID')
  await tag(client, group, note(board.nativeId, 'header_page'))
  for (const [index, id] of order.entries()) await command(client, 'node.move', { id, parent: group, index })
  let root = rootId
  if (root !== undefined) await command(client, 'node.move', { id: group, parent: root })
  else {
    root = finite((await command(client, 'object.group', { ids: [group] })).id, '材料栏主组 ID')
    await tag(client, root, { namespace: NS, version: 1, role: 'header_root' })
  }
  const oldGroup = old.pageGroup ?? old.legacyGroup
  if (oldGroup !== undefined) await command(client, 'edit.clear', { ids: [oldGroup] })
  else {
    const oldIds = [...old.fields.values()].map((field) => field.id).concat(old.band ?? [], old.chip ?? [])
    if (oldIds.length) await command(client, 'edit.clear', { ids: oldIds })
  }
  await command(client, 'object.setProps', { id: root, locked: true })
}
