#!/usr/bin/env node
// Debug console view state driven only through DeskSuite MCP: search / source / levels / categories /
// expanded / reset must reach the floating panel, and every memoized counter (level pills, category
// pills, panel summary, statusbar) must stay arithmetically consistent inside one DOM snapshot.
import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText } from './common.mjs'

await mcpHandshake()
const cdp = await connectCdp()
const report = { checkedAt: new Date().toISOString(), checks: [] }
const settle = (ms = 700) => new Promise((resolve) => setTimeout(resolve, ms))

const LEVEL_LABELS = { info: '信息', warn: '警告', error: '错误', event: '事件', lifecycle: '启动' }
const CATEGORY_LABELS = { action: '操作', transfer: '传输', processing: '处理', result: '结果', system: '系统' }

async function callTool(name, args = {}) {
  const result = await mcpCall(name, args)
  if (result?.isError) throw new Error(`${name}: ${mcpText(result)}`)
  return mcpText(result)
}

async function setView(params) {
  return callTool('command_run', { id: 'system.set-debug-console-view', params })
}

// Read-only snapshot: pill active flags, panel counters, control values, rendered rows and the
// statusbar badge all come from one DOM pass, so they can be cross-checked without extra log noise.
function readState() {
  const title = [...document.querySelectorAll('[data-ds-type="panel-title"]')]
    .find((node) => (node.textContent ?? '').includes('程序调试信息'));
  const panel = title ? title.closest('div[class*="z-50"]') : null;
  if (!panel) return null;

  const pills = {};
  for (const button of panel.querySelectorAll('button')) {
    const match = /^(信息|警告|错误|事件|启动|操作|传输|处理|结果|系统)\s*(\d+)$/.exec(button.textContent?.trim() ?? '');
    if (match) pills[match[1]] = { active: button.className.includes('bg-[var(--ds-accent)]'), count: Number(match[2]) };
  }

  const summary = [...panel.querySelectorAll('span')]
    .map((node) => node.textContent?.trim() ?? '')
    .find((text) => /^\d+ 组 \/ \d+ 条$/.test(text));

  const rows = [...panel.querySelectorAll('span.select-text')]
    .filter((node) => /^\d{2}:\d{2}:\d{2}\.\d{3}$/.test(node.textContent?.trim() ?? ''))
    .map((node) => ({
      level: node.nextElementSibling?.textContent?.trim() ?? '',
      source: node.parentElement?.children[2]?.textContent?.trim() ?? ''
    }));

  const traces = [...panel.querySelectorAll('button')]
    .filter((button) => button.title === '展开调用链' || button.title === '折叠调用链')
    .map((button) => {
      const header = button.parentElement;
      const phases = /(\d+) 个阶段/.exec(header?.innerText ?? '');
      const trace = header?.querySelector('span.select-text')?.textContent?.trim() ?? '';
      return { open: button.title === '折叠调用链', phases: phases ? Number(phases[1]) : 0, trace };
    });

  const status = [...document.querySelectorAll('button')]
    .find((button) => button.title === '打开调试控制台');
  const statusSpans = status ? [...status.children].map((node) => node.innerText.trim()) : [];

  return {
    pills,
    groups: summary ? Number(summary.split(' 组')[0]) : null,
    entries: summary ? Number(summary.split('/')[1].trim().split(' ')[0]) : null,
    search: panel.querySelector('input[placeholder^="搜索"]')?.value ?? null,
    source: panel.querySelector('select[aria-label="按来源筛选"]')?.value ?? null,
    hasResetButton: [...panel.querySelectorAll('button')].some((button) => button.title === '重置筛选'),
    emptyState: panel.innerText.includes('没有符合筛选条件的记录'),
    preCount: panel.querySelectorAll('pre').length,
    rows,
    traces,
    statusTotal: statusSpans[0] ?? '',
    statusErrors: statusSpans[1] ?? ''
  };
}

async function snapshot() {
  const state = await cdp.evaluate(`(${readState.toString()})()`);
  assert.ok(state, '程序调试信息 floating panel is not mounted');
  return state;
}

// 广播到达渲染层与日志镜像都有延迟，轮询到条件满足为止；每次轮询只读 DOM，不产生新日志。
async function pollUntil(label, predicate, timeoutMs = 8000) {
  const started = Date.now();
  for (;;) {
    const state = await snapshot();
    if (predicate(state)) return state;
    if (Date.now() - started > timeoutMs) {
      assert.fail(`${label} did not hold within ${timeoutMs}ms; last snapshot ${JSON.stringify(state)}`);
    }
    await settle(250);
  }
}

