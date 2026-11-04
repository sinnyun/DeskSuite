import type { UiKit } from '../../workbench/sdk'
import {
  DesktopButton,
  DesktopCard,
  DesktopCardButton,
  DesktopIconButton,
  DesktopInput,
  DesktopSelect,
  DesktopTab,
  DesktopTagPill,
  DesktopTextarea
} from './components'
import {
  ThemeCollapsibleSection,
  ThemeFloatingPanel,
  ThemeSidebarPanel,
  ThemeWorkspacePanel
} from './panels'
import { ActivityButton } from './activity'
import { openPrompt } from './dialogs'

export const uiKit: UiKit = {
  DesktopButton,
  DesktopIconButton,
  DesktopInput,
  DesktopTextarea,
  DesktopCard,
  DesktopCardButton,
  DesktopTagPill,
  DesktopTab,
  DesktopSelect,
  ActivityButton,
  ThemeSidebarPanel,
  ThemeWorkspacePanel,
  ThemeCollapsibleSection,
  ThemeFloatingPanel,
  prompt: openPrompt
}
