import { call } from '../../workbench/sdk'

const TYPE_SIZE_VARS: Record<string, string> = {
  pageTitle: '--ds-type-page-title',
  panelTitle: '--ds-type-panel-title',
  title: '--ds-type-title',
  sectionTitle: '--ds-type-section-title',
  body: '--ds-type-body',
  label: '--ds-type-label',
  data: '--ds-type-data'
}

export function applyFontSize(fontSize: unknown): void {
  if (typeof fontSize !== 'object' || fontSize === null || Array.isArray(fontSize)) return
  const source = fontSize as Record<string, unknown>
  for (const [key, variable] of Object.entries(TYPE_SIZE_VARS)) {
    const value = source[key]
    if (typeof value === 'number' && Number.isInteger(value) && value >= 10 && value <= 32) {
      document.documentElement.style.setProperty(variable, `${value}px`)
    }
  }
}

export function bootstrapAppearance(): () => void {
  let disposed = false
  const off = window.bridge.onEvent((channel, payload) => {
    if (channel !== 'settings:changed') return
    const event = payload as { namespace?: string; value?: Record<string, unknown> } | undefined
    if (event?.namespace === 'appearance') applyFontSize(event.value?.fontSize)
  })
  void call<Record<string, unknown>>('settings', 'get', 'appearance')
    .then((value) => { if (!disposed) applyFontSize(value.fontSize) })
    .catch(() => { /* 设置服务不可用时保持 CSS 默认字号 */ })
  return () => {
    disposed = true
    off()
    for (const variable of Object.values(TYPE_SIZE_VARS)) document.documentElement.style.removeProperty(variable)
  }
}

export function readTypeSizes(): Record<string, number> {
  const computed = getComputedStyle(document.documentElement)
  const result: Record<string, number> = {}
  for (const [key, variable] of Object.entries(TYPE_SIZE_VARS)) {
    const parsed = Number.parseFloat(computed.getPropertyValue(variable))
    if (Number.isFinite(parsed)) result[key] = parsed
  }
  return result
}
