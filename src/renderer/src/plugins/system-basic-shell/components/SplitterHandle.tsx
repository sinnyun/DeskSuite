import { useRef, useState } from 'react'
import type { PointerEvent, ReactElement, ReactNode } from 'react'
import { useUiKit } from '../../../workbench/sdk'

interface SplitterHandleProps {
  direction: 'horizontal' | 'vertical'
  onResize: (delta: number) => void
  onReset?: () => void
  onToggleCollapse?: () => void
  collapseIcon?: ReactNode
  collapseTitle?: string
  label?: string
}

export function SplitterHandle({
  direction,
  onResize,
  onReset,
  onToggleCollapse,
  collapseIcon,
  collapseTitle = '收起相邻面板',
  label
}: SplitterHandleProps): ReactElement {
  const { DesktopIconButton } = useUiKit()
  const [isDragging, setIsDragging] = useState(false)
  const startPosRef = useRef(0)
  const isColumn = direction === 'vertical'

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>): void => {
    if (event.button !== 0) return
    event.currentTarget.setPointerCapture(event.pointerId)
    setIsDragging(true)
    startPosRef.current = isColumn ? event.clientX : event.clientY
  }

  const handlePointerMove = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    const current = isColumn ? event.clientX : event.clientY
    const delta = current - startPosRef.current
    if (delta !== 0) {
      onResize(delta)
      startPosRef.current = current
    }
  }

  const handlePointerUp = (event: PointerEvent<HTMLDivElement>): void => {
    if (!isDragging) return
    try {
      event.currentTarget.releasePointerCapture(event.pointerId)
    } catch {
      // 指针捕获可能已被系统释放
    }
    setIsDragging(false)
  }

  return (
    <div
      role="separator"
      tabIndex={0}
      aria-orientation={isColumn ? 'vertical' : 'horizontal'}
      title={label || (isColumn ? '双击恢复默认宽度，拖动调整大小' : '双击恢复默认高度，拖动调整大小')}
      onPointerDown={handlePointerDown}
      onPointerMove={handlePointerMove}
      onPointerUp={handlePointerUp}
      onDoubleClick={onReset}
      className={`group relative select-none transition-colors duration-150 z-20 ${
        isColumn ? 'w-1.5 cursor-col-resize flex flex-col items-center justify-center' : 'h-1.5 cursor-row-resize flex items-center justify-center'
      } ${isDragging ? 'bg-[var(--ds-accent)]' : 'bg-[var(--ds-border)] dark:bg-[var(--ds-border)] hover:bg-[var(--ds-accent)]/80'}`}
    >
      <div
        className={`pointer-events-none rounded-full transition-opacity ${
          isColumn ? 'w-0.5 h-6' : 'h-0.5 w-6'
        } ${
          isDragging
            ? 'bg-[var(--ds-surface)] opacity-100'
            : 'bg-[var(--ds-text-subtle)] dark:bg-[var(--ds-text-muted)] opacity-60 group-hover:opacity-100 group-hover:bg-[var(--ds-surface)]'
        }`}
      />

      {onToggleCollapse && (
        <DesktopIconButton
          size="xs"
          variant="default"
          icon={collapseIcon}
          title={collapseTitle}
          onPointerDown={(event) => event.stopPropagation()}
          onClick={(event) => {
            event.stopPropagation()
            onToggleCollapse()
          }}
          className={`absolute z-30 opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 ${
            isColumn ? 'top-1/2 -translate-y-1/2' : 'left-1/2 -translate-x-1/2'
          }`}
        />
      )}
    </div>
  )
}
