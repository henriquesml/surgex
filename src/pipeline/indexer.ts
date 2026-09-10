import * as fs from 'fs'
import * as path from 'path'
import { glob } from 'glob'
import { minimatch } from 'minimatch'
import { parseFile, isSupportedFile } from '../lang/parser'
import { listRepoFiles, findRepoRoot } from '../io/git'
import { Store, type FileMeta } from '../io/store'
import { DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import type { CodeUnit, IndexStats } from '../types'

// Shared by `index` and by `check <dir>` so both walks see the same files.
// Kept in step with `isSupportedFile`, which decides the same question for the
// git-diff path in `check`.
export const FILE_PATTERNS = [
  '**/*.ts',
  '**/*.tsx',
  '**/*.rb',
  '**/*.rake',
  '**/*.gemspec',
  '**/*.ru',
  '**/*.jbuilder',
  '**/Rakefile',
  '**/*.erb',
]

// The walk runs with `dot: true`, so dot-directories holding dependencies or
// build output have to be named here — otherwise a cache full of vendored
// sources would be indexed as if it were project code.
export const IGNORE = [
  '**/node_modules/**',
  '**/dist/**',
  '**/tmp/**',
  '**/vendor/**',
  '**/coverage/**',
  '**/.git/**',
  '**/.surgex/**',
  '**/.cache/**',
  '**/.bundle/**',
  '**/.venv/**',
  '**/.next/**',
  '**/.yarn/**',
  '**/spec/fixtures/**',
]

export interface CollectOptions {
  // Globs from `surgex.json` and `--exclude`, matched against project-root
  // relative paths so a config can say `engines/ui/**` and mean it.
  exclude?: string[]
}

// The files a run looks at, as absolute paths.
//
// Inside a git repository the listing comes from git — tracked plus untracked
// but not ignored — so `.gitignore` is honoured and dot-directories are neither
// blanket-skipped nor blindly walked: `.rubocop/cop/custom/*.rb` is real code
// and is seen, while an ignored `.claude/` holding gigabytes of runtime state
// is not. Outside a repository this falls back to a glob over the same patterns.
export async function collectFiles(
  basePath: string,
  options: CollectOptions = {},
): Promise<string[]> {
  const root = findRepoRoot(basePath) ?? basePath
  const patterns = [...IGNORE, ...(options.exclude ?? [])]
  const keep = (file: string) => {
    const relativePath = path.relative(root, file)
    return !patterns.some(pattern => minimatch(relativePath, pattern, { dot: true }))
  }

  const repoFiles = listRepoFiles(basePath)
  if (repoFiles) return repoFiles.filter(file => isSupportedFile(file) && keep(file))

  const globbed = await glob(FILE_PATTERNS, { cwd: basePath, absolute: true, dot: true })
  return globbed.filter(keep)
}

export interface IndexOptions {
  verbose?: boolean
  params?: FingerprintParams
  force?: boolean // re-parse everything, ignoring the cache
  exclude?: string[]
}

// Collects the given paths and writes the resulting index in a single pass.
//
// Incremental: files whose mtime and size match the previous index are not
// re-parsed — their units are carried over. The index still only contains
// what was collected this run, so deleted files (and files outside the given
// paths) drop out. The cache is unusable when the fingerprint params change.
export async function indexPaths(
  paths: string[],
  store: Store,
  options: IndexOptions = {},
): Promise<IndexStats> {
  const { verbose = false, params = DEFAULT_PARAMS, force = false, exclude = [] } = options

  const start = Date.now()
  const cache = force ? null : store.fileCache(params)

  const units: CodeUnit[] = []
  const fileMeta = new Map<string, FileMeta>()
  let fileCount = 0
  let parsed = 0
  let reused = 0

  for (const basePath of paths) {
    const files = await collectFiles(basePath, { exclude })

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
