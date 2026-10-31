import { createStore } from 'zustand/vanilla'
import { useStore } from 'zustand'
import type { BasketItem, BasketService, SelectionItem } from '../../workbench/sdk'
import { callValidated, errorText, log } from '../../workbench/sdk'
import { basketItemsSchema } from './basket-schema'

interface BasketState {
  items: BasketItem[]
}

const store = createStore<BasketState>(() => ({ items: [] }))

class BasketStore implements BasketService {
  private queue: Promise<unknown> = Promise.resolve()

  list = (): BasketItem[] => store.getState().items

  getSnapshot = (): BasketItem[] => store.getState().items

  subscribe = (listener: () => void): (() => void) => {
    return store.subscribe(listener)
  }

  add = (incomingItems: SelectionItem[]): void => {
    const current = store.getState().items
    const existing = new Set(current.map((item) => item.path))
    const incoming = incomingItems.filter((item) => !existing.has(item.path))
    if (incoming.length === 0) return
    const addedAt = Date.now()
    this.commit([...incoming.map((item) => ({ ...item, addedAt })), ...current])
    this.persist(() => callValidated(basketItemsSchema, 'basket', 'add', incoming))
  }

  remove = (path: string): void => {
    const items = store.getState().items
    if (!items.some((item) => item.path === path)) return
    this.commit(items.filter((item) => item.path !== path))
    this.persist(() => callValidated(basketItemsSchema, 'basket', 'remove', path))
  }

  clear = (): void => {
    if (store.getState().items.length === 0) return
    this.commit([])
    this.persist(() => callValidated(basketItemsSchema, 'basket', 'clear'))
  }

  hydrate = async (): Promise<void> => {
    try {
      this.commit(await callValidated(basketItemsSchema, 'basket', 'list'))
    } catch (error) {
      log('error', 'Basket', '暂存篮读取失败，本次会话不会持久化', { error: errorText(error, '暂存篮读取失败') })
    }
  }

  // 主进程是唯一真相：写操作串行执行，避免乱序响应把旧数组写回界面
  private persist(op: () => Promise<BasketItem[]>): void {
    this.queue = this.queue
      .then(op)
      .then((next) => this.commit(next))
      .catch((error: unknown) => {
        log('error', 'Basket', '暂存篮保存失败', { error: errorText(error, '暂存篮保存失败') })
      })
  }

  private commit(items: BasketItem[]): void {
    store.setState({ items })
  }
}

export const basketStore = new BasketStore()

void basketStore.hydrate()

export function useBasket(): BasketItem[] {
  return useStore(store, (state) => state.items)
}
