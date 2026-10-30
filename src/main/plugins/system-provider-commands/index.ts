import type { Context, Plugin } from 'cordis'
import { z } from 'zod'

const plugin: Plugin = {
  name: 'system-provider-commands',
  inject: ['commands', 'ipc'],
  apply(ctx: Context): void {
    const runAction = (action: string) => (_args: Record<string, unknown>, _plan?: unknown, origin?: 'ui' | 'mcp') => {
      if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action })
      return { action }
    }
    const mutating = { mutating: true, impact: 'low' as const, plan: (args: Record<string, unknown>) => ({ operation: '界面操作', args }) }
    const panelIds = ['analytics', 'basket', 'clipboard', 'commands', 'font-audit', 'global-search', 'launcher', 'notes', 'resources', 'settings', 'updater', 'whiteboard', 'workcrate'] as const
    ctx.commands.register({ id: 'ui.open-panel', title: '打开工作台面板', group: '界面', description: '打开已注册的工作台浮动面板', ...mutating, inputSchema: z.object({ panel: z.enum(panelIds) }), run: (args, _plan, origin) => { const action = `panel.open:${String(args.panel)}`; if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action }); return { action, panel: args.panel } } })
    ctx.commands.register({ id: 'ui.close-panel', title: '关闭工作台面板', group: '界面', description: '关闭当前浮动面板', ...mutating, run: runAction('panel.close') })
    ctx.commands.register({ id: 'ui.toggle-floating-panel', title: '切换悬浮工作台', group: '界面', description: '切换指定或当前浮动面板', ...mutating, inputSchema: z.object({ panel: z.enum(panelIds).optional() }), run: (args, _plan, origin) => { const action = args.panel ? `floating.toggle:${String(args.panel)}` : 'floating.toggle'; if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action }); return { action } } })
    ctx.commands.register({ id: 'ui.toggle-panel', title: '切换工作台面板', group: '界面', description: '打开或关闭指定面板', ...mutating, inputSchema: z.object({ panel: z.enum(panelIds) }), run: (args, _plan, origin) => { const action = `panel.toggle:${String(args.panel)}`; if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action }); return { action } } })
    ctx.commands.register({ id: 'ui.open-tab', title: '打开工作台页签', group: '界面', description: '切换左侧栏、右侧栏或底栏页签', ...mutating, inputSchema: z.object({ region: z.enum(['left', 'right', 'bottom']), id: z.string().min(1).max(128) }), run: (args, _plan, origin) => { const action = `tab.open:${String(args.region)}:${String(args.id)}`; if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action }); return { action } } })
    ctx.commands.register({ id: 'ui.toggle-sidebar', title: '切换工作台侧栏', group: '界面', description: '展开或收起指定侧栏', ...mutating, inputSchema: z.object({ region: z.enum(['left', 'right', 'bottom']) }), run: (args, _plan, origin) => { const action = `layout.sidebar.toggle:${String(args.region)}`; if (origin === 'mcp') ctx.ipc.broadcast('commands:action', { action }); return { action } } })
    ctx.commands.register({ id: 'system.toggle-font-audit', title: '切换字体审查', group: '系统', description: '开启或关闭字体层级颜色审查', ...mutating, run: () => { const action = 'font-audit.toggle'; ctx.ipc.broadcast('commands:action', { action }); return { action } } })
    ctx.commands.register({ id: 'system.set-font-audit', title: '设置字体审查', group: '系统', description: '明确开启或关闭字体层级颜色审查', ...mutating, inputSchema: z.object({ enabled: z.boolean() }), run: (args) => { const enabled = args.enabled === true; const action = `font-audit.set:${enabled}`; ctx.ipc.broadcast('commands:action', { action }); return { action, enabled } } })
    const actions: Array<[string, string, string, string?]> = [
      ['ui.toggle-zen-mode', '切换专注模式', 'layout.zen.toggle'], ['ui.reset-layout', '重置工作台布局', 'layout.reset'], ['ui.clear-debug-log', '清空调试日志', 'logs.clear'],
      ['system.reload-renderer', '重新载入界面', 'system.reload-renderer'], ['system.open-settings', '打开设置', 'settings.open', 'Ctrl+,'], ['system.open-launcher', '打开启动台', 'launcher.open', 'Ctrl+Shift+P'],
      ['system.open-clipboard', '打开剪贴板', 'clipboard.open'], ['system.toggle-theme', '切换明暗主题', 'theme.toggle', 'Ctrl+Shift+L']
    ]
    for (const [id, title, action, keybinding] of actions) ctx.commands.register({ id, title, group: id.startsWith('system.') ? '系统' : '界面', description: title, keybinding, ...mutating, run: runAction(action) })
  }
}

export default plugin
