import { useEffect, useRef, useState } from 'react'
import type { PointerEvent, ReactElement } from 'react'
import {
  ChevronDown,
  ChevronLeft,
  ChevronRight,
  GripHorizontal,
  Maximize2,
  Minimize2,
  X
} from 'lucide-react'
import type {
  ThemeCollapsibleSectionProps,
  ThemeFloatingPanelProps,
  ThemeSidebarPanelProps,
  ThemeWorkspacePanelProps
} from '../../workbench/sdk'
import { useLayout } from '../../workbench/sdk'
import { DesktopIconButton, DesktopTab } from './components'

function fit(value: number, min: number, max: number): number {
  const upper = Math.max(0, max)
  return Math.max(Math.min(min, upper), Math.min(value, upper))
}

export function ThemeSidebarPanel({
  title,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  collapsed = false,
  onToggleCollapse,
  width = 260,
  side = 'left',
  className = '',
  children,
  footer
}: ThemeSidebarPanelProps): ReactElement | null {
  if (collapsed) return null

  const borderClass =
    side === 'left'
      ? 'border-r border-[var(--ds-border)]'
      : 'border-l border-[var(--ds-border)]'

  return (
    <aside
      data-sidebar={side}
      style={{ width: `${width}px` }}
      className={`h-full bg-[var(--ds-surface)] ${borderClass} flex flex-col select-none shrink-0 overflow-hidden ${className}`}
    >
        <div className="flex items-center justify-between px-3 py-2 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] shrink-0">
        <div className="flex items-center gap-1.5 overflow-x-auto no-scrollbar">
          {tabs && tabs.length > 0 ? (
            tabs.map((tab) => (
              <DesktopTab
                key={tab.id}
                label={tab.title}
                icon={tab.icon}
                badge={tab.badge}
                active={activeTab === tab.id}
                onClick={() => onTabChange?.(tab.id)}
                className="shrink-0"
              />
            ))
          ) : (
              <span data-ds-type="panel-title" className="ds-type-panel-title">{title}</span>
          )}
        </div>

        <div className="flex items-center gap-1">
          {headerActions}
          {onToggleCollapse && (
            <DesktopIconButton
              size="xs"
              onClick={onToggleCollapse}
              tooltip={side === 'left' ? '折叠左侧面板' : '折叠右侧面板'}
              icon={side === 'left' ? (
                <ChevronLeft className="w-3.5 h-3.5" />
              ) : (
                <ChevronRight className="w-3.5 h-3.5" />
              )}
            />
          )}
        </div>
      </div>

        <div className="flex-1 overflow-y-auto overflow-x-hidden min-h-0 bg-[var(--ds-surface-subtle)]">
        {children}
      </div>

      {footer && (
          <div className="shrink-0 p-2 border-t border-[var(--ds-border)] bg-[var(--ds-surface)]">
          {footer}
        </div>
      )}
    </aside>
  )
}

export function ThemeWorkspacePanel({
  toolbar,
  children,
  className = ''
}: ThemeWorkspacePanelProps): ReactElement {
  return (
    <main
      className={`flex-1 flex flex-col min-w-0 min-h-0 bg-[var(--ds-workspace)] overflow-hidden select-none ${className}`}
    >
      {toolbar && (
        <div className="shrink-0 border-b border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-0 z-10">
          {toolbar}
        </div>
      )}
      <div className="flex-1 overflow-auto min-h-0 relative">{children}</div>
    </main>
  )
}

