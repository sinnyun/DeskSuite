import assert from 'node:assert/strict'
import { mkdir, writeFile, readFile } from 'node:fs/promises'
import { join } from 'node:path'
import { connectCdp, ensureOutDir, mcpCall, mcpHandshake, mcpImage, mcpText, outDir, projectRoot } from './common.mjs'
ensureOutDir()
await mcpHandshake()
const cdp = await connectCdp()
const call = async (name, args = {}) => {
  const result = await mcpCall(name, args)
  assert.ok(!result.isError, mcpText(result))
  return result
}
const json = async (name, args) => JSON.parse(mcpText(await call(name, args)))
const pane = args => json('quick_bookmarks_explorer', args)
const view = args => pane({ action: 'view', ...args })
const ipc = (id, args = []) => json('command_run', { id: `ipc.${id}`, params: { args } })
const pause = ms => new Promise(resolve => setTimeout(resolve, ms))
const waitFor = async expression => {
  for (let i = 0; i < 100; i++) {
    if (await cdp.evaluate(expression)) return
    await pause(100)
  }
  throw new Error(`DOM timeout: ${expression}`)
}
const inspect = () => cdp.evaluate(`(() => {
  const groups = [...document.querySelectorAll('[data-file-group]')]
  const cards = [...document.querySelectorAll('[data-file-card]')]
  const first = cards[0]
  const style = first ? getComputedStyle(first) : null
  return { groups: groups.map(el => ({ id: el.dataset.fileGroup, modes: [...el.querySelectorAll('[data-entry-view]')].map(view => view.dataset.entryView), rows:el.querySelectorAll('[role="row"]').length })),
    mode: document.querySelector('[data-view-mode][aria-pressed="true"]')?.dataset.viewMode,
    grouped: document.querySelector('[data-grouped-toolbar] button')?.getAttribute('aria-pressed'),
    counts: { grid:document.querySelectorAll('[data-entry-view="grid"]').length, list:document.querySelectorAll('[data-entry-view="list"]').length, gallery:document.querySelectorAll('[data-entry-view="gallery"]').length },
    galleryFits:[...document.querySelectorAll('[data-gallery-preview]')].every(img => { const a=img.getBoundingClientRect(), b=img.parentElement.getBoundingClientRect(); return a.width <= b.width+1 && a.height <= b.height+1 }),
    gallery: (() => {
      const rail = document.querySelector('[data-gallery-rail]')
      const viewer = document.querySelector('[data-gallery-viewer]')
      const stage = document.querySelector('[data-gallery-stage]')
      const scroller = rail?.querySelector('[data-grouped-view]') ?? rail
      const cards = [...(rail?.querySelectorAll('[data-file-card]') ?? [])]
      return rail && viewer ? { stageCount:document.querySelectorAll('[data-gallery-stage]').length, path:stage?.dataset.galleryStage,
        railWidth:rail.getBoundingClientRect().width, viewerWidth:viewer.getBoundingClientRect().width,
        scrollable:scroller.scrollHeight > scroller.clientHeight, overflowX:scroller.scrollWidth > scroller.clientWidth,
        singleColumn:cards.every((card, i) => i === 0 || card.getBoundingClientRect().top > cards[i-1].getBoundingClientRect().top),
        allCardsInRail:cards.length === document.querySelectorAll('[data-file-card]').length } : null
    })(),
    cards:cards.length, selected:cards.filter(el => el.getAttribute('aria-pressed') === 'true').map(el => el.title),
    cardStyle: first ? { width:first.getBoundingClientRect().width, radius:style.borderRadius, previewHeight:first.querySelector('[data-card-preview]').getBoundingClientRect().height } : null,
    inspector:document.querySelector('[data-file-inspector]')?.innerText,
    overflow:document.documentElement.scrollWidth > innerWidth }
})()`)
const shot = async name => {
  await pause(300)
  const image = mcpImage(await call('capture_window'))
  assert.ok(image)
  await writeFile(join(outDir, name), Buffer.from(image.data, 'base64'))
}
const report = []
try {
  await waitFor('!!document.querySelector("[data-file-explorer-toolbar]")')
  if (process.argv.includes('--check-restart')) {
    const expected = JSON.parse(await readFile(join(outDir, 'explorer-composition-expected.json'), 'utf8'))
    await waitFor(`document.querySelector('[data-view-mode="${expected.viewMode}"]')?.getAttribute('aria-pressed') === 'true' && !!document.querySelector('[data-grouped-view]')`)
    const session = await ipc('session.get')
    assert.equal(session.viewMode, expected.viewMode)
    assert.equal(session.groupingEnabled, true)
    assert.equal(session.path, expected.path)
    const state = await inspect()
    assert.ok(state.groups.every(group => group.modes[0] === (expected.viewMode === 'gallery' ? 'grid' : expected.viewMode)))
    await shot('explorer-composition-restart.png')
    await writeFile(join(outDir, 'explorer-composition-restart.json'), JSON.stringify({ session, state }, null, 2))
    console.log('Composition survives full application restart.')
  } else {
    const root = join(projectRoot, 'artifacts/verify/samples/explorer-concept')
    const nested = join(root, '临时文件')
    await mkdir(nested, { recursive:true })
    await Promise.all(Array.from({ length:60 }, (_, i) => writeFile(join(nested, `分组样例-${String(i).padStart(2, '0')}.md`), `# 分组样例 ${i}\n`)))
    await call('control_window', { action:'resize', width:2048, height:1152 })
    await pane({ action:'navigate', path:root })
    await view({ groupBy:'kind', includeChildren:false })
    const selected = join(root, 'Shot 007.png')
    await pane({ action:'select', paths:[selected] })
    let sharedCardStyle
    for (const grouped of [true, false]) {
      for (const mode of ['grid', 'list', 'gallery']) {
        const response = await view({ viewMode:mode, groupingEnabled:grouped })
        assert.equal(response.viewMode, mode)
        assert.equal(response.groupingEnabled, grouped)
        await waitFor(`document.querySelector('[data-view-mode="${mode}"]')?.getAttribute('aria-pressed') === 'true' && document.querySelectorAll('[data-entry-view="${mode}"]').length > 0 && !!document.querySelector('[data-grouped-view]') === ${grouped}`)
        const state = await inspect()
        assert.equal(state.grouped, String(grouped))
        assert.equal(state.mode, mode)
        assert.ok(!state.overflow)
        if (mode === 'gallery') {
          assert.ok(state.galleryFits, 'Gallery preview must fit the single viewer')
          assert.equal(state.gallery.stageCount, 1)
          assert.equal(state.gallery.path, selected)
          assert.ok(state.gallery.singleColumn && state.gallery.allCardsInRail)
          assert.ok(state.gallery.scrollable && !state.gallery.overflowX)
          assert.ok(Math.abs(state.gallery.viewerWidth / state.gallery.railWidth - 4) < 0.05)
        }
        assert.equal(state.counts[mode], mode === 'gallery' ? 1 : grouped ? state.groups.length : 1)
        assert.ok(state.inspector.includes('Shot 007.png'))
        if (grouped) assert.ok(state.groups.length >= 3 && state.groups.every(group => group.modes.length === 1 && group.modes[0] === (mode === 'gallery' ? 'grid' : mode)))
        if (mode === 'grid') {
          assert.ok(state.selected.includes(selected))
          assert.equal(state.cardStyle.width, 152)
          if (sharedCardStyle) assert.deepEqual(state.cardStyle, sharedCardStyle)
          else sharedCardStyle = state.cardStyle
        }
        await shot(`explorer-composition-${grouped ? 'grouped' : 'flat'}-${mode}.png`)
        if (grouped && mode === 'gallery') {
          await json('command_run', { id:'system.toggle-theme' })
          await shot('explorer-gallery-dark.png')
          await json('command_run', { id:'system.toggle-theme' })
          await call('control_window', { action:'resize', width:1280, height:850 })
          await pause(200)
          const compact = await inspect()
          assert.ok(!compact.overflow && !compact.gallery.overflowX && compact.gallery.singleColumn)
          assert.equal(compact.gallery.stageCount, 1)
          await shot('explorer-gallery-compact.png')
          await call('control_window', { action:'resize', width:2048, height:1152 })
        }
        report.push({ grouped, mode, state })
      }
    }
    // Toggle grouping without supplying a mode: gallery remains active.
    const groupedGallery = await view({ groupingEnabled:true })
    assert.equal(groupedGallery.viewMode, 'gallery')
    await view({ viewMode:'list', includeChildren:true })
    await waitFor(`document.querySelector('[data-file-group="kind:document"]')?.innerText.includes('分组样例-00.md') === true`)
    let state = await inspect()
    const docs = state.groups.find(group => group.id === 'kind:document')
    assert.ok(docs.rows > 0 && docs.rows < 62, 'Grouped list must virtualize a large group')
    const child = join(nested, '分组样例-00.md')
    await pane({ action:'select', paths:[child] })
    await waitFor(`document.querySelector('[data-file-inspector]')?.innerText.includes('分组样例-00.md')`)
    await view({ viewMode:'gallery' })
    await waitFor(`document.querySelector('[data-gallery-stage]')?.dataset.galleryStage === ${JSON.stringify(child)}`)
    state = await inspect()
    assert.equal(state.gallery.stageCount, 1)
    assert.ok(state.gallery.singleColumn && state.gallery.allCardsInRail)
    await view({ viewMode:'list' })
    for (const by of ['rating','folder','modifiedMinute','kind']) {
      const response = await view({ groupBy:by })
      assert.equal(response.groupOptions.groupBy, by)
      assert.equal(response.viewMode, 'list')
      assert.equal(response.groupingEnabled, true)
      await pause(100)
      state = await inspect()
      assert.ok(state.groups.length > 0)
      assert.ok(state.groups.every(group => group.modes[0] === 'list'))
    }
    report.push('Recursive entry selection, virtualized group lists and all four group modes passed.')
    await view({ viewMode:'grid', includeChildren:false })
    await pause(1000)
    // Reproduce a legacy persisted grouped session through MCP, then reload.
    await ipc('session.set', [{ viewMode:'grouped', groupingEnabled:false }])
    await call('control_window', { action:'reload' })
    await waitFor(`document.querySelector('[data-view-mode="grid"]')?.getAttribute('aria-pressed') === 'true' && !!document.querySelector('[data-grouped-view]')`)
    await pause(400)
    const migrated = await view({})
    assert.equal(migrated.viewMode, 'grid')
    assert.equal(migrated.groupingEnabled, true)
    report.push('Legacy grouped session migrated to grid + grouping enabled.')
    await view({ viewMode:'gallery', groupingEnabled:true })
    await pane({ action:'select', paths:[selected] })
    await pause(1100)
    const session = await ipc('session.get')
    assert.equal(session.viewMode, 'gallery')
    assert.equal(session.groupingEnabled, true)
    const partial = await ipc('session.set', [{ sortOrder: session.sortOrder }])
    assert.equal(partial.groupingEnabled, true, 'Unrelated partial session updates must preserve grouping')
    await pause(700) // Let the session writer persist the last partial update before restart.
    await writeFile(join(outDir, 'explorer-composition-expected.json'), JSON.stringify({ viewMode:'gallery', path:root }))
    await shot('explorer-composition-final.png')
    await writeFile(join(outDir, 'explorer-composition.json'), JSON.stringify({ report, session }, null, 2))
    console.log('All six display/group combinations, shared cards, selection, recursion, virtualization, grouping modes and legacy migration passed.')
  }
} finally { cdp.close() }
