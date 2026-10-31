import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir } from './common.mjs'
import {
  MAX_BOARD_SUMMARIES, MAX_BOARD_SUMMARY_TITLE_LENGTH, parseBoardSummaryIndex
} from '../../src/main/plugins/canvas-ops-whiteboard-storage/summary-index.ts'

const checks = []
function check(name, run) { run(); checks.push(name) }

check('null default and valid summary decode', () => {
  assert.equal(parseBoardSummaryIndex(null), null)
  assert.deepEqual(parseBoardSummaryIndex([{ id: 'board-1', title: '画板' }]), [{ id: 'board-1', title: '画板' }])
})

check('title boundary is enforced', () => {
  assert.equal(parseBoardSummaryIndex([{ id: 'board-1', title: 'x'.repeat(MAX_BOARD_SUMMARY_TITLE_LENGTH) }])[0].title.length,
    MAX_BOARD_SUMMARY_TITLE_LENGTH)
  assert.throws(() => parseBoardSummaryIndex([{ id: 'board-1', title: 'x'.repeat(MAX_BOARD_SUMMARY_TITLE_LENGTH + 1) }]))
  assert.throws(() => parseBoardSummaryIndex([{ id: 'board-1', title: '' }]))
})

check('summary count boundary is enforced on restore and update input', () => {
  const within = Array.from({ length: MAX_BOARD_SUMMARIES }, (_, i) => ({ id: `board-${i}`, title: `Board ${i}` }))
  assert.equal(parseBoardSummaryIndex(within).length, MAX_BOARD_SUMMARIES)
  const over = [...within, { id: 'board-over', title: 'Over limit' }]
  assert.throws(() => parseBoardSummaryIndex(over), /too_big|Too big|Too many/i)
})

const output = join(ensureOutDir(), 'whiteboard-summary-index.json')
writeFileSync(output, `${JSON.stringify({ status: 'passed', checks, capturedAt: new Date().toISOString() }, null, 2)}\n`)
console.log('Whiteboard summary index boundaries OK')
console.log(`Report: ${output}`)
