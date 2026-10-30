import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs'
import { dirname, join, relative, resolve, sep } from 'node:path'
import { fileURLToPath } from 'node:url'

const root = fileURLToPath(new URL('..', import.meta.url))
const violations = []

// 渲染层插件只允许纯 UI 偏好进浏览器存储；领域数据必须由主进程持有
const BROWSER_STORAGE_ALLOWED = [
  'desksuite.explorer.path',
  'desksuite.explorer.view',
  // Bounded renderer cache only; source files and domain metadata stay in main-process services.
  'desksuite.explorer.thumbnails'
]
// One-time legacy import is allowed only in the owning migration code; normal feature code cannot reuse these keys.
const BROWSER_STORAGE_MIGRATIONS = {
  'src/renderer/src/plugins/data-ops-explorer/metadata.ts': ['desksuite.explorer.meta'],
  'src/renderer/src/plugins/data-ops-clipboard/components/ClipboardPanel.tsx': ['desksuite.clipboard.history']
}
const FILE_OPERATIONS_PLUGIN = 'src/main/plugins/data-ops-file-operations/'
const SQLITE_OWNER_PLUGINS = ['src/main/plugins/data-provider-catalog/']
// These providers may atomically mutate only their own private version/WorkCrate data or
// user-approved export targets. They must never mutate referenced source files directly.
const OWNED_DATA_MUTATION_PLUGINS = [
  'src/main/plugins/data-ops-versions/',
  'src/main/plugins/project-ops-workcrate-projects/',
  'src/main/plugins/project-provider-workcrate-boards/'
]
const LEAFERJS_DOC = 'docs/LEAFERJS.md'
const LEAFERJS_PLUGIN_ROOTS = [
  'src/renderer/src/plugins/data-provider-resources/',
  'src/renderer/src/plugins/data-ops-resource-library/'
]
const LEAFERJS_IMPORT = /(?:from\s*|import\s*\()\s*['"](?:leafer-ui|@leafer-in\/[^'"]+|leafer-x-[^'"]+)['"]|^\s*import\s*['"](?:leafer-ui|@leafer-in\/[^'"]+|leafer-x-[^'"]+)['"]/m

function usedBrowserStorageKeys(src) {
  const consts = new Map()
  for (const m of src.matchAll(/(?:const|let|var)\s+([A-Za-z_$][\w$]*)\s*=\s*['"]([^'"]+)['"]/g)) {
    consts.set(m[1], m[2])
  }
  const keys = new Set()
  for (const m of src.matchAll(
    /localStorage\s*\.\s*(?:getItem|setItem|removeItem)\s*\(\s*([^,)]+)/g
  )) {
    const raw = m[1].trim()
    const literal = raw.match(/^['"]([^'"]+)['"]$/)
    if (literal) keys.add(literal[1])
    else if (consts.has(raw)) keys.add(consts.get(raw))
    else keys.add('<动态键>')
  }
  return keys
}

function walk(dir) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) {
      walk(full)
    } else if (/\.(ts|tsx)$/.test(name)) {
      check(full)
    }
  }
}

