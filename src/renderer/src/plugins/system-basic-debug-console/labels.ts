import type { LogEntry, LogLevel } from '../../workbench/sdk'

const SOURCE_LABELS: Record<string, string> = {
  IPC: '进程通信',
  MCP: 'AI 工具调用',
  Event: '应用事件',
  Runtime: '运行环境',
  Renderer: '界面渲染',
  'Renderer Event': '界面事件',
  Explorer: '文件管理器',
  System: '系统服务',
  'File Operations': '文件操作',
  'Version Manager': '版本管理'
}

const SERVICE_LABELS: Record<string, string> = {
  annotations: '标签与文件信息', basket: '暂存区', canvasInput: '图像输入', clipboard: '剪贴板',
  devLab: '开发诊断', eagleLinks: 'Eagle 连接', fileIcons: '文件图标', fileOps: '文件操作',
  filesystem: '文件与目录', greet: '问候示例', indexScan: '文件索引', launcher: '启动台',
  notePanel: '笔记面板', quickBookmarks: '快速收藏', resources: '资源库', runtime: '运行日志',
  search: '文件搜索', session: '窗口会话', settings: '程序设置', storage: '存储空间',
  thumbnails: '文件缩略图', updater: '程序更新', versions: '文件版本', watch: '文件变更监听',
  whiteboard: '白板', windowControl: '窗口控制', workcrateBoards: '工作台白板',
  workcrateProjects: '工作台项目', workspaces: '工作区'
}

const METHOD_LABELS: Record<string, string> = {
  'annotations.tree': '读取标签目录', 'annotations.forPaths': '批量读取文件标签与评分',
  'basket.get': '读取暂存内容', 'basket.list': '列出暂存内容', 'clipboard.history': '读取剪贴板历史',
  'clipboard.historyImage': '读取剪贴板图片', 'clipboard.groups': '读取剪贴板分组',
  'fileIcons.get': '获取文件图标', 'filesystem.drives': '读取磁盘列表',
  'filesystem.readText': '读取文本预览', 'filesystem.readImage': '读取图片预览', 'filesystem.readMedia': '读取媒体预览',
  'fileOps.getUndoStack': '读取文件操作撤销记录',
  'filesystem.quickAccess': '读取快捷访问位置', 'filesystem.listDir': '读取目录内容',
  'filesystem.listMore': '读取下一页目录内容', 'filesystem.statPaths': '批量读取文件状态',
  'filesystem.getDrivePreferences': '读取磁盘显示设置', 'quickBookmarks.act': '执行快速收藏操作',
  'notePanel.loadPreferences': '读取笔记面板设置',
  'runtime.history': '读取运行记录', 'session.get': '读取窗口会话', 'session.set': '保存窗口会话',
  'thumbnails.get': '生成文件缩略图', 'thumbnails.getMany': '批量生成文件缩略图',
  'versions.list': '读取文件版本列表', 'versions.state': '读取版本状态',
  'versions.branchGraph': '读取版本分支关系', 'versions.preview': '读取版本预览',
  'watch.setPaneDirectories': '更新窗格监听目录', 'watch.clearPane': '清除窗格目录监听',
  'windowControl.state': '读取窗口状态', 'windowControl.toggleMaximize': '切换窗口最大化状态', 'workspaces.list': '读取工作区列表',
  'workspaces.setPane': '保存工作区窗格状态'
}

const TOOL_LABELS: Record<string, string> = {
  capture_screen: '截取整个屏幕', capture_window: '截取应用窗口', clear_runtime_logs: '清空运行日志',
  command_list: '列出可用命令', command_run: '执行应用命令', control_window: '控制应用窗口',
  explorer_drive_preferences: '设置文件浏览器磁盘选项', get_app_info: '读取应用信息',
  get_audit_logs: '读取审计记录', get_job_status: '读取任务状态', get_runtime_logs: '读取运行日志',
  list_directory: '浏览文件夹', list_drives: '列出磁盘', list_windows: '列出应用窗口',
  quick_bookmarks_explorer: '操作文件浏览器', read_text_file: '读取文本文件',
  search_files: '搜索文件', versions_branch_action: '管理版本分支', versions_branch_graph: '查看版本分支',
  versions_create: '创建文件版本', versions_list: '查看文件版本', versions_reconcile: '同步版本记录',
  versions_restore: '恢复文件版本', versions_state: '查看文件版本状态', write_clipboard: '写入剪贴板',
  read_clipboard: '读取剪贴板', note_panel: '操作笔记面板', note_query: '搜索笔记',
  tag_assign: '设置文件标签', tag_create: '创建标签', tag_files: '查找标签关联文件', tag_list: '列出标签',
  meta_favorite: '设置文件收藏', meta_rate: '设置文件评分'
}

