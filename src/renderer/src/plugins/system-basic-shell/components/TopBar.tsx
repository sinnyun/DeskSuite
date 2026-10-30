import { useState } from 'react'
import type { ReactElement } from 'react'
import {
  Layers,
  Moon,
  PanelBottomClose,
  PanelBottomOpen,
  PanelLeftClose,
  PanelLeftOpen,
  PanelRightClose,
  PanelRightOpen,
  RotateCcw,
  SlidersHorizontal,
  Sun
} from 'lucide-react'
import {
  SlotRenderer,
  log,
  logStore,
  useLayout,
  useTheme,
  useUiKit
} from '../../../workbench/sdk'

interface MenuEntry {
  label?: string
  shortcut?: string
  action?: () => void
  divider?: boolean
}

interface MenuGroup {
  id: string
  label: string
  items: MenuEntry[]
}

export function TopBar(): ReactElement {
    const { DesktopButton, DesktopIconButton } = useUiKit()
  const { isDark, setMode } = useTheme()
  const {
    leftCollapsed,
    toggleLeftCollapsed,
    rightCollapsed,
    toggleRightCollapsed,
    bottomCollapsed,
    toggleBottomCollapsed,
    zenMode,
    toggleZenMode,
    resetLayout,
    floatingPanelOpen,
    toggleFloatingPanel,
    openFloatingPanel
  } = useLayout()

  const [activeMenu, setActiveMenu] = useState<string | null>(null)

  const run = (action: () => void): void => {
    action()
    setActiveMenu(null)
  }

  const menus: MenuGroup[] = [
    {
      id: 'file',
      label: '文件(F)',
      items: [
        { label: '新建文件暂存篮', shortcut: 'Alt+2', action: () => openFloatingPanel('basket') },
        { label: '打开剪贴板工作台', shortcut: 'Alt+3', action: () => openFloatingPanel('clipboard') },
        { label: '打开设置与插件管理', shortcut: 'Alt+M', action: () => openFloatingPanel('settings') },
        { divider: true },
        {
          label: '重新载入界面',
          shortcut: 'Ctrl+R',
          action: () => {
            log('event', 'TopBar', '用户重新载入渲染界面')
            window.location.reload()
          }
        }
      ]
    },
    {
      id: 'edit',
      label: '编辑(E)',
      items: [
        {
          label: '清空调试日志',
          action: () => {
            logStore.clear()
            log('lifecycle', 'DebugConsole', '调试日志已清空')
          }
        },
        { label: '偏好与运行环境', shortcut: 'Ctrl+,', action: () => openFloatingPanel('settings') }
      ]
    },
    {
      id: 'view',
      label: '视图(V)',
      items: [
        {
          label: leftCollapsed ? '展开左侧工程栏' : '折叠左侧工程栏',
          shortcut: 'Ctrl+B',
          action: toggleLeftCollapsed
        },
        {
          label: rightCollapsed ? '展开右侧属性面板' : '折叠右侧属性面板',
          shortcut: 'Ctrl+Shift+B',
          action: toggleRightCollapsed
        },
        {
          label: bottomCollapsed ? '展开底部调试控制台' : '折叠底部控制台',
          shortcut: 'Ctrl+J',
          action: toggleBottomCollapsed
        },
        { divider: true },
        {
          label: zenMode ? '退出全屏禅模式' : '进入全屏禅模式',
          shortcut: 'F11',
          action: toggleZenMode
        },
        { label: '重置所有框架到默认布局', shortcut: 'Ctrl+Alt+R', action: resetLayout }
      ]
    },
    {
      id: 'plugins',
      label: '插件(P)',
      items: [
        { label: '切换通用悬浮工作台', shortcut: 'Alt+W', action: () => toggleFloatingPanel() },
        { label: '资产统计分析插件', action: () => openFloatingPanel('analytics') },
        { label: '文件暂存篮插件', action: () => openFloatingPanel('basket') },
        { label: '剪贴板工作台插件', action: () => openFloatingPanel('clipboard') },
        { divider: true },
        { label: '本地插件注册槽管理器', action: () => openFloatingPanel('settings') }
      ]
    },
    {
      id: 'help',
      label: '帮助(H)',
      items: [
        { label: '快捷键与操作指南', shortcut: 'Ctrl+B / J / I', action: () => openFloatingPanel('settings') },
        { label: '插件化架构与槽位开发规范', action: () => openFloatingPanel('settings') },
        { divider: true },
        { label: '关于 DeskSuite 工作台', action: () => openFloatingPanel('settings') }
      ]
    }
  ]

  return (
    <header className="h-11 w-full bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-dark)] border-b border-[var(--ds-border)] dark:border-[var(--ds-border)] flex items-center justify-between px-3 gap-2 select-none z-30 shrink-0 shadow-xs app-drag">
      {activeMenu && (
        <div className="fixed inset-0 z-40" onClick={() => setActiveMenu(null)} />
      )}

      <div className="flex items-center gap-2 min-w-0 app-no-drag">
        <div className="flex items-center gap-2 shrink-0 pr-1">
          <div className="w-7 h-7 rounded-lg bg-[var(--ds-accent)] flex items-center justify-center text-white shadow-xs">
            <Layers className="w-4 h-4" />
          </div>
          <span className="font-bold text-sm tracking-tight text-[var(--ds-text-primary)] dark:text-white">
            DeskSuite
          </span>
        </div>

        <div className="h-4 w-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)] shrink-0" />

        <nav className="flex items-center gap-0.5">
          {menus.map((menu) => (
            <div key={menu.id} className="relative">
              <DesktopButton
                type="button"
                size="xs"
                variant="ghost"
                active={activeMenu === menu.id}
                onClick={() => setActiveMenu(activeMenu === menu.id ? null : menu.id)}
                onMouseEnter={() => {
                  if (activeMenu !== null) setActiveMenu(menu.id)
                }}
                className="px-2.5"
              >
                {menu.label}
              </DesktopButton>

              {activeMenu === menu.id && (
                <div
                  onMouseLeave={() => setActiveMenu(null)}
                  className="absolute left-0 top-full mt-1 w-64 rounded-xl bg-[var(--ds-surface)] dark:bg-[var(--ds-surface-raised)] border border-[var(--ds-border)] dark:border-[var(--ds-border)] shadow-xl p-1 z-50"
                >
                  {menu.items.map((item, index) =>
                    item.divider ? (
                      <div
                        key={`divider-${index}`}
                        className="my-1 border-t border-[var(--ds-surface-muted)] "
                      />
                    ) : (
                      <DesktopButton
                        key={item.label}
                        type="button"
                        size="sm"
                        variant="ghost"
                        onClick={() => item.action && run(item.action)}
                        className="w-full justify-between"
                      >
                        <span className="truncate">{item.label}</span>
                        {item.shortcut && (
                          <span className="text-xs text-[var(--ds-text-subtle)] font-mono shrink-0">
                            {item.shortcut}
                          </span>
                        )}
                      </DesktopButton>
                    )
                  )}
                </div>
              )}
            </div>
          ))}
        </nav>
      </div>

      <div className="flex-1 h-full min-w-0 app-drag" />

      <div className="flex items-center gap-1.5 min-w-0 app-no-drag">
        <SlotRenderer slotId="top.actions" className="flex items-center gap-1.5" />
      </div>

      <div className="flex items-center gap-2 shrink-0 app-no-drag">
          <DesktopButton
            type="button"
            size="xs"
            variant={floatingPanelOpen ? 'primary' : 'default'}
          onClick={() => toggleFloatingPanel()}
          title={floatingPanelOpen ? '关闭通用悬浮面板' : '打开通用悬浮工作台（可拖动、缩放、切换插件）'}
            className="gap-1.5 px-3 font-semibold"
        >
          <SlidersHorizontal className="w-3.5 h-3.5" />
          <span>悬浮面板</span>
          </DesktopButton>

          <DesktopIconButton
          onClick={resetLayout}
            tooltip="重置窗口布局"
            icon={<RotateCcw className="w-3.5 h-3.5" />}
          />

        <div className="flex items-center bg-[var(--ds-surface-muted)] dark:bg-[var(--ds-surface-muted)] p-0.5 rounded-xl border border-[var(--ds-border)] dark:border-[var(--ds-border)]">
          <DesktopIconButton
            size="xs"
            active={!leftCollapsed}
            onClick={toggleLeftCollapsed}
            tooltip={leftCollapsed ? '展开左侧栏' : '折叠左侧栏'}
            icon={leftCollapsed ? <PanelLeftOpen className="w-3.5 h-3.5" /> : <PanelLeftClose className="w-3.5 h-3.5" />}
          />
          <DesktopIconButton
            size="xs"
            active={!bottomCollapsed}
            onClick={toggleBottomCollapsed}
            tooltip={bottomCollapsed ? '展开底部控制台' : '折叠底部控制台'}
            icon={bottomCollapsed ? <PanelBottomOpen className="w-3.5 h-3.5" /> : <PanelBottomClose className="w-3.5 h-3.5" />}
          />
          <DesktopIconButton
            size="xs"
            active={!rightCollapsed}
            onClick={toggleRightCollapsed}
            tooltip={rightCollapsed ? '展开右侧信息栏' : '折叠右侧信息栏'}
            icon={rightCollapsed ? <PanelRightOpen className="w-3.5 h-3.5" /> : <PanelRightClose className="w-3.5 h-3.5" />}
          />
        </div>

          <DesktopIconButton
          onClick={() => setMode(isDark ? 'light' : 'dark')}
            tooltip="切换深浅主题"
            icon={isDark ? <Sun className="w-3.5 h-3.5 text-[var(--ds-status-warning)]" /> : <Moon className="w-3.5 h-3.5 text-[var(--ds-accent)]" />}
          />

        <div className="h-4 w-px bg-[var(--ds-border)] dark:bg-[var(--ds-border)] shrink-0" />

        <SlotRenderer slotId="top.window_controls" />
      </div>
    </header>
  )
}
