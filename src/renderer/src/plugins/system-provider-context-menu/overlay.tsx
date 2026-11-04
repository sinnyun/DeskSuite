import { useEffect, useLayoutEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { ReactElement } from 'react'
import { Check, ChevronRight } from 'lucide-react'
import { isContextMenuSeparator } from '../../workbench/sdk'
import type { ContextMenuEntry, ContextMenuItem } from '../../workbench/sdk'
import { closeContextMenu, getMenuState, subscribeMenu } from './store'

const VIEWPORT_MARGIN = 8

export function ContextMenuOverlay(): ReactElement | null {
  const state = useSyncExternalStore(subscribeMenu, getMenuState)
  const [activePath, setActivePath] = useState<number[]>([])
  const rootRef = useRef<HTMLDivElement | null>(null)

  useEffect(() => {
    setActivePath([])
  }, [state?.seq])

  useEffect(() => {
    if (!state) return
    const onPointerDown = (event: PointerEvent): void => {
      if (rootRef.current && event.target instanceof Node && rootRef.current.contains(event.target)) return
      closeContextMenu()
    }
    const onScroll = (event: Event): void => {
      if (event.target instanceof Node && rootRef.current?.contains(event.target)) return
      closeContextMenu()
    }
    const dismiss = (): void => closeContextMenu()
    window.addEventListener('pointerdown', onPointerDown, true)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', dismiss)
    window.addEventListener('blur', dismiss)
    return () => {
      window.removeEventListener('pointerdown', onPointerDown, true)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', dismiss)
      window.removeEventListener('blur', dismiss)
    }
  }, [state?.seq])

  useEffect(() => {
    if (!state) return
    const onKey = (event: KeyboardEvent): void => {
      const prefix = activePath.slice(0, -1)
      const focusIndex = activePath.length > 0 ? activePath[activePath.length - 1] : -1
      if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        if (activePath.length > 0) setActivePath(activePath.slice(0, -1))
        else closeContextMenu()
        return
      }
      if (event.key === 'ArrowLeft') {
        if (activePath.length > 0) {
          event.preventDefault()
          event.stopPropagation()
          setActivePath(activePath.slice(0, -1))
        }
        return
      }
      if (event.key === 'ArrowRight') {
        const item = itemAt(levelEntriesAt(state.entries, prefix), focusIndex)
        if (item?.submenu) {
          event.preventDefault()
          event.stopPropagation()
          const sub = resolveSubmenu(item)
          const first = firstActivable(sub)
          setActivePath([...activePath, first >= 0 ? first : 0])
        }
        return
      }
      if (event.key === 'ArrowDown' || event.key === 'ArrowUp' || event.key === 'Home' || event.key === 'End') {
        event.preventDefault()
        event.stopPropagation()
        const level = levelEntriesAt(state.entries, prefix)
        const candidates: number[] = []
        for (let index = 0; index < level.length; index += 1) {
          const entry = level[index]
          if (isContextMenuSeparator(entry)) continue
          if (entry.disabled) continue
          candidates.push(index)
        }
        if (!candidates.length) return
        let next: number
        if (event.key === 'Home') next = candidates[0]
        else if (event.key === 'End') next = candidates[candidates.length - 1]
        else {
          const cursor = focusIndex >= 0 ? candidates.indexOf(focusIndex) : -1
          if (event.key === 'ArrowDown') next = cursor < 0 ? candidates[0] : candidates[(cursor + 1) % candidates.length]
          else next = cursor < 0 ? candidates[candidates.length - 1] : candidates[(cursor - 1 + candidates.length) % candidates.length]
        }
        setActivePath([...prefix, next])
        return
      }
      if (event.key === 'Enter' || event.key === ' ') {
        const item = itemAt(levelEntriesAt(state.entries, prefix), focusIndex)
        if (!item) return
        event.preventDefault()
        event.stopPropagation()
        activateEntry(item, activePath, setActivePath)
        return
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [state, activePath])

  if (!state) return null
  return (
    <div className="pointer-events-auto fixed inset-0 z-[120]" data-context-menu-open="true" data-context-menu-zone={state.zoneId} data-context-menu-seq={String(state.seq)}>
      <MenuLevel
        seq={state.seq}
        depth={0}
        entries={state.entries}
        prefix={[]}
        anchorX={state.x}
        anchorY={state.y}
        rootRef={rootRef}
        activePath={activePath}
        onHover={setActivePath}
        onActivate={(item, path) => activateEntry(item, path, setActivePath)}
      />
    </div>
  )
}

interface MenuLevelProps {
  seq: number
  depth: number
  entries: ContextMenuEntry[]
  prefix: number[]
  anchorX?: number
  anchorY?: number
  anchorEl?: HTMLElement | null
  rootRef?: { current: HTMLDivElement | null }
  activePath: number[]
  onHover: (path: number[]) => void
  onActivate: (item: ContextMenuItem, path: number[]) => void
}

function MenuLevel({ seq, depth, entries, prefix, anchorX, anchorY, anchorEl, rootRef, activePath, onHover, onActivate }: MenuLevelProps): ReactElement {
  const listRef = useRef<HTMLDivElement | null>(null)
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null)
  const [subAnchorEl, setSubAnchorEl] = useState<HTMLElement | null>(null)

  useLayoutEffect(() => {
    const el = listRef.current
    if (!el) return
    const rect = el.getBoundingClientRect()
    let left: number
    let top: number
    if (anchorEl) {
      const box = anchorEl.getBoundingClientRect()
      const fitsRight = box.right + 4 + rect.width <= window.innerWidth - VIEWPORT_MARGIN
      const fitsLeft = box.left - 4 - rect.width >= VIEWPORT_MARGIN
      if (fitsRight) left = box.right + 4
      else if (fitsLeft) left = box.left - 4 - rect.width
      else left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - rect.width - VIEWPORT_MARGIN, box.right + 4))
      top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - rect.height - VIEWPORT_MARGIN, box.top - 4))
    } else {
      left = Math.max(VIEWPORT_MARGIN, Math.min(window.innerWidth - rect.width - VIEWPORT_MARGIN, anchorX ?? VIEWPORT_MARGIN))
      top = Math.max(VIEWPORT_MARGIN, Math.min(window.innerHeight - rect.height - VIEWPORT_MARGIN, anchorY ?? VIEWPORT_MARGIN))
    }
    setPos({ left, top })
  }, [seq, depth, anchorEl, anchorX, anchorY, entries])

  const focusIndex = activePath.length > prefix.length ? activePath[prefix.length] : -1
  const focusedItem = focusIndex >= 0 ? itemAt(entries, focusIndex) : null
  const openSub = focusedItem ? resolveSubmenu(focusedItem) : null

  return (
    <div
      ref={depth === 0 ? rootRef : undefined}
      className="fixed z-[120] select-none"
      style={{
        left: pos?.left ?? -10000,
        top: pos?.top ?? -10000,
        visibility: pos ? 'visible' : 'hidden'
      }}
    >
      <div
        ref={listRef}
        role="menu"
        data-context-menu-level={depth}
        className="max-w-80 min-w-44 overflow-y-auto rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] p-1 shadow-xl dark:border-[var(--ds-border)] dark:bg-[var(--ds-surface)]"
        style={{ maxHeight: `calc(100vh - ${VIEWPORT_MARGIN * 2}px)` }}
        onContextMenu={(event) => event.preventDefault()}
      >
        {entries.map((entry, index) => {
          if (isContextMenuSeparator(entry)) {
            return <div key={entry.id ?? `sep-${index}`} role="separator" className="mx-1 my-1 border-t border-[var(--ds-border)] dark:border-[var(--ds-border)]" />
          }
          const path = [...prefix, index]
          const sub = resolveSubmenu(entry)
          const open = sub !== null && focusIndex === index
          return (
            <MenuRow
              key={entry.id}
              item={entry}
              path={path}
              active={focusIndex === index}
              open={open}
              onHover={onHover}
              onActivate={onActivate}
              onAnchor={open ? setSubAnchorEl : undefined}
            />
          )
        })}
      </div>
      {openSub && subAnchorEl ? (
        <MenuLevel
          seq={seq}
          depth={depth + 1}
          entries={openSub}
          prefix={[...prefix, focusIndex]}
          anchorEl={subAnchorEl}
          activePath={activePath}
          onHover={onHover}
          onActivate={onActivate}
        />
      ) : null}
    </div>
  )
}

