#!/usr/bin/env node
import assert from 'node:assert/strict'
import { mkdir, stat } from 'node:fs/promises'
import { join } from 'node:path'
import { ensureOutDir, mcpCall, mcpHandshake, mcpText, outDir, projectRoot } from './common.mjs'

ensureOutDir()
await mcpHandshake()

const suffix = `${Date.now()}-${process.pid}`
const directory = join(outDir, 'samples', `WorkCrateMcp-${suffix}`)
await mkdir(directory, { recursive: true })

const cliExecutable = process.env.VECTORCRAFT_CLI_PATH || 'C:\\Program Files\\VectorCraft\\vectorcraft-cli.exe'
const configResult = await mcpCall('workcrate_vectorcraft_config_set', {
  config: { cliExecutable: `  "${cliExecutable}"  `, guiExecutable: '', defaultImageFormat: 'png', port: 17979 },
  confirm: true
})
assert.ok(!configResult?.isError, mcpText(configResult) ?? 'Could not configure VectorCraft CLI through MCP')
assert.equal(JSON.parse(mcpText(configResult)).cliExecutable, cliExecutable, 'Windows copied paths must be unquoted before validation and storage')
const readConfig = await mcpCall('workcrate_vectorcraft_config_get')
assert.equal(JSON.parse(mcpText(readConfig)).cliExecutable, cliExecutable)

const created = await mcpCall('workcrate_project_create', {
  name: `WorkCrate MCP ${suffix}`,
  directory,
  confirm: true
})
assert.ok(!created?.isError, mcpText(created) ?? 'WorkCrate project creation MCP call failed')
const payload = JSON.parse(mcpText(created) ?? '{}')
assert.ok(payload.project?.id, 'MCP response must include the created project ID')
assert.ok(payload.path?.toLowerCase().endsWith('.vectorcraft'), 'MCP response must include the native VectorCraft document path')
assert.ok(Array.isArray(payload.boards) && payload.boards.length === 1, 'new VectorCraft document must include one initial board')
assert.ok((await stat(payload.path)).size > 0, 'native document must be saved on disk')
assert.ok((await stat(join(payload.projectDataPath, 'project.json'))).size > 0, 'portable project metadata must be saved on disk')

const previewResult = await mcpCall('workcrate_boards_refresh', { projectId: payload.project.id })
assert.ok(!previewResult?.isError, mcpText(previewResult) ?? 'Saved native document must reopen and sync')

const catalogResult = await mcpCall('workcrate_board_catalog', { projectId: payload.project.id })
const catalog = JSON.parse(mcpText(catalogResult) ?? 'null')
assert.ok(!catalogResult?.isError, mcpText(catalogResult) ?? 'Board catalog MCP call failed')
assert.equal(catalog.length, 1, 'cached board catalog must contain the initial board')
assert.equal(catalog[0].id, payload.boards[0].id)

const panelResult = await mcpCall('workcrate_panel_open')
assert.ok(!panelResult?.isError, mcpText(panelResult) ?? 'Could not open the WorkCrate panel through MCP')
await new Promise((resolve) => setTimeout(resolve, 300))

const report = {
  projectId: payload.project.id,
  projectName: payload.project.name,
  document: payload.path,
  projectDataPath: payload.projectDataPath,
  boardCount: catalog.length,
  boardId: catalog[0].id,
  relocationWarning: payload.relocationWarning,
  panelOpenedThroughMcp: true,
  verificationRoot: projectRoot
}
console.log(JSON.stringify(report, null, 2))