function check(file) {
  const rel = relative(root, file).replaceAll(sep, '/')
  const src = readFileSync(file, 'utf8')

  if (LEAFERJS_IMPORT.test(src)) {
    const canvasPlugin = rel.startsWith('src/renderer/src/plugins/canvas-')
    const sharedResourcePlugin = LEAFERJS_PLUGIN_ROOTS.some((plugin) => rel.startsWith(plugin))
    if (!canvasPlugin && !sharedResourcePlugin) {
      violations.push(
        `${rel}: LeaferJS imports belong in a renderer canvas plugin or the documented shared resource plugins; see ${LEAFERJS_DOC}`
      )
    }
  }

  if (rel.startsWith('src/renderer/')) {
    if (/from\s+['"]electron['"]/.test(src) || /require\(\s*['"]electron['"]\s*\)/.test(src)) {
      violations.push(`${rel}: renderer must not import "electron" directly; use window.bridge instead`)
    }
  }

  if (rel.startsWith('src/main/') && rel !== 'src/main/services/window.ts') {
    if (/new\s+BrowserWindow\b/.test(src)) {
      violations.push(`${rel}: BrowserWindow may only be created inside src/main/services/window.ts`)
    }
  }

  if (rel.startsWith('src/main/') && rel !== 'src/main/services/mcp.ts') {
    if (/createServer\s*\(|\.listen\s*\(/.test(src)) {
      violations.push(
        `${rel}: network listeners (createServer/.listen) are only allowed inside src/main/services/mcp.ts; register MCP tools via ctx.mcp instead`
      )
    }
  }

  if (rel.startsWith('src/main/plugins/')) {
    // 插件命名规范：<域>-<子类>-<名称>，域白名单，至少三段 kebab-case
    const folder = rel.split('/')[3]
    const DOMAINS = ['demo', 'system', 'data', 'canvas', 'note', 'project']
    const segments = folder.split('-')
    if (segments.length < 3 || !DOMAINS.includes(segments[0]) || !segments.every((s) => /^[a-z0-9]+$/.test(s))) {
      violations.push(
        `${rel}: plugin folder "${folder}" violates naming "<domain>-<category>-<name>" (domain must be one of ${DOMAINS.join('|')}; add new domains to guard.mjs DOMAINS; kebab-case, at least 3 segments)`
      )
    }
    // 每个插件必须维护 PORTS.md 与 PORTS_ZH.md 公共契约文档
    const pluginRoot = join(root, 'src', 'main', 'plugins', folder)
    for (const doc of ['PORTS.md', 'PORTS_ZH.md']) {
      if (!existsSync(join(pluginRoot, doc))) {
        violations.push(`${rel}: plugin folder "${folder}" is missing ${doc}`)
      }
    }
    // 插件目录隔离（crates 式）：只能导入自己文件夹内（含子文件的相对路径）与内置服务（../services/）
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1]
      const isServices = /^(\.\.\/)+services\//.test(spec)
      const insidePlugin = !relative(pluginRoot, resolve(dirname(file), spec)).startsWith('..')
      if (!isServices && !insidePlugin) {
        violations.push(
          `${rel}: plugin files may only import within their own folder or built-in services ("../services/..."), got "${spec}"`
        )
      }
    }
  }

  if (rel === 'src/main/app.ts') {
    if (/from\s+['"]\.{1,2}\/plugins\//.test(src)) {
      violations.push(
        `${rel}: app.ts must not import plugins statically; plugins are auto-discovered via import.meta.glob('./plugins/*.ts')`
      )
    }
    if (!/import\.meta\.glob(<[^>]*>)?\(\s*['"]\.\/plugins\/\*\/index\.ts/.test(src)) {
      violations.push(`${rel}: app.ts must keep the import.meta.glob('./plugins/*/index.ts') auto-discovery`)
    }
  }

  if (rel.startsWith('src/renderer/src/plugins/')) {
    // 渲染层插件与主进程插件同一套命名规范
    const folder = rel.split('/')[4]
    const DOMAINS = ['demo', 'system', 'data', 'canvas', 'note', 'project']
    const segments = folder.split('-')
    if (segments.length < 3 || !DOMAINS.includes(segments[0]) || !segments.every((s) => /^[a-z0-9]+$/.test(s))) {
      violations.push(
        `${rel}: renderer plugin folder "${folder}" violates naming "<domain>-<category>-<name>" (domain must be one of ${DOMAINS.join('|')}; add new domains to guard.mjs DOMAINS; kebab-case, at least 3 segments)`
      )
    }
    const pluginRoot = join(root, 'src', 'renderer', 'src', 'plugins', folder)
    if (!existsSync(join(pluginRoot, 'index.tsx'))) {
      violations.push(`${rel}: renderer plugin folder "${folder}" must have an index.tsx entry`)
    }
    for (const doc of ['PORTS.md', 'PORTS_ZH.md']) {
      if (!existsSync(join(pluginRoot, doc))) {
        violations.push(`${rel}: renderer plugin folder "${folder}" is missing ${doc}`)
      }
    }
    // 渲染层插件唯一可用的宿主入口是 workbench/sdk；不得引用宿主内部文件或其他插件
    for (const m of src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)) {
      const spec = m[1]
      const isSdk = /^(\.\.\/)+workbench\/sdk$/.test(spec)
      const insidePlugin = !relative(pluginRoot, resolve(dirname(file), spec)).startsWith('..')
      if (!isSdk && !insidePlugin) {
        violations.push(
          `${rel}: renderer plugin files may only import within their own folder or the host SDK ("workbench/sdk"), got "${spec}"`
        )
      }
    }
    // 领域数据不得留在浏览器存储：否则主进程与 MCP 都看不见
    for (const key of usedBrowserStorageKeys(src)) {
      if (key.startsWith('desksuite.workbench.')) continue
      if (BROWSER_STORAGE_ALLOWED.includes(key) || BROWSER_STORAGE_MIGRATIONS[rel]?.includes(key)) continue
      violations.push(
        `${rel}: renderer plugins must not persist domain data in browser storage ("${key}"); expose a main-process IPC/store service instead`
      )
    }
  }

  if (
    rel.startsWith('src/main/') &&
    !rel.startsWith('src/main/services/') &&
    !SQLITE_OWNER_PLUGINS.some((owner) => rel.startsWith(owner)) &&
    /^\s*import\s+(?!type\b)[^\n;]*from\s+['"]node:sqlite['"]|require\(\s*['"]node:sqlite['"]\s*\)/m.test(src)
  ) {
    violations.push(
      `${rel}: node:sqlite may only be opened inside src/main/services/ or data-provider-catalog; other plugins consume the "db" service`
    )
  }

  if (
    rel.startsWith('src/main/plugins/') &&
    !rel.startsWith(FILE_OPERATIONS_PLUGIN) &&
    !OWNED_DATA_MUTATION_PLUGINS.some((owner) => rel.startsWith(owner)) &&
    /\b(?:rename|renameSync|cp|cpSync|rm|rmSync|unlink|unlinkSync|rmdir|rmdirSync)\s*\(/.test(src)
  ) {
    violations.push(
      `${rel}: file mutations must go through the plan/approve/execute flow in data-ops-file-operations; direct rename/cp/rm/unlink is not allowed in other plugins`
    )
  }

  if (rel.startsWith('src/renderer/src/workbench/')) {
    if (/from\s+['"][^'"]*plugins\//.test(src)) {
      violations.push(`${rel}: base host must not import renderer plugins; only registry.ts may glob them`)
    }
  }

  if (rel === 'src/renderer/src/workbench/registry.ts') {
    if (!/import\.meta\.glob(<[^>]*>)?\(\s*['"]\.\.\/plugins\/\*\/index\.tsx/.test(src)) {
      violations.push(
        `${rel}: registry.ts must keep the import.meta.glob('../plugins/*/index.tsx') auto-discovery`
      )
    }
  }

  if (
    rel.startsWith('src/main/') &&
    !rel.startsWith('src/main/plugins/') &&
    rel !== 'src/main/app.ts' &&
    /import\s+[^'"]*['"]\.\/plugins\/|from\s+['"]\.\.?\/plugins\//.test(src)
  ) {
    violations.push(`${rel}: only app.ts may reference plugins (via auto-discovery)`)
  }

  if (rel === 'src/preload/index.ts') {
    const exposes = [...src.matchAll(/exposeInMainWorld\(\s*['"]([^'"]+)['"]/g)]
    if (exposes.length !== 1 || exposes[0][1] !== 'bridge') {
      violations.push(
        `${rel}: preload must expose exactly one API named "bridge" (found ${exposes.map((m) => m[1]).join(', ') || 'none'})`
      )
    }
  }
}

walk(join(root, 'src'))

if (!existsSync(join(root, LEAFERJS_DOC))) {
  violations.push(`${LEAFERJS_DOC}: required LeaferJS development and skill usage guide is missing`)
} else {
  const guide = readFileSync(join(root, LEAFERJS_DOC), 'utf8')
  if (!/leafer-ai/.test(guide) || !/github\.com\/leaferjs\/ai-docs/.test(guide)) {
    violations.push(`${LEAFERJS_DOC}: must document the leafer-ai skill and its ai-docs knowledge source`)
  }
}

if (violations.length > 0) {
  console.error('Architecture guard FAILED:')
  for (const v of violations) console.error('  - ' + v)
  process.exit(1)
}

console.log('Architecture guard OK')
