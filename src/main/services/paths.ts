import { realpath } from 'node:fs/promises'
import { posix, win32 } from 'node:path'

const isWindows = process.platform === 'win32'
const path = isWindows ? win32 : posix

const WINDOWS_FORBIDDEN = [
  'C:\\Windows',
  'C:\\Program Files',
  'C:\\Program Files (x86)',
  'C:\\ProgramData'
]

export interface WritableOptions {
  allowedRoots: string[]
  forbidden?: string[]
}

export class PathError extends Error {
  code: string

  constructor(code: string, message: string) {
    super(message)
    this.name = 'PathError'
    this.code = code
  }
}

export function normalize(target: string): string {
  let resolved = path.normalize(path.resolve(target))
  const root = path.parse(resolved).root
  while (resolved.length > root.length && resolved.endsWith(path.sep)) {
    resolved = resolved.slice(0, -1)
  }
  return resolved
}

export function identity(target: string): string {
  const normalized = normalize(target)
  return isWindows ? normalized.toLowerCase() : normalized
}

export function toLongPath(target: string): string {
  if (!isWindows) return target
  if (target.startsWith('\\\\?\\')) return target
  const normalized = normalize(target)
  if (normalized.length < 248) return normalized
  if (normalized.startsWith('\\\\')) return `\\\\?\\UNC\\${normalized.slice(2)}`
  return `\\\\?\\${normalized}`
}

export function samePath(a: string, b: string): boolean {
  return identity(a) === identity(b)
}

function within(parentId: string, childId: string): boolean {
  if (childId === parentId) return true
  const base = parentId.endsWith(path.sep) ? parentId : parentId + path.sep
  return childId.startsWith(base)
}

export function isInside(parent: string, child: string): boolean {
  const parentId = identity(parent)
  const childId = identity(child)
  return childId !== parentId && within(parentId, childId)
}

export function isEqualOrInside(parent: string, child: string): boolean {
  return within(identity(parent), identity(child))
}

function isRoot(target: string): boolean {
  const normalized = normalize(target)
  return identity(normalized) === identity(path.parse(normalized).root)
}

function forbiddenRoots(options: WritableOptions): string[] {
  const custom = options.forbidden ?? []
  return isWindows ? [...WINDOWS_FORBIDDEN, ...custom] : [...custom]
}

function checkConstraints(target: string, options: WritableOptions): void {
  if (isRoot(target)) {
    throw new PathError('root-path', `拒绝写入文件系统根目录：${target}`)
  }
  for (const forbidden of forbiddenRoots(options)) {
    if (isEqualOrInside(forbidden, target)) {
      throw new PathError('forbidden-path', `路径位于禁止写入的目录内：${target}`)
    }
  }
  const allowed = options.allowedRoots.some((root) => isEqualOrInside(root, target))
  if (!allowed) {
    throw new PathError('outside-roots', `路径不在任何可写根目录内：${target}`)
  }
}

async function realTarget(target: string): Promise<string> {
  let current = target
  for (;;) {
    try {
      const real = await realpath(current)
      const rest = path.relative(current, target)
      return rest ? path.join(real, rest) : real
    } catch (error) {
      if (typeof error !== 'object' || error === null || (error as NodeJS.ErrnoException).code !== 'ENOENT') {
        throw new PathError('symlink-escape', `无法解析路径的真实位置：${target}`)
      }
      const parent = path.dirname(current)
      if (parent === current) {
        throw new PathError('symlink-escape', `无法解析路径的真实位置：${target}`)
      }
      current = parent
    }
  }
}

export async function assertWritable(target: string, options: WritableOptions): Promise<string> {
  if (!options.allowedRoots || options.allowedRoots.length === 0) {
    throw new PathError('no-write-roots', '没有配置任何可写根目录')
  }
  const normalized = normalize(target)
  checkConstraints(normalized, options)
  const real = await realTarget(normalized)
  if (identity(real) !== identity(normalized)) {
    try {
      checkConstraints(real, options)
    } catch (error) {
      if (error instanceof PathError) {
        throw new PathError('symlink-escape', `路径经符号链接解析后逃逸到约束之外：${target} -> ${real}`)
      }
      throw error
    }
  }
  return normalized
}
