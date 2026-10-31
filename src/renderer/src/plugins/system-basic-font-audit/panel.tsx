import { useEffect, useState } from 'react'
import type { ReactElement } from 'react'
import { Eye, Type } from 'lucide-react'
import { useLayoutShallow, useTheme, useUiKit } from '../../workbench/sdk'
import { AUDIT_LEVELS, isFontAuditEnabled, setFontAuditEnabled } from './state'

export function FontAuditActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel, openFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel, openFloatingPanel: state.openFloatingPanel }))
  const active = floatingPanelOpen && activeFloatingPanel === 'font-audit'
  return <ActivityButton icon={<Type className="h-4 w-4" />} label="字体审查" active={active} tooltip="检查主题排版角色与语义文字颜色" onClick={() => active ? closeFloatingPanel() : openFloatingPanel('font-audit')} />
}

const TYPE_ROLES = [
  { id: 'page-title', name: '页面标题', size: '24 px', use: '页面主标题', className: 'ds-type-page-title' },
  { id: 'panel-title', name: '面板标题', size: '20 px', use: '浮动面板与侧栏标题', className: 'ds-type-panel-title' },
  { id: 'title', name: '内容标题', size: '18 px', use: '文档与卡片内标题', className: 'ds-type-title' },
  { id: 'section-title', name: '分区标题', size: '16 px', use: '内容分区与卡片标题', className: 'ds-type-section-title' },
  { id: 'body', name: '正文', size: '14 px', use: '说明、段落与主要内容', className: 'ds-type-body' },
  { id: 'label', name: '标签', size: '13 px', use: '表单标签、页签与紧凑操作', className: 'ds-type-label' },
  { id: 'meta', name: '辅助信息', size: '12 px', use: '路径、时间、计数与补充说明', className: 'ds-type-meta' },
  { id: 'data', name: '数据', size: '12 px', use: '紧凑数值与表格数据', className: 'ds-type-data' },
  { id: 'control', name: '控件文字', size: '12–14 px', use: '按钮、输入框与选择器', className: 'ds-type-label' }
] as const

function useTypographyCoverage(): { counts: Record<string, number>; unmarked: number; mismatched: number; mismatchGroups: Record<string, number> } {
  const [coverage, setCoverage] = useState<{ counts: Record<string, number>; unmarked: number; mismatched: number; mismatchGroups: Record<string, number> }>({ counts: {}, unmarked: 0, mismatched: 0, mismatchGroups: {} })

  useEffect(() => {
    const scan = (): void => {
      const counts: Record<string, number> = Object.fromEntries(TYPE_ROLES.map((role) => [role.id, 0]))
      let unmarked = 0
      let mismatched = 0
      const mismatchGroups: Record<string, number> = {}
      document.querySelectorAll('body *').forEach((element) => {
        if (element.children.length || !element.textContent?.trim()) return
        if (element.closest('.font-audit-panel')) return
        if (element.closest('[data-whiteboard-id]')) return
        const style = getComputedStyle(element)
        if (style.display === 'none' || style.visibility === 'hidden' || element.getClientRects().length === 0) return
        const explicitRole = element.closest<HTMLElement>('[data-ds-type]')?.dataset.dsType
        const heading = element.closest('h1, h2, h3, h4, h5, h6, p, label, small')?.tagName.toLowerCase()
        const semanticRole = heading === 'h1' ? 'page-title' : heading === 'h2' ? 'panel-title' : heading === 'h3' ? 'title' : heading === 'h4' ? 'section-title' : ['h5', 'h6'].includes(heading ?? '') ? 'label' : heading === 'label' ? 'label' : heading === 'small' ? 'meta' : undefined
        const fontSize = Number.parseFloat(style.fontSize)
        const control = element.closest('button, input, select, textarea')
        const measuredRole = control ? 'control' : fontSize >= 23 ? 'page-title' : fontSize >= 19 ? 'panel-title' : fontSize >= 17 ? 'title' : fontSize >= 15.5 ? 'section-title' : fontSize >= 13.5 ? 'body' : fontSize >= 12.5 ? 'label' : fontSize >= 11.5 ? (style.fontVariantNumeric !== 'normal' || style.fontFamily.includes('mono') ? 'data' : 'meta') : undefined
        const role = explicitRole ?? semanticRole ?? measuredRole
        const roleDefinition = TYPE_ROLES.find((candidate) => candidate.id === role)
        if ((explicitRole || semanticRole) && roleDefinition && roleDefinition.id !== 'control' && fontSize !== Number.parseFloat(roleDefinition.size)) {
          mismatched += 1
          const typographyClass = typeof element.className === 'string' ? element.className.split(' ').filter((token) => token.startsWith('text-') || token.startsWith('ds-type-')).join('+') : ''
          const key = `${roleDefinition.id}/${element.tagName.toLowerCase()}/${fontSize}px/${typographyClass}`
          mismatchGroups[key] = (mismatchGroups[key] ?? 0) + 1
        }
        if (role && role in counts) counts[role] += 1
        else unmarked += 1
      })
      const next = { counts, unmarked, mismatched, mismatchGroups }
      setCoverage((current) => JSON.stringify(current) === JSON.stringify(next) ? current : next)
    }
    scan()
    const observer = new MutationObserver(scan)
    observer.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ['data-ds-type', 'class', 'style'] })
    return () => observer.disconnect()
  }, [])

  return coverage
}

