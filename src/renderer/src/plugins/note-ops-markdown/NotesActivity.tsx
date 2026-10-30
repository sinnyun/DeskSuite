import type { ReactElement } from 'react'
import { NotebookPen } from 'lucide-react'
import { useLayout, useUiKit } from '../../workbench/sdk'

export function NotesActivity(): ReactElement {
  const { ActivityButton } = useUiKit()
  const { activeFloatingPanel, toggleFloatingPanel } = useLayout()
  const active = activeFloatingPanel === 'notes'
  return <ActivityButton icon={<NotebookPen className="w-4 h-4" />} label="笔记" active={active} onClick={() => toggleFloatingPanel('notes')} />
}
