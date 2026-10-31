#!/usr/bin/env node
// Read-only inventory of main-process IPC methods and their declared argument schemas.
import { readdirSync, readFileSync } from 'node:fs'
import { join, relative } from 'node:path'
import { createRequire } from 'node:module'
import { projectRoot } from './common.mjs'

const require = createRequire(import.meta.url)
const ts = require('typescript')
const pluginRoot = join(projectRoot, 'src', 'main', 'plugins')

function sourceFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name)
    if (entry.isDirectory()) return sourceFiles(path)
    return entry.isFile() && entry.name.endsWith('.ts') ? [path] : []
  })
}

function propertyName(node) {
  if (!node?.name) return undefined
  if (ts.isIdentifier(node.name) || ts.isStringLiteral(node.name) || ts.isNumericLiteral(node.name)) return node.name.text
  return undefined
}

function resolveObject(node, declarations, seen = new Set()) {
  if (ts.isObjectLiteralExpression(node)) return node
  if (!ts.isIdentifier(node) || seen.has(node.text)) return undefined
  seen.add(node.text)
  const initializer = declarations.get(node.text)
  return initializer ? resolveObject(initializer, declarations, seen) : undefined
}

function collectProperties(node, declarations, output = new Set(), seen = new Set()) {
  const object = resolveObject(node, declarations)
  if (!object || seen.has(object)) return output
  seen.add(object)
  for (const property of object.properties) {
    const name = propertyName(property)
    if (name) output.add(name)
    else if (ts.isSpreadAssignment(property)) collectProperties(property.expression, declarations, output, seen)
  }
  return output
}

const methods = []
for (const file of sourceFiles(pluginRoot)) {
  const source = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true)
  const declarations = new Map()
  function collectDeclarations(node) {
    if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
      declarations.set(node.name.text, node.initializer)
    }
    ts.forEachChild(node, collectDeclarations)
  }
  collectDeclarations(source)
  function visit(node) {
    if (ts.isCallExpression(node) && node.arguments.length >= 2) {
      const callee = node.expression
      const isIpcHandle = ts.isPropertyAccessExpression(callee)
        && callee.name.text === 'handle'
        && ts.isPropertyAccessExpression(callee.expression)
        && callee.expression.name.text === 'ipc'
        && ts.isIdentifier(callee.expression.expression)
        && callee.expression.expression.text === 'ctx'
      const methodObject = resolveObject(node.arguments[1], declarations)
      if (isIpcHandle && ts.isStringLiteral(node.arguments[0]) && methodObject) {
        const service = node.arguments[0].text
        const handlers = collectProperties(node.arguments[1], declarations)
        const schemas = node.arguments[2] ? collectProperties(node.arguments[2], declarations) : new Set()
        for (const method of handlers) methods.push({ service, method, schema: schemas.has(method), file: relative(projectRoot, file).replaceAll('\\', '/') })
      }
    }
    ts.forEachChild(node, visit)
  }
  visit(source)
}

methods.sort((a, b) => a.service.localeCompare(b.service) || a.method.localeCompare(b.method))
const uncovered = methods.filter((item) => !item.schema)
const grouped = Object.groupBy(uncovered, (item) => item.service)
const byService = Object.entries(grouped).sort(([a], [b]) => a.localeCompare(b)).map(([service, items]) => ({
  service,
  count: items.length,
  ...(process.argv.includes('--list') ? { methods: items.map((item) => `${item.method} (${item.file})`) } : {})
}))
console.log(JSON.stringify({
  totalMethods: methods.length,
  schemaMethods: methods.length - uncovered.length,
  uncoveredMethods: uncovered.length,
  coveragePercent: methods.length ? Math.round((methods.length - uncovered.length) / methods.length * 1000) / 10 : 100,
  uncoveredByService: byService
}, null, 2))