export function ThemeCollapsibleSection({
  title,
  icon,
  defaultOpen = true,
  badge,
  action,
  className = '',
  children
}: ThemeCollapsibleSectionProps): ReactElement {
  const [open, setOpen] = useState(defaultOpen)

  return (
    <div className={`flex flex-col text-xs select-none ${className}`}>
      <div
        onClick={() => setOpen((prev) => !prev)}
        className="flex items-center justify-between px-2 py-1.5 rounded-md font-semibold text-[var(--ds-text-secondary)] dark:text-[var(--ds-text-subtle)] cursor-pointer hover:bg-[var(--ds-surface-muted)] dark:hover:bg-[var(--ds-surface-muted)] hover:text-[var(--ds-text-primary)] transition-colors group"
      >
        <div className="flex items-center gap-1.5 truncate">
          {open ? (
            <ChevronDown className="w-3.5 h-3.5 text-[var(--ds-text-subtle)] group-hover:text-[var(--ds-accent)]" />
          ) : (
            <ChevronRight className="w-3.5 h-3.5 text-[var(--ds-text-subtle)] group-hover:text-[var(--ds-accent)]" />
          )}
          {icon && <span className="shrink-0">{icon}</span>}
          <span data-ds-type="section-title" className="ds-type-section-title truncate">{title}</span>
          {badge !== undefined && (
            <span className="font-mono text-xs text-[var(--ds-text-subtle)] bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] px-1.5 py-0.2 rounded-full">
              {badge}
            </span>
          )}
        </div>

        {action && (
          <div onClick={(event) => event.stopPropagation()} className="shrink-0 flex items-center">
            {action}
          </div>
        )}
      </div>

      {open && <div className="mt-1 flex flex-col gap-1">{children}</div>}
    </div>
  )
}