interface MenuRowProps {
  item: ContextMenuItem
  path: number[]
  active: boolean
  open: boolean
  onHover: (path: number[]) => void
  onActivate: (item: ContextMenuItem, path: number[]) => void
  onAnchor?: (el: HTMLElement | null) => void
}

function MenuRow({ item, path, active, open, onHover, onActivate, onAnchor }: MenuRowProps): ReactElement {
  const disabled = Boolean(item.disabled)
  const reason = typeof item.disabled === 'string' ? item.disabled : undefined
  const hasSubmenu = resolveSubmenu(item) !== null
  return (
    <button
      type="button"
      ref={onAnchor}
      role="menuitem"
      data-menu-item={item.id}
      data-menu-label={item.label}
      data-menu-active={active || open ? 'true' : undefined}
      data-menu-disabled={disabled ? 'true' : undefined}
      title={reason}
      aria-disabled={disabled || undefined}
      aria-haspopup={hasSubmenu ? 'menu' : undefined}
      aria-expanded={hasSubmenu ? open : undefined}
      draggable={item.draggable || undefined}
      onDragStart={item.onDragStart}
      onMouseEnter={() => onHover(path)}
      onClick={() => onActivate(item, path)}
      className={[
        'flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-sm transition-colors',
        disabled
          ? 'cursor-default opacity-45'
          : active
            ? `bg-[var(--ds-accent-soft)] dark:bg-[var(--ds-accent-soft)] ${item.danger ? 'text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]' : ''}`
            : 'hover:bg-[var(--ds-surface-muted)] dark:hover:bg-[var(--ds-surface-muted)]',
        !disabled && !active && item.danger ? 'text-[var(--ds-status-danger)] dark:text-[var(--ds-status-danger)]' : '',
        hasSubmenu ? 'pr-1.5' : ''
      ].join(' ')}
    >
      <span className="flex h-4 w-4 shrink-0 items-center justify-center">
        {item.checked ? <Check className="h-3.5 w-3.5" /> : item.icon ?? null}
      </span>
      <span className="min-w-0 flex-1 truncate">{item.label}</span>
      {item.shortcut && !hasSubmenu && (
        <kbd className="shrink-0 text-xs text-[var(--ds-text-subtle)]">{item.shortcut}</kbd>
      )}
      {hasSubmenu && <ChevronRight className="h-3.5 w-3.5 shrink-0 text-[var(--ds-text-muted)]" />}
    </button>
  )
}

