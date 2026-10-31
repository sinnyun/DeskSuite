import assert from 'node:assert/strict'
import { writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { ensureOutDir } from './common.mjs'
import { ConfigPersistencePolicy } from '../../src/main/services/config-persistence.ts'

const policy = new ConfigPersistencePolicy()
const checks = []
function check(name, run) { run(); checks.push(name) }

check('window auto-save is denied before startup classification', () => {
  assert.equal(policy.state(), 'pending')
  assert.equal(policy.allowWindowAutoSave(), false)
})

check('valid and missing config permit normal window persistence', () => {
  policy.markLoaded()
  assert.equal(policy.allowWindowAutoSave(), true)
  policy.markMissing()
  assert.equal(policy.allowWindowAutoSave(), true)
})

check('recovered broken config blocks implicit window overwrite', () => {
  policy.markRecovered()
  assert.equal(policy.state(), 'recovered')
  assert.equal(policy.allowWindowAutoSave(), false)
})

check('an explicit successful config write repairs persistence state', () => {
  policy.markExplicitWriteSucceeded()
  assert.equal(policy.state(), 'loaded')
  assert.equal(policy.allowWindowAutoSave(), true)
})

const output = join(ensureOutDir(), 'config-persistence-policy.json')
writeFileSync(output, `${JSON.stringify({ status: 'passed', checks, capturedAt: new Date().toISOString() }, null, 2)}\n`)
console.log(`Config persistence policy OK; report: ${output}`)
