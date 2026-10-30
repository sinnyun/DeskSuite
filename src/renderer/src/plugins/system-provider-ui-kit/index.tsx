import { definePlugin } from '../../workbench/sdk'
import { uiKit } from './kit'

export default definePlugin({
  id: 'system-provider-ui-kit',
  name: '公共 UI 原语',
  version: '1.0.0',
  description: '向其他渲染层插件提供按钮、输入、下拉、页签、标签、侧栏/工作区/悬浮面板等主题化 UI 原语',
  author: 'DeskSuite 内置',
  core: true,
  services: {
    ui: uiKit
  }
})