function resolveSubmenu(entry: ContextMenuEntry): ContextMenuEntry[] | null {
  if (isContextMenuSeparator(entry)) return null
  if (!entry.submenu) return null
  const resolved = typeof entry.submenu === 'function' ? entry.submenu() : entry.submenu
  return resolved.length > 0 ? resolved : null
}

function itemAt(level: ContextMenuEntry[], index: number): ContextMenuItem | null {
  const entry = level[index]
  if (!entry || isContextMenuSeparator(entry)) return null
  return entry
}

function levelEntriesAt(entries: ContextMenuEntry[], path: number[]): ContextMenuEntry[] {
  let level = entries
  for (const index of path) {
    const item = itemAt(level, index)
    if (!item) return level
    const sub = resolveSubmenu(item)
    if (!sub) return level
    level = sub
  }
  return level
}

function firstActivable(entries: ContextMenuEntry[] | null): number {
  if (!entries) return -1
  for (let index = 0; index < entries.length; index += 1) {
    const entry = entries[index]
    if (isContextMenuSeparator(entry) || entry.disabled) continue
    return index
  }
  return -1
}

function activateEntry(
  item: ContextMenuItem,
  path: number[],
  setActivePath: (update: (current: number[]) => number[]) => void
): void {
  if (item.disabled) return
  if (item.submenu) {
    setActivePath((current) => (current.join('/') === path.join('/') ? current : path))
    return
  }
  closeContextMenu()
  item.onSelect?.()
}
