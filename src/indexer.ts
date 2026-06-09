import { glob } from 'glob'
import { parseFile } from './parser'
import { saveUnits, clearFile, clearAll, countUnits } from './store'
import type { IndexStats } from './types'

const FILE_PATTERNS = ['**/*.ts', '**/*.tsx', '**/*.rb']

const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tmp/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.git/**',
  '**/spec/fixtures/**',
]

export interface IndexOptions {
  reset?: boolean
  verbose?: boolean
}

export async function indexPaths(paths: string[], options: IndexOptions = {}): Promise<IndexStats> {
  const { reset = false, verbose = false } = options

  if (reset) clearAll()

  const start = Date.now()
  let fileCount = 0
  let unitCount = 0

  for (const basePath of paths) {
    const files = await glob(FILE_PATTERNS, {
      cwd: basePath,
      absolute: true,
      ignore: IGNORE,
    })

    const total = files.length

    for (const file of files) {
      clearFile(file)
      const units = parseFile(file)
      if (units.length > 0) saveUnits(units)

      fileCount++
      unitCount += units.length

      if (verbose) {
        process.stderr.write(`  [${fileCount}/${total}] ${units.length} units  ${file}\n`)
      } else {
        process.stderr.write(`\r  ${fileCount}/${total} files  ${unitCount} units`)
      }
    }

    if (!verbose) process.stderr.write('\n')
  }

  return {
    files: fileCount,
    units: countUnits(),
    durationMs: Date.now() - start,
  }
}
