import type { RendererPlugin } from './types'
export { errorText } from './error-text'

export * from './types'
export { useLayout, useLayoutShallow, layoutStore } from './layout'
export { useTheme, themeStore } from './theme'
export { SlotRenderer, useContributions } from './slot-context'
export { getService, listServiceNames } from './services'
export { useLogs, log, logStore } from './logs'
export type { LogCategory, LogEntry, LogInput, LogLevel } from './logs'
export { call, callWithTrace, callValidated, callValidatedWithTrace } from './bridge-api'
export { useRuntimeBridge } from './runtime'
export { useUiKit } from './ui-kit'
export type {
  ActivityButtonProps,
  DesktopButtonProps,
  DesktopCardButtonProps,
  DesktopCardProps,
  DesktopIconButtonProps,
  DesktopInputProps,
  DesktopSelectOption,
  DesktopSelectProps,
  DesktopTextareaProps,
  DesktopTabProps,
  DesktopTagPillProps,
  FloatingPanelTab,
  SidebarTabDescriptor,
  ThemeCollapsibleSectionProps,
  ThemeFloatingPanelProps,
  ThemeSidebarPanelProps,
  ThemeWorkspacePanelProps,
  UiKit
} from './ui-kit'
export { useBridge } from '../bridge'
export type { Bridge } from '../bridge'

export function definePlugin(plugin: RendererPlugin): RendererPlugin {
  return plugin
}