const sumLevels = (state, levels) => levels.reduce((total, level) => total + (state.pills[LEVEL_LABELS[level]]?.count ?? 0), 0);
const sumCategories = (state, categories) => categories.reduce((total, category) => total + (state.pills[CATEGORY_LABELS[category]]?.count ?? 0), 0);
const activeLabels = (state) => Object.entries(state.pills).filter(([, pill]) => pill.active).map(([label]) => label).sort();

try {
  await callTool('command_run', { id: 'ui.open-panel', params: { panel: 'debug-console' } });
  await settle();
  await callTool('command_run', { id: 'system.set-debug-console-view', params: { reset: true, expanded: [] } });

  const listed = await callTool('command_list');
  assert.ok(listed.includes('system.set-debug-console-view'), 'the new command is missing from command_list');
  report.checks.push('command_list exposes system.set-debug-console-view');

  const baseline = await pollUntil('reset baseline', (state) => state.search === '' && state.source === '*' && state.entries > 0 && !state.hasResetButton);
  report.baseline = { groups: baseline.groups, entries: baseline.entries, pills: baseline.pills, statusTotal: baseline.statusTotal };
  assert.deepEqual(activeLabels(baseline), Object.values(LEVEL_LABELS).concat(Object.values(CATEGORY_LABELS)).sort(), 'reset must leave all ten pills active');
  assert.equal(baseline.entries, sumLevels(baseline, ['info', 'warn', 'error', 'event', 'lifecycle']), 'level pill counts must sum to the unfiltered total');
  assert.equal(baseline.entries, sumCategories(baseline, ['action', 'transfer', 'processing', 'result', 'system']), 'category pill counts must sum to the unfiltered total');
  assert.equal(baseline.statusTotal, String(baseline.entries), 'statusbar total must match the panel count');
  assert.equal(baseline.traces.filter((trace) => trace.open).length, 0, 'reset plus an empty expanded list must collapse every trace group');
  report.checks.push(`reset baseline: ${baseline.groups} 组 / ${baseline.entries} 条, pill sums and statusbar agree`);

  // 搜索词由本次 MCP 调用自身写进日志载荷，因此必定命中，同时证明补丁真的到达了渲染层。
  const probe = `viewprobe${Date.now()}`;
  await setView({ search: probe });
  const searched = await pollUntil('search patch', (state) => state.search === probe && state.entries > 0 && state.hasResetButton);
  assert.ok(searched.entries < baseline.entries, `search narrowed nothing: ${searched.entries} of ${baseline.entries}`);
  assert.ok(searched.entries <= sumLevels(searched, ['info', 'warn', 'error', 'event', 'lifecycle']), 'searched count cannot exceed the whole buffer');
  assert.match(searched.statusTotal, new RegExp(`^${searched.entries}/\\d+$`), 'statusbar must read filtered/total while a filter is active');
  report.search = { probe, entries: searched.entries, groups: searched.groups };
  report.checks.push(`search reaches the panel: "${probe}" keeps ${searched.entries} 条 of ${baseline.entries}`);

  // 搜索与级别筛选按 AND 组合：旧搜索词只出现在 event 级日志里，限定 error 后必然为空。
  await setView({ search: probe, levels: ['error'] });
  const empty = await pollUntil('empty result', (state) => state.entries === 0 && state.emptyState);
  assert.equal(empty.groups, 0, 'an empty filter result must report zero groups');
  assert.deepEqual(activeLabels(empty), [...Object.values(LEVEL_LABELS).filter((label) => label === '错误'), ...Object.values(CATEGORY_LABELS)].sort(), 'only the error level pill may stay active');
  assert.equal(empty.statusTotal.split('/')[0], '0', 'statusbar must read 0/total when nothing matches');
  report.checks.push('search AND level filters compose to an empty result with the Chinese empty state');

  // 级别筛选的命中数必须等于对应药丸计数（同一快照内读取，不受日志增长影响）。
  await setView({ search: '', levels: ['info', 'event'] });
  const levelled = await pollUntil('level filter', (state) => state.search === '' && activeLabels(state).join() === [LEVEL_LABELS.info, LEVEL_LABELS.event, CATEGORY_LABELS.action, CATEGORY_LABELS.transfer, CATEGORY_LABELS.processing, CATEGORY_LABELS.result, CATEGORY_LABELS.system].sort().join());
  assert.equal(levelled.entries, sumLevels(levelled, ['info', 'event']), 'level filter must match the memoized pill counts exactly');
  assert.ok(sumLevels(levelled, ['warn', 'error', 'lifecycle']) === 0 || levelled.entries < sumLevels(levelled, ['info', 'warn', 'error', 'event', 'lifecycle']), 'a partial selection must be a strict subset');
  report.levels = { entries: levelled.entries, pills: levelled.pills };

  // 错误计数交叉验证：面板只看 error 级时的条数必须等于状态栏徽标（徽标缺省即 0）。
  await setView({ levels: ['error'] });
  const errorOnly = await pollUntil('error level only', (state) => activeLabels(state).join() === [LEVEL_LABELS.error, CATEGORY_LABELS.action, CATEGORY_LABELS.transfer, CATEGORY_LABELS.processing, CATEGORY_LABELS.result, CATEGORY_LABELS.system].sort().join());
  assert.equal(errorOnly.entries, (errorOnly.statusErrors ? Number(errorOnly.statusErrors) : 0), 'panel error count must agree with the statusbar badge');
  assert.equal(errorOnly.entries, errorOnly.pills[LEVEL_LABELS.error].count, 'error pill count must equal the filtered total');
  report.errorEntries = errorOnly.entries;
  report.checks.push(`level filter: info+event = ${levelled.entries} 条, error = ${errorOnly.entries} 条, both match the pills and the statusbar badge`);

  // 分类筛选同样必须与药丸计数一致。
  await setView({ levels: ['info', 'warn', 'error', 'event', 'lifecycle'], categories: ['action'] });
  const categorised = await pollUntil('category filter', (state) => activeLabels(state).join() === [LEVEL_LABELS.info, LEVEL_LABELS.warn, LEVEL_LABELS.error, LEVEL_LABELS.event, LEVEL_LABELS.lifecycle, CATEGORY_LABELS.action].sort().join());
  assert.equal(categorised.entries, categorised.pills[CATEGORY_LABELS.action].count, 'category filter must match the memoized pill count');
  report.categoryActionEntries = categorised.entries;
  report.checks.push(`category filter: 操作 ${categorised.entries} 条 equals its pill count`);

  // 来源筛选：折叠的调用链不渲染日志行，所以用「各组阶段数之和 + 独立行 = 命中条数」核对命中集合，
  // 再展开其中一组检查每一行的来源标签。
  await setView({ categories: ['action', 'transfer', 'processing', 'result', 'system'], source: 'MCP', expanded: [] });
  const sourced = await pollUntil('source filter', (state) => state.source === 'MCP' && state.entries > 0 && state.traces.length > 0);
  assert.ok(sourced.traces.every((trace) => !trace.open), 'the source baseline must start with every trace collapsed');
  assert.equal(sourced.traces.reduce((total, trace) => total + trace.phases, 0) + sourced.rows.length, sourced.entries, 'every matched entry must be rendered exactly once');
  assert.ok(sourced.entries < sumLevels(sourced, ['info', 'warn', 'error', 'event', 'lifecycle']), 'source filter must narrow the buffer');
  const mcpTarget = sourced.traces.reduce((best, trace) => (trace.phases > best.phases ? trace : best), sourced.traces[0]);
  await setView({ expanded: [`trace:${mcpTarget.trace}`] });
  const sourcedOpen = await pollUntil('source rows', (state) => state.traces.some((trace) => trace.trace === mcpTarget.trace && trace.open));
  assert.ok(sourcedOpen.rows.length > 0, 'the expanded MCP trace must render its rows');
  assert.deepEqual([...new Set(sourcedOpen.rows.map((row) => row.source))], ['AI 工具调用'], `every rendered row must belong to the selected source, got ${JSON.stringify(sourcedOpen.rows)}`);
  report.source = { value: sourced.source, entries: sourced.entries, groups: sourced.traces.length, expandedRows: sourcedOpen.rows.length };
  report.checks.push(`source filter reaches the panel: ${sourced.entries} 条 in ${sourced.traces.length} 组, expanded rows all labelled AI 工具调用`);

  // 展开调用链：只允许指定的那一组多出条目，其余分组保持折叠。
  await setView({ source: '*', search: '', expanded: [] });
  await pollUntil('filters cleared', (state) => state.source === '*' && state.search === '' && !state.hasResetButton && state.traces.every((trace) => !trace.open));
  await settle();
  const collapsed = await snapshot();
  const closedTraces = collapsed.traces.filter((trace) => !trace.open && trace.trace);
  assert.ok(closedTraces.length > 0, 'no collapsed trace group is available for the expand test');
  const target = closedTraces.reduce((best, trace) => (trace.phases > best.phases ? trace : best), closedTraces[0]);
  const rowsBefore = collapsed.rows.length;
  await setView({ expanded: [`trace:${target.trace}`] });
  const expanded = await pollUntil('trace expand', (state) => state.traces.some((trace) => trace.trace === target.trace && trace.open));
  assert.equal(expanded.rows.length, rowsBefore + target.phases, `expanding one ${target.phases}-phase trace must add exactly ${target.phases} rendered rows, got ${expanded.rows.length - rowsBefore}`);
  assert.equal(expanded.traces.filter((trace) => trace.open).length, 1, 'only the requested trace may open');
  report.expandedTrace = { traceId: target.trace, phases: target.phases, rowsBefore, rowsAfter: expanded.rows.length };

  await setView({ expanded: [] });
  const recolapsed = await pollUntil('trace collapse', (state) => state.traces.every((trace) => !trace.open));
  assert.equal(recolapsed.rows.length, rowsBefore, 'collapsing again must remove exactly the rows that were added');
  report.checks.push(`expanded reaches the panel: trace ${target.trace} opened ${target.phases} 个阶段 and closed again`);

  // 参数校验：未知字段必须被命令侧 zod 拒绝，面板状态保持不变。
  const rejected = await mcpCall('command_run', { id: 'system.set-debug-console-view', params: { search: 'never-applied', panel: 'debug-console' } });
  assert.ok(rejected?.isError, 'an unknown view field must be rejected by the command schema');
  report.rejection = mcpText(rejected)?.slice(0, 200);
  const unchanged = await pollUntil('rejected patch ignored', (state) => state.search === '' && activeLabels(state).length === 10);
  assert.equal(unchanged.entries, unchanged.pills[LEVEL_LABELS.info].count + unchanged.pills[LEVEL_LABELS.warn].count + unchanged.pills[LEVEL_LABELS.error].count + unchanged.pills[LEVEL_LABELS.event].count + unchanged.pills[LEVEL_LABELS.lifecycle].count, 'the untouched view must still satisfy the pill identity');
  report.checks.push('unknown view fields are rejected and leave the panel state untouched');

  await setView({ reset: true });
  const restored = await pollUntil('reset again', (state) => !state.hasResetButton && state.search === '' && state.source === '*' && activeLabels(state).length === 10);
  assert.equal(restored.entries, sumLevels(restored, ['info', 'warn', 'error', 'event', 'lifecycle']), 'after reset the pill identity must hold again');
  assert.equal(restored.statusTotal, String(restored.entries), 'statusbar returns to the plain total after reset');
  assert.equal(restored.preCount, 0, 'no payload block should be open without an expanded id');
  report.checks.push(`reset restores all ten pills, clears search/source and re-derives ${restored.entries} 条`);

  await callTool('command_run', { id: 'system.set-debug-console-view', params: { levels: ['info', 'warn', 'error', 'event', 'lifecycle'], categories: ['action', 'transfer', 'processing', 'result', 'system'], source: 'MCP' } });
  await pollUntil('screenshot state', (state) => state.source === 'MCP');
  const shot = await mcpCall('capture_window');
  const image = mcpImage(shot);
  assert.ok(image, mcpText(shot) ?? 'capture_window did not return an image');
  report.screenshot = join(ensureOutDir(), 'debug-console-view.png');
  writeFileSync(report.screenshot, Buffer.from(image.data, 'base64'));
  report.checks.push('window screenshot captured with the source filter applied');
} finally {
  await setView({ reset: true, expanded: [] }).catch(() => undefined);
  await callTool('command_run', { id: 'ui.close-panel', params: {} }).catch(() => undefined);
  writeFileSync(join(ensureOutDir(), 'debug-console-view.json'), `${JSON.stringify(report, null, 2)}\n`);
  cdp.close();
}

console.log(JSON.stringify(report, null, 2))