const EVENT_LABELS: Record<string, string> = {
  'window:state': '窗口状态变化', 'fs:changed': '文件与目录变化',
  'fs:watch:error': '文件监听异常', 'annotations:changed': '文件标签或评分变化',
  'versions:changed': '文件版本变化', 'commands:action': '应用命令操作',
  'quickBookmarks:explorer': '文件浏览器收藏操作', 'runtime:log': '运行日志更新'
}

const PHASE_LABELS: Record<string, string> = {
  request: '请求', response: '响应', broadcast: '广播', start: '开始', done: '完成',
  error: '失败', ok: '成功', failed: '失败'
}

const LEVEL_LABELS: Record<LogLevel, string> = {
  info: '信息', warn: '警告', error: '错误', event: '事件', lifecycle: '启动'
}

const IDENTIFIER_WORDS: Record<string, string> = {
  get: '获取', read: '读取', list: '列出', query: '查询', search: '搜索', find: '查找',
  set: '设置', save: '保存', update: '更新', create: '新建', add: '添加', remove: '移除', delete: '删除',
  clear: '清空', reset: '重置', open: '打开', close: '关闭', show: '显示', hide: '隐藏', toggle: '切换',
  refresh: '刷新', reload: '重新加载', load: '加载', scan: '扫描', index: '索引', export: '导出', import: '导入',
  write: '写入', copy: '复制', move: '移动', rename: '重命名', trash: '移入回收站', restore: '恢复',
  capture: '截取', control: '控制', select: '选择', switch: '切换', navigate: '导航到', assign: '分配',
  send: '发送', receive: '接收', pick: '选择', choose: '选择', activate: '激活', deactivate: '停用',
  favorite: '收藏', rate: '评分', tag: '标签', tags: '标签', annotation: '批注', annotations: '文件信息',
  file: '文件', files: '文件', directory: '目录', directories: '目录', dir: '目录', path: '路径', paths: '路径',
  drive: '磁盘', drives: '磁盘', quick: '快捷', access: '访问', bookmark: '收藏', bookmarks: '收藏',
  explorer: '文件浏览器', thumbnail: '缩略图', thumbnails: '缩略图', icon: '图标', icons: '图标',
  version: '版本', versions: '版本', branch: '分支', graph: '关系图', state: '状态', status: '状态',
  window: '窗口', windows: '窗口', screen: '屏幕', app: '应用', info: '信息', settings: '设置', preference: '偏好设置', preferences: '偏好设置',
  session: '会话', workspace: '工作区', workspaces: '工作区', pane: '窗格', panel: '面板', page: '页面',
  note: '笔记', notes: '笔记', clipboard: '剪贴板', history: '历史记录', group: '分组', groups: '分组',
  storage: '存储', resource: '资源', resources: '资源', link: '关联', source: '来源', target: '目标',
  job: '任务', task: '任务', audit: '审计', log: '日志', logs: '日志', runtime: '运行时', tool: '工具',
  project: '工程', projects: '工程', workcrate: '工程资料箱', board: '画板', boards: '画板', document: '文档',
  pagecreate: '新增页面', reorder: '重新排序', updateinfo: '更新信息', quickcreate: '快速创建',
  eagle: 'Eagle', whiteboard: '白板', canvas: '画布', image: '图片', text: '文本', media: '媒体', preview: '预览', clipboardimage: '剪贴板图片',
  reopen: '重新打开', closewindow: '关闭窗口', branchgraph: '分支关系', branchaction: '分支操作',
  preferencesget: '读取偏好设置', setpane: '保存窗格状态', setpanedirectories: '设置窗格监听目录',
  getmany: '批量获取', forpaths: '按路径批量获取', quickaccess: '快捷访问', getundostack: '读取撤销记录',
  historyimage: '历史图片', loadpreferences: '读取偏好设置', togglemaximize: '切换最大化状态'
}

function identifierLabel(value: string): string {
  const words = value
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/([A-Z])([A-Z][a-z])/g, '$1 $2')
    .split(/[^a-zA-Z0-9]+/)
    .filter(Boolean)
  if (!words.length) return '相关操作'
  const translated = words.map((word) => IDENTIFIER_WORDS[word.toLowerCase()] ?? '相关')
  return translated.join('')
}

export function sourceLabel(source: string, unknownIndex?: number): string {
  return SOURCE_LABELS[source] ?? (unknownIndex === undefined ? '其他来源' : `其他来源 ${unknownIndex + 1}`)
}

export function phaseLabel(phase: string): string {
  return PHASE_LABELS[phase.toLowerCase()] ?? phase
}

