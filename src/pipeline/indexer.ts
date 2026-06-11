import * as fs from 'fs'
import { glob } from 'glob'
import { parseFile } from '../lang/parser'
import { Store, type FileMeta } from '../io/store'
import { DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import type { CodeUnit, IndexStats } from '../types'

// Shared by `index` and by `check <dir>` so both walks see the same files.
export const FILE_PATTERNS = ['**/*.ts', '**/*.tsx', '**/*.rb']

export const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tmp/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.git/**',
  '**/spec/fixtures/**',
]

export interface IndexOptions {
  verbose?: boolean
  params?: FingerprintParams
  force?: boolean // re-parse everything, ignoring the cache
}

// Globs the given paths and writes the resulting index in a single pass.
//
// Incremental: files whose mtime and size match the previous index are not
// re-parsed — their units are carried over. The index still only contains
// what was globbed this run, so deleted files (and files outside the given
// paths) drop out. The cache is unusable when the fingerprint params change.
export async function indexPaths(
  paths: string[],
  store: Store,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const { verbose = false, params = DEFAULT_PARAMS, force = false } = options

  const start = Date.now()
  const cache = force ? null : store.fileCache(params)

  const units: CodeUnit[] = []
  const fileMeta = new Map<string, FileMeta>()
  let fileCount = 0
  let parsed = 0
  let reused = 0

  for (const basePath of paths) {
    const files = await glob(FILE_PATTERNS, {
      cwd: basePath,
      absolute: true,
      ignore: IGNORE,
    })

    const total = files.length

    for (const file of files) {
      let meta: FileMeta | null = null
      try {
        const stat = fs.statSync(file)
        meta = { mtimeMs: stat.mtimeMs, size: stat.size }
      } catch {
        // race: file disappeared between glob and stat — skip it
        continue
      }

      const cached = cache?.get(file)
      let fileUnits: CodeUnit[]
      if (cached && cached.meta.mtimeMs === meta.mtimeMs && cached.meta.size === meta.size) {
        fileUnits = cached.units
        reused++
      } else {
        fileUnits = parseFile(file, params)
        parsed++
      }

      units.push(...fileUnits)
      fileMeta.set(file, meta)
      fileCount++

      if (verbose) {
        const tag = cached && fileUnits === cached.units ? 'cached' : 'parsed'
        process.stderr.write(
          `  [${fileCount}/${total}] ${fileUnits.length} units (${tag})  ${file}\n`,
        )
      } else {
        process.stderr.write(`\r  ${fileCount}/${total} files  ${units.length} units`)
      }
    }

    if (!verbose) process.stderr.write('\n')
  }

  store.replaceAll(units, params, fileMeta)

  return {
    files: fileCount,
    units: units.length,
    parsed,
    reused,
    durationMs: Date.now() - start,
  }
}
