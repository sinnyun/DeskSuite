import { useSyncExternalStore } from 'react'
import type { BasketItem, BasketService, SelectionItem } from '../../workbench/sdk'
import { call, log } from '../../workbench/sdk'

class BasketStore implements BasketService {
  private items: BasketItem[] = []
  private listeners = new Set<() => void>()
  private queue: Promise<unknown> = Promise.resolve()

  list = (): BasketItem[] => this.items

  getSnapshot = (): BasketItem[] => this.items

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  add = (items: SelectionItem[]): void => {
    const existing = new Set(this.items.map((item) => item.path))
    const incoming = items.filter((item) => !existing.has(item.path))
    if (incoming.length === 0) return
    const addedAt = Date.now()
    this.commit([...incoming.map((item) => ({ ...item, addedAt })), ...this.items])
    this.persist(() => call<BasketItem[]>('basket', 'add', incoming))
  }

  remove = (path: string): void => {
    if (!this.items.some((item) => item.path === path)) return
    this.commit(this.items.filter((item) => item.path !== path))
    this.persist(() => call<BasketItem[]>('basket', 'remove', path))
  }

  clear = (): void => {
    if (this.items.length === 0) return
    this.commit([])
    this.persist(() => call<BasketItem[]>('basket', 'clear'))
  }

  hydrate = async (): Promise<void> => {
    try {
      this.commit(await call<BasketItem[]>('basket', 'list'))
    } catch (error) {
      log('error', 'Basket', '暂存篮读取失败，本次会话不会持久化', { error: String(error) })
    }
  }

  // 主进程是唯一真相：写操作串行执行，避免乱序响应把旧数组写回界面
  private persist(op: () => Promise<BasketItem[]>): void {
    this.queue = this.queue
      .then(op)
      .then((next) => this.commit(next))
      .catch((error: unknown) => {
        log('error', 'Basket', '暂存篮保存失败', { error: String(error) })
      })
  }

  private commit(items: BasketItem[]): void {
    this.items = items
    for (const listener of this.listeners) listener()
  }
}

export const basketStore = new BasketStore()

void basketStore.hydrate()

export function useBasket(): BasketItem[] {
  return useSyncExternalStore(basketStore.subscribe, basketStore.getSnapshot)
}
