import { z } from 'zod'
import { errorText } from '../../workbench/sdk'

const STORAGE_KEY = 'desksuite.workbench.font-audit.enabled'
const STYLE_ID = 'desksuite-font-audit-styles'
const ENABLED_CLASS = 'desksuite-font-audit'

export const AUDIT_LEVELS = [
  { name: '标题与主要文字', token: 'primary', color: '#174dff', dark: '#78a0ff', sample: '页面标题、正文、主要操作' },
  { name: '次要文字', token: 'secondary', color: '#007f9e', dark: '#35d5f4', sample: '说明、次要标签' },
  { name: '辅助文字', token: 'muted', color: '#7a2bdb', dark: '#c28aff', sample: '提示、占位与补充信息' },
  { name: '弱辅助文字', token: 'subtle', color: '#c0188b', dark: '#ff73cf', sample: '低优先级、弱提示' },
  { name: '成功文字', token: 'success', color: '#07833d', dark: '#4fe08b', sample: '成功、完成状态' },
  { name: '警示文字', token: 'warning', color: '#b84a00', dark: '#ffc247', sample: '风险与需要注意的信息' },
  { name: '错误文字', token: 'danger', color: '#c00b3a', dark: '#ff6b8d', sample: '错误、危险操作与失败状态' }
] as const

const SELECTORS = [
  ['primary', '.text-\\[var\\(--ds-text-primary\\)\\]'],
  ['secondary', '.text-\\[var\\(--ds-text-secondary\\)\\]'],
  ['muted', '.text-\\[var\\(--ds-text-muted\\)\\]'],
  ['subtle', '.text-\\[var\\(--ds-text-subtle\\)\\]'],
  ['success', '.text-\\[var\\(--ds-status-success\\)\\]'],
  ['warning', '.text-\\[var\\(--ds-status-warning\\)\\]'],
  ['danger', '.text-\\[var\\(--ds-status-danger\\)\\]']
] as const

function enabledByDefault(): boolean {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    if (saved === null) return false
    const parsed = z.enum(['true', 'false']).safeParse(saved)
    if (!parsed.success) console.warn('[font-audit] Invalid saved preference; using disabled state')
    return parsed.success && parsed.data === 'true'
  } catch (error) {
    console.warn('[font-audit] Could not restore saved preference', errorText(error, '无法读取字体审查设置'))
    return false
  }
}

function ensureStyle(): HTMLStyleElement {
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null
  if (style) return style
  const lightColor = (token: string): string => AUDIT_LEVELS.find((level) => level.token === token)?.color ?? '#174dff'
  const darkColor = (token: string): string => AUDIT_LEVELS.find((level) => level.token === token)?.dark ?? '#78a0ff'
  style = document.createElement('style')
  style.id = STYLE_ID
  style.textContent = [
    `html.${ENABLED_CLASS} { ${AUDIT_LEVELS.map(({ token }) => `--ds-text-${token}: ${lightColor(token)} !important;`).join(' ')} --ds-status-success: ${lightColor('success')} !important; --ds-status-warning: ${lightColor('warning')} !important; --ds-status-danger: ${lightColor('danger')} !important; }`,
    `html.dark.${ENABLED_CLASS} { ${AUDIT_LEVELS.map(({ token }) => `--ds-text-${token}: ${darkColor(token)} !important;`).join(' ')} --ds-status-success: ${darkColor('success')} !important; --ds-status-warning: ${darkColor('warning')} !important; --ds-status-danger: ${darkColor('danger')} !important; }`,
    ...SELECTORS.flatMap(([token, selector]) => {
      const variable = token === 'success' || token === 'warning' || token === 'danger' ? `status-${token}` : `text-${token}`
      return [
        `html.${ENABLED_CLASS} ${selector} { color: var(--ds-${variable}) !important; }`,
        `html.${ENABLED_CLASS} [class*="dark:text-\\[var\\(--ds-${variable}\\)\\]"] { color: var(--ds-${variable}) !important; }`
      ]
    })
  ].join('\n')
  document.head.append(style)
  return style
}

export function isFontAuditEnabled(): boolean {
  return document.documentElement.classList.contains(ENABLED_CLASS)
}

export function setFontAuditEnabled(enabled: boolean): void {
  ensureStyle()
  document.documentElement.classList.toggle(ENABLED_CLASS, enabled)
  try {
    localStorage.setItem(STORAGE_KEY, String(enabled))
  } catch {
    // The preference remains active for this session when browser storage is unavailable.
  }
  window.dispatchEvent(new Event('desksuite:font-audit-change'))
}

export function activateFontAudit(): () => void {
  ensureStyle()
  setFontAuditEnabled(enabledByDefault())
  const unsubscribe = window.bridge.onEvent((channel, payload) => {
    if (channel !== 'commands:action') return
    const action = (payload as { action?: string }).action
    if (action === 'font-audit.toggle') setFontAuditEnabled(!isFontAuditEnabled())
    if (action === 'font-audit.set:true') setFontAuditEnabled(true)
    if (action === 'font-audit.set:false') setFontAuditEnabled(false)
  })
  return () => {
    unsubscribe()
    document.documentElement.classList.remove(ENABLED_CLASS)
    document.getElementById(STYLE_ID)?.remove()
  }
}
