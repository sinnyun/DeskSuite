import { layoutStore, themeStore } from '../../workbench/sdk'
import type { ContextMenuEntry } from '../../workbench/sdk'

export const TEXT_MENU_ZONE = '__text'
export const DESKTOP_MENU_ZONE = '__desktop'

export function isEditableTarget(target: Element): boolean {
  if (!(target instanceof HTMLElement)) return false
  if (target.isContentEditable) return true
  return /^(INPUT|TEXTAREA)$/.test(target.tagName)
}

function hasSelection(target: Element): boolean {
  if (target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement) {
    return target.selectionStart !== target.selectionEnd
  }
  const selection = window.getSelection()
  return Boolean(selection && !selection.isCollapsed && selection.containsNode(target, true))
}

export function textMenuEntries(target: Element): ContextMenuEntry[] {
  const editable = target as HTMLElement
  const isTextfield = target instanceof HTMLInputElement || target instanceof HTMLTextAreaElement
  const selected = hasSelection(target)
  const focus = (): void => editable.focus()
  return [
    {
      id: 'cut',
      label: '剪切',
      shortcut: 'Ctrl+X',
      disabled: !selected,
      onSelect: () => {
        focus()
        document.execCommand('cut')
      }
    },
    {
      id: 'copy',
      label: '复制',
      shortcut: 'Ctrl+C',
      disabled: !selected,
      onSelect: () => {
        focus()
        document.execCommand('copy')
      }
    },
    {
      id: 'paste',
      label: '粘贴',
      shortcut: 'Ctrl+V',
      onSelect: () => {
        focus()
        void navigator.clipboard
          .readText()
          .then((text) => {
            if (!text) return
            if (!document.execCommand('insertText', false, text) && isTextfield) {
              const field = editable as HTMLInputElement | HTMLTextAreaElement
              const start = field.selectionStart ?? field.value.length
              field.setRangeText(text, start, field.selectionEnd ?? start, 'end')
              field.dispatchEvent(new Event('input', { bubbles: true }))
            }
          })
          .catch(() => {})
      }
    },
    { separator: true },
    {
      id: 'selectAll',
      label: '全选',
      shortcut: 'Ctrl+A',
      onSelect: () => {
        focus()
        if (isTextfield) (editable as HTMLInputElement | HTMLTextAreaElement).select()
        else document.execCommand('selectAll')
      }
    }
  ]
}

export function desktopMenuEntries(): ContextMenuEntry[] {
  const layout = layoutStore.getState()
  return [
    {
      id: 'command-palette',
      label: '命令面板',
      shortcut: 'Ctrl+K',
      onSelect: () => layoutStore.getState().openFloatingPanel('commands')
    },
    {
      id: 'open-settings',
      label: '打开设置',
      shortcut: 'Ctrl+,',
      onSelect: () => layoutStore.getState().openFloatingPanel('settings')
    },
    {
      id: 'open-launcher',
      label: '打开启动台',
      shortcut: 'Ctrl+Shift+P',
      onSelect: () => layoutStore.getState().openFloatingPanel('launcher')
    },
    {
      id: 'open-clipboard',
      label: '打开剪贴板',
      onSelect: () => layoutStore.getState().openFloatingPanel('clipboard')
    },
    { separator: true },
    {
      id: 'toggle-theme',
      label: '切换明暗主题',
      shortcut: 'Ctrl+Shift+L',
      checked: themeStore.getState().mode === 'dark',
      onSelect: () => themeStore.getState().setMode(themeStore.getState().mode === 'dark' ? 'light' : 'dark')
    },
    {
      id: 'toggle-zen',
      label: '切换专注模式',
      shortcut: 'F11',
      checked: layout.zenMode,
      onSelect: () => layoutStore.getState().toggleZenMode()
    },
    {
      id: 'reset-layout',
      label: '重置工作台布局',
      shortcut: 'Ctrl+Alt+R',
      onSelect: () => layoutStore.getState().resetLayout()
    }
  ]
}