export function levelLabel(level: LogLevel): string {
  return LEVEL_LABELS[level]
}

function serviceLabel(service: string): string {
  return SERVICE_LABELS[service] ?? '其他服务'
}

function methodLabel(service: string, method: string): string {
  return METHOD_LABELS[`${service}.${method}`] ?? identifierLabel(method)
}

function toolLabel(name: string): string {
  return TOOL_LABELS[name] ?? identifierLabel(name)
}

export function formatMessage(message: string): string {
  let match = message.match(/^调用工具\s+([\w.-]+)$/)
  if (match) return `调用 AI 功能：${toolLabel(match[1])}`

  match = message.match(/^工具\s+([\w.-]+)\s+完成（(\d+)ms）$/)
  if (match) return `AI 功能「${toolLabel(match[1])}」执行完成（耗时 ${match[2]} 毫秒）`

  match = message.match(/^工具\s+([\w.-]+)\s+失败(?::\s*(.*))?$/)
  if (match) return `AI 功能「${toolLabel(match[1])}」执行失败${match[2] ? `：${match[2]}` : ''}`

  match = message.match(/^广播\s+([\w:.-]+)$/)
  if (match) return `发送应用事件：${EVENT_LABELS[match[1]] ?? '其他事件'}`

  match = message.match(/^(发送|收到) IPC ([\w.-]+)\.([\w.-]+)(?: 返回)?$/)
  if (match) return `${match[1] === '发送' ? '发送请求' : '收到响应'}：${serviceLabel(match[2])} · ${methodLabel(match[2], match[3])}`

  match = message.match(/^([\w.-]+)\.([\w.-]+)\s+(请求|返回|失败)$/)
  if (match) return `${serviceLabel(match[1])} · ${methodLabel(match[1], match[2])} · ${match[3]}`

  return message
}

function localizePayloadKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(localizePayloadKeys)
  if (!value || typeof value !== 'object') return value
  const record = value as Record<string, unknown>
  const service = typeof record.service === 'string' ? record.service : ''
  const labels: Record<string, string> = {
    action: '操作', args: '参数', channel: '事件', data: '数据', durationMs: '耗时毫秒',
    apiKey: '密钥', error: '错误信息', entries: '文件条目', id: '编号', method: '操作名称', name: '名称',
    path: '路径', paths: '路径列表', payload: '数据内容', phase: '阶段', requestId: '请求编号',
    params: '参数', query: '查询内容', page: '页码', pageSize: '每页数量', result: '处理结果', service: '功能模块', status: '状态', tool: '功能名称', traceId: '调用链编号',
    windowId: '窗口编号', count: '数量', total: '总数', cursor: '分页位置', limit: '分页大小'
  }
  const enumValue = (key: string, item: unknown): unknown => {
    if (typeof item !== 'string') return localizePayloadKeys(item)
    if (key === 'tool') return toolLabel(item)
    if (key === 'service') return serviceLabel(item)
    if (key === 'method') return methodLabel(service, item)
    if (key === 'channel') return EVENT_LABELS[item] ?? '其他事件'
    if (key === 'phase') return phaseLabel(item)
    if (key === 'source') return sourceLabel(item)
    if (key === 'status') return ({ ok: '成功', error: '失败', failed: '失败', running: '进行中', pending: '等待中' } as Record<string, string>)[item] ?? item
    if (key === 'action') return ({ navigate: '导航', select: '选择', view: '切换视图', open: '打开', close: '关闭', restore: '恢复', create: '新建', delete: '删除', clear: '清空' } as Record<string, string>)[item] ?? item
    return localizePayloadKeys(item)
  }
  return Object.fromEntries(Object.entries(record).map(([key, item]) => [labels[key] ?? `扩展字段：${key}`, enumValue(key, item)]))
}

export function formatPayload(entry: LogEntry): string {
  if (entry.payload === undefined || entry.payload === null) return ''
  if (typeof entry.payload === 'string') return entry.payload
  if (typeof entry.payload === 'number' || typeof entry.payload === 'boolean') return String(entry.payload)
  try {
    return JSON.stringify(localizePayloadKeys(entry.payload), null, 2)
  } catch {
    return String(entry.payload)
  }
}

export function searchableLogText(entry: LogEntry): string {
  let rawPayload = ''
  try { rawPayload = JSON.stringify(entry.payload) } catch { /* Keep searching the visible fields. */ }
  return [entry.source, sourceLabel(entry.source), entry.message, formatMessage(entry.message), entry.phase,
    entry.traceId, entry.tags?.join(' '), rawPayload, formatPayload(entry)].filter(Boolean).join(' ').toLowerCase()
}
