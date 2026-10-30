#!/usr/bin/env node
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpText } from './common.mjs'

await mcpHandshake()
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(mcpText(result) || `${name} failed`)
  return JSON.parse(mcpText(result) || 'null')
}
const groups = [
  '设计与工程', '开发与数据', '办公与阅读', '文件与云服务',
  '网络与通讯', '媒体与娱乐', '系统与安全', '其他程序'
]
const current = await call('launcher_groups')
const byName = new Map(current.groups.map((group) => [group.name, group.id]))
for (const name of groups) {
  if (!byName.has(name)) {
    const created = await call('launcher_group_create', { name })
    for (const group of created) byName.set(group.name, group.id)
  }
}

const entries = []
for (let offset = 0; ; offset += 250) {
  const page = await call('launcher_list', { offset })
  entries.push(...page)
  if (page.length < 250) break
}

const rules = [
  ['设计与工程', /autodesk|autocad|adobe|photoshop|illustrator|premiere|剪映|剪影|eagle|blender|coreldraw|cad|solidworks|sketchup|rhino|davinci|render|font|字库|设计|绘图|建模|工程|材质/i],
  ['开发与数据', /visual studio|vs code|vscode|node\.js|python|rust|git|github|docker|postman|terminal|powershell|command prompt|nsight|cuda|数据库|开发|调试|代码|程序员|编译|sdk/i],
  ['办公与阅读', /microsoft office|word|excel|powerpoint|onenote|wps|pdf|acrobat|notepad|notepad2|obsidian|阅读|笔记|文档|文本|office|outlook|foxit/i],
  ['文件与云服务', /7-zip|winrar|bandizip|everything|explorer|百度网盘|百度云|onedrive|坚果云|nutstore|dropbox|夸克网盘|云盘|备份|文件管理|压缩/i],
  ['网络与通讯', /chrome|edge|firefox|browser|微信|wechat|qq|钉钉|飞书|teams|zoom|telegram|discord|网络|路由|vpn|remote desktop|远程/i],
  ['媒体与娱乐', /steam|battle\.net|battlenet|diablo|暗黑|游戏|douyu|斗鱼|bilibili|哔哩|vlc|播放器|音乐|影音|moonlight|epic games|网易云|spotify/i],
  ['系统与安全', /huorong|火绒|nvidia|驱动|安全|defender|windows|设备|控制面板|设置|更新|诊断|monitor|管理器|narrator|keyboard|accessibility|odbc/i]
]
const classify = (entry) => rules.find(([_, pattern]) => pattern.test(`${entry.name} ${entry.publisher ?? ''} ${entry.path}`))?.[0] ?? '其他程序'
const descriptionFor = (entry, group) => {
  const existing = entry.description?.trim()
  if (existing && !/^启动\s*.+\.exe$/i.test(existing)) return existing
  const pub = entry.publisher?.trim()
  const lead = pub ? `${pub} 的` : '系统中的'
  const purposes = {
    '设计与工程': '用于设计、绘图、建模或素材制作',
    '开发与数据': '用于软件开发、数据处理或开发环境管理',
    '办公与阅读': '用于办公、文档处理、笔记或内容阅读',
    '文件与云服务': '用于文件管理、压缩、同步或云端存储',
    '网络与通讯': '用于网页浏览、网络连接或即时通讯',
    '媒体与娱乐': '用于媒体播放、内容创作或娱乐',
    '系统与安全': '用于系统管理、设备维护或安全防护',
    '其他程序': '已安装或可从开始菜单启动的程序'
  }
  return `${lead}${entry.name}，${purposes[group]}。`
}
const titleFor = (entry) => {
  const title = entry.name.trim()
  return title.replace(/\s+\((?:x64|x86|64-bit|32-bit)\)$/i, '').replace(/\s+(?:版本\s*)?\d+(?:\.\d+){1,4}$/i, '').trim()
}

const report = { total: entries.length, changed: 0, categories: {}, failures: [] }
for (const entry of entries) {
  const group = classify(entry)
  const description = descriptionFor(entry, group)
  report.categories[group] = (report.categories[group] ?? 0) + 1
  try {
    await call('launcher_program_update', {
      id: entry.id,
      groupId: byName.get(group),
      ...(titleFor(entry) !== entry.name ? { title: titleFor(entry) } : {}),
      ...(!entry.description?.trim() || /^启动\s*.+\.exe$/i.test(entry.description) ? { description } : {})
    })
    report.changed += 1
  } catch (error) {
    report.failures.push({ id: entry.id, name: entry.name, error: error.message })
  }
}

const verify = []
for (let offset = 0; offset < entries.length; offset += 250) verify.push(...await call('launcher_list', { offset }))
report.persisted = verify.length
report.assigned = verify.filter((entry) => entry.groupId).length
report.descriptions = verify.filter((entry) => entry.description).length
writeFileSync(join(ensureOutDir(), 'launcher-organize.json'), JSON.stringify(report, null, 2))
console.log(JSON.stringify(report, null, 2))
if (report.failures.length) process.exitCode = 1
