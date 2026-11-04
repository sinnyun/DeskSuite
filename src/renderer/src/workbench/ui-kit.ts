import type {
  ButtonHTMLAttributes,
  ComponentType,
  HTMLAttributes,
  InputHTMLAttributes,
  SelectHTMLAttributes,
  TextareaHTMLAttributes,
  MouseEvent as ReactMouseEvent,
  ReactNode
} from 'react'
import type { DesktopPromptOptions } from './types'
import { getService } from './services'

export interface DesktopButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'default' | 'primary' | 'ghost' | 'subtle' | 'danger' | 'pill'
  size?: 'xs' | 'sm' | 'md'
  icon?: ReactNode
  active?: boolean
}

export interface DesktopIconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  icon: ReactNode
  active?: boolean
  variant?: 'default' | 'danger'
  tooltip?: string
  size?: 'xs' | 'sm' | 'md'
}

export interface DesktopInputProps extends InputHTMLAttributes<HTMLInputElement> {
  icon?: ReactNode
  clearable?: boolean
  onClear?: () => void
  shortcutHint?: string
}

export interface DesktopTextareaProps extends TextareaHTMLAttributes<HTMLTextAreaElement> {}

export interface DesktopCardProps extends HTMLAttributes<HTMLDivElement> {
  selected?: boolean
  interactive?: boolean
}

export interface DesktopCardButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  selected?: boolean
}

export interface DesktopTagPillProps {
  label: string
  variant?: 'blue' | 'emerald' | 'amber' | 'rose' | 'neutral'
  className?: string
  onClick?: (event: ReactMouseEvent) => void
}

export interface DesktopTabProps {
  label: ReactNode
  icon?: ReactNode
  badge?: string | number
  active?: boolean
  tone?: 'pill' | 'solid'
  onClick?: () => void
  className?: string
  title?: string
}

export interface DesktopSelectOption {
  value: string
  label: string
}

export interface DesktopSelectProps extends Omit<SelectHTMLAttributes<HTMLSelectElement>, 'value' | 'onChange'> {
  value: string
  options: DesktopSelectOption[]
  onChange: (value: string) => void
  icon?: ReactNode
}

export interface ActivityButtonProps {
  icon: ReactNode
  label: string
  active?: boolean
  badge?: string | number
  tooltip?: string
  onClick?: () => void
}

export interface SidebarTabDescriptor {
  id: string
  title: string
  icon?: ReactNode
  badge?: string | number
}

export interface ThemeSidebarPanelProps {
  title?: string
  tabs?: SidebarTabDescriptor[]
  activeTab?: string
  onTabChange?: (tabId: string) => void
  headerActions?: ReactNode
  collapsed?: boolean
  onToggleCollapse?: () => void
  width?: number
  side?: 'left' | 'right'
  className?: string
  children: ReactNode
  footer?: ReactNode
}

export interface ThemeWorkspacePanelProps {
  toolbar?: ReactNode
  children: ReactNode
  className?: string
}

export interface ThemeCollapsibleSectionProps {
  title: string
  icon?: ReactNode
  defaultOpen?: boolean
  badge?: string | number
  action?: ReactNode
  className?: string
  children: ReactNode
}

export interface FloatingPanelTab {
  id: string
  label: string
  icon?: ReactNode
}

export interface ThemeFloatingPanelProps {
  title: string
  persistenceKey?: string
  icon?: ReactNode
  badge?: string
  isOpen: boolean
  onClose: () => void
  initialX?: number
  initialY?: number
  initialWidth?: number
  initialHeight?: number
  minWidth?: number
  minHeight?: number
  tabs?: FloatingPanelTab[]
  activeTab?: string
  onTabChange?: (tabId: string) => void
  headerActions?: ReactNode
  className?: string
  children: ReactNode
}

export interface UiKit {
  DesktopButton: ComponentType<DesktopButtonProps>
  DesktopIconButton: ComponentType<DesktopIconButtonProps>
  DesktopInput: ComponentType<DesktopInputProps>
  DesktopTextarea: ComponentType<DesktopTextareaProps>
  DesktopCard: ComponentType<DesktopCardProps>
  DesktopCardButton: ComponentType<DesktopCardButtonProps>
  DesktopTagPill: ComponentType<DesktopTagPillProps>
  DesktopTab: ComponentType<DesktopTabProps>
  DesktopSelect: ComponentType<DesktopSelectProps>
  ActivityButton: ComponentType<ActivityButtonProps>
  ThemeSidebarPanel: ComponentType<ThemeSidebarPanelProps>
  ThemeWorkspacePanel: ComponentType<ThemeWorkspacePanelProps>
  ThemeCollapsibleSection: ComponentType<ThemeCollapsibleSectionProps>
  ThemeFloatingPanel: ComponentType<ThemeFloatingPanelProps>
  // Promise 风格输入对话框（Electron 无 window.prompt）；resolve null 表示取消
  prompt(options: DesktopPromptOptions): Promise<string | null>
}

export function useUiKit(): UiKit {
  const kit = getService<UiKit>('ui')
  if (!kit) {
    throw new Error('UI 组件服务未注册：请确认 system-provider-ui-kit 插件已加载')
  }
  return kit
}