export function ThemeFloatingPanel({
  title,
  persistenceKey,
  icon,
  badge,
  isOpen,
  onClose,
  initialX = 160,
  initialY = 72,
  initialWidth = 620,
  initialHeight = 470,
  minWidth = 360,
  minHeight = 280,
  tabs,
  activeTab,
  onTabChange,
  headerActions,
  className = '',
  children
}: ThemeFloatingPanelProps): ReactElement | null {
  const geometryKey = `desksuite.ui.floating.${persistenceKey ?? title}`
  const { floatingPanels, setFloatingPanelGeometry } = useLayout()
  const savedGeometry = floatingPanels[geometryKey] ?? {}
  const [size, setSize] = useState(() => ({
    width: fit(savedGeometry.width ?? initialWidth, minWidth, window.innerWidth - 20),
    height: fit(savedGeometry.height ?? initialHeight, minHeight, window.innerHeight - 60)
  }))
  const [position, setPosition] = useState(() => ({
    x: fit(savedGeometry.x ?? initialX, 10, window.innerWidth - size.width - 10),
    y: fit(savedGeometry.y ?? initialY, 48, window.innerHeight - size.height - 10)
  }))
  const [isMaximized, setIsMaximized] = useState(savedGeometry.maximized ?? false)
  const [isDragging, setIsDragging] = useState(false)
  const [isResizing, setIsResizing] = useState(false)
  const dragStartRef = useRef({ x: 0, y: 0, posX: 0, posY: 0 })
  const resizeStartRef = useRef({ x: 0, y: 0, width: 0, height: 0 })

  useEffect(() => {
    setFloatingPanelGeometry(geometryKey, { ...position, ...size, maximized: isMaximized })
  }, [geometryKey, isMaximized, position, size])

  useEffect(() => {
    const fitToViewport = (): void => {
      const nextSize = {
        width: fit(size.width, minWidth, window.innerWidth - 20),
        height: fit(size.height, minHeight, window.innerHeight - 60)
      }
      setSize(nextSize)
      setPosition({
        x: fit(position.x, 10, window.innerWidth - nextSize.width - 10),
        y: fit(position.y, 48, window.innerHeight - nextSize.height - 10)
      })
    }
    window.addEventListener('resize', fitToViewport)
    return () => window.removeEventListener('resize', fitToViewport)
  }, [minHeight, minWidth, position, size])

  if (!isOpen) return null

  const handlePointerDownDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMaximized || event.button !== 0) return
    if ((event.target as HTMLElement).closest('button, input, [role="button"]')) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    dragStartRef.current = { x: event.clientX, y: event.clientY, posX: position.x, posY: position.y }
  }

  const handlePointerMoveDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    const dx = event.clientX - dragStartRef.current.x
    const dy = event.clientY - dragStartRef.current.y
    setPosition({
      x: fit(dragStartRef.current.posX + dx, 10, window.innerWidth - size.width - 10),
      y: fit(dragStartRef.current.posY + dy, 48, window.innerHeight - size.height - 10)
    })
  }

  const handlePointerUpDrag = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 指针捕获可能已被系统释放
    }
    setIsDragging(false)
  }

  const handlePointerDownResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (isMaximized || event.button !== 0) return
    event.stopPropagation()
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsResizing(true)
    resizeStartRef.current = { x: event.clientX, y: event.clientY, width: size.width, height: size.height }
  }

  const handlePointerMoveResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isResizing) return
    const dw = event.clientX - resizeStartRef.current.x
    const dh = event.clientY - resizeStartRef.current.y
    setSize({
      width: fit(resizeStartRef.current.width + dw, minWidth, window.innerWidth - position.x - 10),
      height: fit(resizeStartRef.current.height + dh, minHeight, window.innerHeight - position.y - 10)
    })
  }

  const handlePointerUpResize = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isResizing) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 指针捕获可能已被系统释放
    }
    setIsResizing(false)
  }

  const panelStyle = isMaximized
    ? { top: '48px', left: '48px', right: '10px', bottom: '32px', width: 'auto', height: 'auto' }
    : {
        top: `${position.y}px`,
        left: `${position.x}px`,
        width: `${size.width}px`,
        height: `${size.height}px`
      }

  return (
    <div
      style={panelStyle}
      className={`fixed z-50 flex flex-col rounded-2xl bg-[var(--ds-surface)] border border-[var(--ds-border)] shadow-xl overflow-hidden select-none ${className}`}
    >
      <div
        onPointerDown={handlePointerDownDrag}
        onPointerMove={handlePointerMoveDrag}
        onPointerUp={handlePointerUpDrag}
        className="h-10 px-3.5 border-b border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface-subtle)] dark:bg-[var(--ds-surface-raised)] flex items-center justify-between cursor-move shrink-0"
      >
        <div className="flex items-center gap-2 min-w-0">
          <GripHorizontal className="w-3.5 h-3.5 text-[var(--ds-text-subtle)] opacity-60" />
          {icon && <span className="text-[var(--ds-accent)] shrink-0">{icon}</span>}
          <span data-ds-type="panel-title" className="ds-type-panel-title truncate">{title}</span>
          {badge && (
            <span className="px-2 py-0.5 rounded-full text-xs font-semibold bg-[var(--ds-accent-soft)] text-[var(--ds-accent)] dark:bg-[var(--ds-accent-soft)] dark:text-[var(--ds-accent-strong)] border border-[var(--ds-accent)]/20">
              {badge}
            </span>
          )}
        </div>

        <div className="flex items-center gap-1.5 shrink-0">
          {headerActions}
          <DesktopIconButton size="sm" aria-label={isMaximized ? '还原悬浮面板' : '最大化悬浮面板'} tooltip={isMaximized ? '还原窗口' : '最大化窗口'} onClick={(event) => { event.stopPropagation(); setIsMaximized((prev) => !prev) }} className="shrink-0" icon={isMaximized ? <Minimize2 className="w-3 h-3" /> : <Maximize2 className="w-3 h-3" />} />
          <DesktopIconButton size="sm" variant="danger" aria-label="关闭悬浮面板" tooltip="关闭悬浮面板" onClick={(event) => { event.stopPropagation(); onClose() }} className="shrink-0" icon={<X className="w-3.5 h-3.5" />} />
        </div>
      </div>

      {tabs && tabs.length > 0 && (
        <div className="flex items-center gap-1 px-3 py-1.5 border-b border-[var(--ds-border)] dark:border-[var(--ds-border)] bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-dark)] overflow-x-auto no-scrollbar shrink-0">
          {tabs.map((tab) => (
            <DesktopTab
              key={tab.id}
              tone="solid"
              label={tab.label}
              icon={tab.icon}
              active={activeTab === tab.id}
              onClick={() => onTabChange?.(tab.id)}
              className="shrink-0"
            />
          ))}
        </div>
      )}

      <div className="flex-1 overflow-auto min-h-0 relative p-3">{children}</div>

      {!isMaximized && (
        <div
          onPointerDown={handlePointerDownResize}
          onPointerMove={handlePointerMoveResize}
          onPointerUp={handlePointerUpResize}
          className="absolute right-0 bottom-0 w-4 h-4 cursor-nwse-resize flex items-end justify-end p-0.5 text-[var(--ds-text-subtle)] hover:text-[var(--ds-accent)]"
          title="拖动调整面板大小"
        >
          <svg className="w-3 h-3 fill-current opacity-60" viewBox="0 0 10 10">
            <path
              d="M9 1L1 9M9 5L5 9M9 9L9 9"
              stroke="currentColor"
              strokeWidth="1.5"
              strokeLinecap="round"
            />
          </svg>
        </div>
      )}
    </div>
  )
}
