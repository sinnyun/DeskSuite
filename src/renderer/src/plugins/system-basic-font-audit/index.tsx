import { definePlugin } from '../../workbench/sdk'
import { FontAuditActivity, FontAuditPanel } from './panel'
import { activateFontAudit } from './state'

export default definePlugin({
  id: 'system-basic-font-audit',
  name: '字体审查',
  version: '1.0.0',
  description: '以固定颜色检查语义文字角色，并统计主题排版角色覆盖情况',
  author: 'DeskSuite 内置',
  contributions: [
    { id: 'font-audit.open', slotId: 'sidebar.activity.bottom', order: 85, component: FontAuditActivity },
    { id: 'font-audit.panel', slotId: 'floating.panels', order: 85, component: FontAuditPanel }
  ],
  setup: activateFontAudit
})
