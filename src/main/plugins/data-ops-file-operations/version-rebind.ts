import { join, relative } from 'node:path'

const REBIND_PAGE_SIZE = 500
type SqlOutputValue = null | number | bigint | string | NodeJS.NonSharedUint8Array

interface VersionPathRow extends Record<string, SqlOutputValue> {
  path_key: string
  path: string
}

interface VersionPathReader {
  all<T extends Record<string, SqlOutputValue>>(sql: string, ...params: Array<string | number>): T[]
}

interface PathOperations {
  isInside(parent: string, child: string): boolean
  normalize(path: string): string
  samePath(left: string, right: string): boolean
}

export interface RebindVersionPathsResult {
  attempted: number
  failed: number
  warningSamples: string[]
}

/** Keyset-pages the catalog while preserving the original JS path containment rules. */
export function rebindVersionEntityPaths(
  db: VersionPathReader,
  source: string,
  destination: string,
  sourceIsDirectory: boolean,
  rebindPath: (oldPath: string, newPath: string) => unknown,
  formatError: (error: unknown) => string,
  pathOperations: PathOperations
): RebindVersionPathsResult {
  const normalizedSource = pathOperations.normalize(source)
  const normalizedDestination = pathOperations.normalize(destination)
  let cursor: string | null = null
  let attempted = 0
  let failed = 0
  const warningSamples: string[] = []

  while (true) {
    const page: VersionPathRow[] = cursor === null
      ? db.all<VersionPathRow>('SELECT path_key,path FROM version_entities ORDER BY path_key DESC LIMIT ?', REBIND_PAGE_SIZE)
      : db.all<VersionPathRow>('SELECT path_key,path FROM version_entities WHERE path_key < ? ORDER BY path_key DESC LIMIT ?', cursor, REBIND_PAGE_SIZE)
    if (!page.length) break
    cursor = page[page.length - 1].path_key

    for (const row of page) {
      const isSource = pathOperations.samePath(row.path, normalizedSource)
      if (!isSource && !(sourceIsDirectory && pathOperations.isInside(normalizedSource, row.path))) continue
      const nextPath = isSource
        ? normalizedDestination
        : pathOperations.normalize(join(normalizedDestination, relative(normalizedSource, row.path)))
      attempted += 1
      try {
        rebindPath(row.path, nextPath)
      } catch (error) {
        failed += 1
        if (warningSamples.length < 8) warningSamples.push(`${row.path}: ${formatError(error)}`)
      }
    }
  }

  return { attempted, failed, warningSamples }
}

export const VERSION_REBIND_PAGE_SIZE = REBIND_PAGE_SIZE
