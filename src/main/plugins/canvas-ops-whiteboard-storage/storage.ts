import { z } from 'zod'
import type { StoreService } from '../../services/store'
import { validateScene } from './scene'
import { MAX_BOARD_SUMMARIES, parseBoardSummaryIndex, boardSummaryIndexSchema, type BoardSummary } from './summary-index'

const idSchema = z.string().regex(/^[a-zA-Z0-9-]{1,64}$/)
const sceneSchema = z.string().max(4 * 1024 * 1024).refine((value) => {
  try { validateScene(value); return true } catch { return false }
}, '无效的画板场景')
const indexSchema = boardSummaryIndexSchema
type Summary = BoardSummary

/** Plugin-owned persistence; the shared Store retains atomic rename and backups. */
export class BoardStorage {
  private index: Summary[] | undefined
  private cache = new Map<string, string | null>()
  private chain: Promise<unknown> = Promise.resolve()
  constructor(private store: StoreService) {
    store.register('leafer-board-scenes', {
      schema: z.record(idSchema, sceneSchema), default: {}, version: 1
    })
    store.registerDocument('leafer-board-index', 'leafer-boards/index.json', {
      schema: indexSchema, default: null, version: 1
    })
  }
  private key(id: string): string {
    // Encode case, since Windows paths and Store keys cannot distinguish A/a.
    const encoded = Buffer.from(id).toString('hex')
    const key = `leafer-board-${encoded}`
    if (!this.store.has(key)) this.store.registerDocument(key, `leafer-boards/${encoded}.json`, {
      schema: sceneSchema.nullable(), default: null, version: 1
    })
    return key
  }
  private async load(): Promise<void> {
    if (this.index) return
    const index = parseBoardSummaryIndex(await this.store.read<Summary[] | null>('leafer-board-index'))
    if (index !== null) { this.index = index; return }
    const legacy = await this.store.read<Record<string, string>>('leafer-board-scenes')
    const entries = Object.entries(legacy)
    if (entries.length > MAX_BOARD_SUMMARIES) throw new Error(`旧画板数量超过 ${MAX_BOARD_SUMMARIES} 条，拒绝迁移摘要索引`)
    const migrated = parseBoardSummaryIndex(entries.map(([id, json]) => ({ id, title: JSON.parse(json).title })))!
    for (const [id, json] of entries) await this.store.write(this.key(id), json)
    // Publish only after all scenes are durable. Legacy remains an untouched backup.
    await this.store.write('leafer-board-index', migrated)
    this.index = migrated
  }
  private run<T>(fn: () => Promise<T>): Promise<T> {
    const task = this.chain.catch(() => {}).then(async () => { await this.load(); return fn() })
    this.chain = task
    return task
  }
  private remember(id: string, json: string | null): void {
    this.cache.delete(id)
    this.cache.set(id, json)
    if (this.cache.size > 8) this.cache.delete(this.cache.keys().next().value!)
  }
  private async read(id: string): Promise<string | null> {
    if (this.cache.has(id)) return this.cache.get(id)!
    const json = await this.store.read<string | null>(this.key(id))
    this.remember(id, json)
    return json
  }
  summaries(): Promise<Summary[]> { return this.run(async () => this.index!.map(item => ({ ...item }))) }
  list(): Promise<string[]> { return this.run(async () => this.index!.map(item => item.id)) }
  get(id: string): Promise<string | null> {
    return this.run(async () => this.index!.some(item => item.id === id) ? this.read(id) : null)
  }
  set(id: string, json: string): Promise<true> {
    // Validate before entering the write queue, including before migration.
    idSchema.parse(id)
    sceneSchema.parse(json)
    json = validateScene(json)
    return this.run(async () => {
      const existing = this.index!.find(item => item.id === id)
      const title = JSON.parse(json).title as string
      const next = existing
        ? this.index!.map(item => item.id === id ? { id, title } : item)
        : [...this.index!, { id, title }]
      parseBoardSummaryIndex(next)
      if (await this.read(id) !== json) {
        await this.store.write(this.key(id), json)
        this.remember(id, json)
      }
      if (!existing || existing.title !== title) {
        await this.store.write('leafer-board-index', next)
        this.index = parseBoardSummaryIndex(next)!
      }
      return true as const
    })
  }
  remove(id: string): Promise<boolean> {
    return this.run(async () => {
      if (!this.index!.some(item => item.id === id)) return false
      const next = this.index!.filter(item => item.id !== id)
      await this.store.write('leafer-board-index', next)
      this.index = next
      this.cache.delete(id)
      // Retain the unlisted document for recovery; it is never implicitly reimported.
      return true as const
    })
  }
}
