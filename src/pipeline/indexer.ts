import { glob } from 'glob'
import { parseFile } from '../lang/parser'
import { Store } from '../io/store'
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
}

// Globs the given paths, parses every supported file, and writes the resulting
// index in a single pass. Always replaces the existing index.
export async function indexPaths(
  paths: string[],
  store: Store,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const { verbose = false, params = DEFAULT_PARAMS } = options

  const start = Date.now()
  const units: CodeUnit[] = []
  let fileCount = 0

  for (const basePath of paths) {
    const files = await glob(FILE_PATTERNS, {
      cwd: basePath,
      absolute: true,
      ignore: IGNORE,
    })

    const total = files.length

    for (const file of files) {
      const parsed = parseFile(file, params)
      units.push(...parsed)

      fileCount++

      if (verbose) {
        process.stderr.write(`  [${fileCount}/${total}] ${parsed.length} units  ${file}\n`)
      } else {
        process.stderr.write(`\r  ${fileCount}/${total} files  ${units.length} units`)
      }
    }

    if (!verbose) process.stderr.write('\n')
  }

  store.replaceAll(units, params)

  return {
    files: fileCount,
    units: units.length,
    durationMs: Date.now() - start,
  }
}
