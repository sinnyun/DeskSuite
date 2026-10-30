import { createContext, Fragment, useContext, useMemo } from 'react'
import type { ComponentType, ReactElement, ReactNode } from 'react'
import type { SlotContribution, SlotId } from './types'

interface SlotContextValue {
  contributions: SlotContribution[]
}

const SlotContext = createContext<SlotContextValue>({ contributions: [] })

export function SlotProvider({
  contributions,
  children
}: {
  contributions: SlotContribution[]
  children: ReactNode
}): ReactElement {
  const value = useMemo(() => ({ contributions }), [contributions])
  return <SlotContext.Provider value={value}>{children}</SlotContext.Provider>
}

function useSlotContributions(): SlotContribution[] {
  return useContext(SlotContext).contributions
}

export function useContributions(slotId: SlotId): SlotContribution[] {
  const contributions = useSlotContributions()
  return useMemo(
    () =>
      contributions
        .filter((contribution) => contribution.slotId === slotId)
        .sort((a, b) => (a.order ?? 100) - (b.order ?? 100)),
    [contributions, slotId]
  )
}

interface SlotRendererProps {
  slotId: SlotId
  only?: string
  fallback?: ReactNode
  props?: Record<string, unknown>
  className?: string
}

export function SlotRenderer({
  slotId,
  only,
  fallback = null,
  props,
  className
}: SlotRendererProps): ReactElement | null {
  const contributions = useContributions(slotId)
  const items = relevantContributions(contributions, only)

  if (items.length === 0) {
    return fallback ? <>{fallback}</> : null
  }

  const rendered = items.map((contribution) => {
    const Component = contribution.component as ComponentType<Record<string, unknown>>
    return (
      <Fragment key={contribution.id}>
        <Component {...(props ?? {})} />
      </Fragment>
    )
  })

  return className ? <div className={className}>{rendered}</div> : <>{rendered}</>
}

export function relevantContributions(
  contributions: SlotContribution[],
  only?: string
): SlotContribution[] {
  return contributions.filter(
    (contribution) => contribution.component && (!only || contribution.id === only)
  )
}