export function FontAuditPanel(): ReactElement {
  const { ThemeFloatingPanel, DesktopButton, DesktopTab } = useUiKit()
  const { floatingPanelOpen, activeFloatingPanel, closeFloatingPanel } = useLayoutShallow((state) => ({ floatingPanelOpen: state.floatingPanelOpen, activeFloatingPanel: state.activeFloatingPanel, closeFloatingPanel: state.closeFloatingPanel }))
  const { isDark } = useTheme()
  const isOpen = floatingPanelOpen && activeFloatingPanel === 'font-audit'
  const [enabled, setEnabled] = useState(isFontAuditEnabled)
  const [view, setView] = useState<'typography' | 'colors'>('typography')
  const typographyCoverage = useTypographyCoverage()

  useEffect(() => {
    const sync = (): void => setEnabled(isFontAuditEnabled())
    window.addEventListener('desksuite:font-audit-change', sync)
    return () => window.removeEventListener('desksuite:font-audit-change', sync)
  }, [])

  function toggle(): void {
    setFontAuditEnabled(!enabled)
    setEnabled(!enabled)
  }

  return <ThemeFloatingPanel title="字体审查" icon={<Eye className="h-3.5 w-3.5" />} badge={enabled ? '审查中' : '已关闭'} isOpen={isOpen} onClose={closeFloatingPanel} initialX={250} initialY={120} initialWidth={420} initialHeight={500} minWidth={380} minHeight={420} className="font-audit-panel">
    <div className="flex h-full min-h-0 flex-col gap-2">
      <section className="shrink-0 rounded-xl border border-[var(--ds-border)] bg-[var(--ds-surface)] p-3">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-2">
            <span className={`flex h-8 w-8 items-center justify-center rounded-lg ${enabled ? 'bg-[var(--ds-status-success-soft)] text-[var(--ds-status-success)]' : 'bg-[var(--ds-surface-muted)] text-[var(--ds-text-muted)]'}`}><Eye className="h-4 w-4" /></span>
            <div><h3 data-ds-type="section-title" className="ds-type-section-title">颜色语义检查</h3><p className="mt-0.5 text-xs text-[var(--ds-text-muted)]">{enabled ? '截图审查模式已启用' : '使用当前主题的原有颜色'}</p></div>
          </div>
          <DesktopButton type="button" size="sm" variant={enabled ? 'primary' : 'subtle'} aria-pressed={enabled} onClick={toggle}>{enabled ? '关闭审查' : '开启审查'}</DesktopButton>
        </div>
      </section>
      <div className="flex shrink-0 items-center gap-1 border-b border-[var(--ds-border)] pb-2">
        <DesktopTab label="排版角色" active={view === 'typography'} onClick={() => setView('typography')} />
        <DesktopTab label="颜色语义" active={view === 'colors'} onClick={() => setView('colors')} />
      </div>
      <div className="min-h-0 flex-1 overflow-auto pr-1">
        {view === 'typography' ? <section>
          <div className="mb-2 flex items-center justify-between gap-2"><h3 data-ds-type="section-title" className="ds-type-section-title">主题排版层级</h3><span title={Object.entries(typographyCoverage.mismatchGroups).map(([key, count]) => `${key}×${count}`).join('；') || '字号均匹配'} className="max-w-60 text-right text-xs leading-tight text-[var(--ds-text-muted)]">未匹配 {typographyCoverage.unmarked}{typographyCoverage.mismatched ? ` · ${Object.entries(typographyCoverage.mismatchGroups).slice(0, 2).map(([key, count]) => { const [role, tag, size] = key.split('/'); const roleName = ({ body: '正文', 'page-title': '页面', 'panel-title': '面板', title: '内容', 'section-title': '分区', label: '标签', meta: '辅助', data: '数据', control: '控件' } as Record<string, string>)[role] ?? role; return `${roleName}${size.replace('px', '')}(${tag})×${count}` }).join('、')}` : ' · 字号匹配'}</span></div>
          <div className="space-y-1.5">
            {TYPE_ROLES.map((role) => <div key={role.id} className="flex items-baseline gap-2"><span data-ds-type={role.id} className={`${role.className} min-w-20`}>{role.name}</span><span className="min-w-11 font-mono text-xs text-[var(--ds-text-secondary)]">{role.size}</span><span className="text-xs text-[var(--ds-text-muted)]">{role.use}</span><span className="ml-auto font-mono text-xs text-[var(--ds-text-subtle)]">{typographyCoverage.counts[role.id] ?? 0}</span></div>)}
          </div>
        </section> : <section>
          <div className="mb-2 flex items-center justify-between"><h3 data-ds-type="section-title" className="ds-type-section-title">语义文字颜色</h3><span className="text-xs text-[var(--ds-text-muted)]">颜色角色，不代表字号</span></div>
          <div className="space-y-2">{AUDIT_LEVELS.map((level, index) => <section key={level.token} className="rounded-lg border border-[var(--ds-border)] bg-[var(--ds-surface)] px-3 py-2.5"><div className="flex items-center gap-2.5"><span className="h-3 w-3 shrink-0 rounded-full ring-2 ring-white/70 dark:ring-black/20" style={{ backgroundColor: isDark ? level.dark : level.color }} aria-hidden="true" /><span className="min-w-0 flex-1"><span className="block text-xs font-semibold" style={enabled ? { color: isDark ? level.dark : level.color } : undefined}>{level.name}</span><span className="mt-0.5 block text-xs leading-relaxed text-[var(--ds-text-muted)]">{level.sample}</span></span><span className="font-mono text-xs text-[var(--ds-text-subtle)]">L{index + 1}</span></div></section>)}</div>
        </section>}
      </div>
      <p className="shrink-0 border-t border-[var(--ds-border)] pt-2 text-xs leading-relaxed text-[var(--ds-text-muted)]">L1–L4 表示颜色角色，不是字体大小。审查状态会自动保存，主题切换不会改变图例颜色。</p>
    </div>
  </ThemeFloatingPanel>
}
