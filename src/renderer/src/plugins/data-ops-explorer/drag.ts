import type { DragEvent } from 'react'
import { call, errorText, getService, log } from '../../workbench/sdk'

/**
 * Files are dragged out through the main process (`webContents.startDrag`),
 * because a DOM drag alone cannot hand files to other applications. The DOM
 * drag is cancelled so the OS drag owns the pointer; in-app targets receive
 * the native file list (`Files`). Directories are not draggable.
 */
export function dragFiles(event: DragEvent, entry: { path: string; isDirectory: boolean }): void {
  if (entry.isDirectory) {
    event.preventDefault()
    return
  }
  const selected =
    getService<{ getSnapshot(): { selected: { path: string; isDirectory: boolean }[] } }>('selection')?.getSnapshot()
      .selected ?? []
  const paths = selected.some((item) => item.path === entry.path)
    ? selected.filter((item) => !item.isDirectory).map((item) => item.path)
    : [entry.path]
  event.preventDefault()
  void call('fileOps', 'startDrag', paths).catch((error) => {
    const message = errorText(error, '拖出文件失败')
    log('warn', 'Explorer', '拖出文件失败', message)
  })
}
