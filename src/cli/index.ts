#!/usr/bin/env node
import * as path from 'path'
import * as fs from 'fs'
import { minimatch } from 'minimatch'
import { indexPaths, collectFiles } from '../pipeline/indexer'
import { checkFiles } from '../pipeline/checker'
import { isSupportedFile } from '../lang/parser'
import { detectClones } from '../core/detector'
import { groupClones } from '../core/grouping'
import { DEFAULT_PARAMS } from '../core/fingerprint'
import { formatReport, formatCheckReport, countFindings } from '../report/report'
import { getChangedFiles, findRepoRoot } from '../io/git'
import { Store } from '../io/store'
import { loadConfig, resolveExcludes } from '../io/config'
import { UsageError } from '../errors'
import { HELP } from './help'

function parseNumberFlag(
  args: string[],
  prefix: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const match = args.find(arg => arg.startsWith(prefix))
  if (!match) return fallback
  const value = parseFloat(match.slice(prefix.length))
  if (Number.isNaN(value) || value < min || value > max) {
    throw new UsageError(
      `Invalid value for ${prefix.slice(0, -1)}: expected a number between ${min} and ${max}`,
    )
  }
  return value
}

// Repeatable flag: `--exclude=a/** --exclude=b/**` collects both.
function parseRepeatedFlag(args: string[], prefix: string): string[] {
  return args.filter(arg => arg.startsWith(prefix)).map(arg => arg.slice(prefix.length))
}

function parseStringFlag(args: string[], prefix: string): string {
  const match = args.find(arg => arg.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

const progress = (current: number, total: number, label: string) => {
  if (label === 'pairs') {
    process.stderr.write(
      `\x1b[2K\r  matching ${current.toLocaleString()}/${total.toLocaleString()} pairs`,
    )
  } else {
    const shortLabel = label.split('/').slice(-2).join('/')
    process.stderr.write(`\x1b[2K\r  ${current}/${total}  ${shortLabel}`)
  }
}

const clearProgress = () => process.stderr.write('\x1b[2K\r')

// Changed files come from git as repo-relative paths, so the config's globs
// apply directly — no need to route them back through collectFiles.
function isExcluded(repoRelativePath: string, patterns: string[]): boolean {
  return patterns.some(pattern => minimatch(repoRelativePath, pattern, { dot: true }))
}

function requireIndex(store: Store): void {
  if (!store.exists()) {
    throw new UsageError('No index found — run `surgex index` first.')
  }
}

async function runIndex(args: string[]): Promise<void> {
  const targetPaths = args.filter(arg => !arg.startsWith('--'))
  const verbose = args.includes('--verbose') || args.includes('-v')
  const force = args.includes('--force')
  const kGramSize = parseNumberFlag(args, '--kgram=', DEFAULT_PARAMS.k, { min: 2, max: 50 })
  const windowSize = parseNumberFlag(args, '--window=', DEFAULT_PARAMS.w, { min: 1, max: 50 })
  const store = Store.discover()
  const paths = targetPaths.length ? targetPaths : [process.cwd()]
  const exclude = resolveExcludes(loadConfig(store.root), parseRepeatedFlag(args, '--exclude='))

  console.log(`Indexing: ${paths.join(', ')}`)
  const stats = await indexPaths(paths, store, {
    verbose,
    params: { k: kGramSize, w: windowSize },
    force,
    exclude,
  })
  const cacheNote = stats.reused > 0 ? `, ${stats.reused} unchanged from cache` : ''
  console.log(
    `Done: ${stats.units} units across ${stats.files} files ` +
      `(${stats.parsed} parsed${cacheNote}, ${stats.durationMs}ms)`,
  )
}

async function runCheck(args: string[]): Promise<void> {
  const store = Store.discover()
  requireIndex(store)

  const config = loadConfig(store.root)
  const exclude = resolveExcludes(config, parseRepeatedFlag(args, '--exclude='))

  const all = args.includes('--all')
  const from = parseStringFlag(args, '--from=')
  const threshold = parseNumberFlag(args, '--threshold=', config.threshold ?? 0.75, {
    min: 0,
    max: 1,
  })
  const minTokens = parseNumberFlag(args, '--min-tokens=', config.minTokens ?? 20, {
    min: 0,
    max: 100_000,
  })
  const showCode = args.includes('--show-code')
  const json = args.includes('--json')
  const failOnFound = args.includes('--fail-on-found')

  if (all) {
    const allUnits = store.getAll().filter(unit => unit.tokenCount >= minTokens)
    const fileCount = new Set(allUnits.map(unit => unit.file)).size
    process.stderr.write(`Checking ${fileCount} file(s) [all indexed files]\n`)

    const pairs = detectClones(allUnits, { threshold, onProgress: json ? undefined : progress })
    clearProgress()

    const groups = groupClones(pairs)
    process.stdout.write(formatReport(groups, { showCode, json, repoRoot: store.root }))
    if (failOnFound && groups.length > 0) process.exitCode = 1
    return
  }

  const explicitFiles = args.filter(arg => !arg.startsWith('--'))
  let relevant: Array<{ absolutePath: string; repoRelativePath: string }>
  let repoRoot: string
  let label: string

  if (explicitFiles.length > 0) {
    // Anchor at the repo root so relative paths in the report match those used
    // for git-derived changes; fall back to cwd outside a repo.
    repoRoot = findRepoRoot(process.cwd()) ?? process.cwd()
    const expandedFiles: Array<{ absolutePath: string; repoRelativePath: string }> = []
    for (const arg of explicitFiles) {
      const absolutePath = path.resolve(arg)
      if (fs.statSync(absolutePath, { throwIfNoEntry: false })?.isDirectory()) {
        const files = await collectFiles(absolutePath, { exclude })
        for (const file of files) {
          expandedFiles.push({
            absolutePath: file,
            repoRelativePath: path.relative(repoRoot, file),
          })
        }
      } else {
        expandedFiles.push({
          absolutePath,
          repoRelativePath: path.relative(repoRoot, absolutePath),
        })
      }
    }
    relevant = expandedFiles
    label = `${relevant.length} file(s) in ${explicitFiles.join(', ')}`
  } else {
    const gitContext = getChangedFiles(process.cwd(), from || undefined)
    repoRoot = gitContext.repoRoot
    relevant = gitContext.changedFiles.filter(
      file => isSupportedFile(file.absolutePath) && !isExcluded(file.repoRelativePath, exclude),
    )
    label = from ? `branch diff vs ${from}` : 'uncommitted changes'
  }

  if (relevant.length === 0) {
    process.stderr.write('No .ts/.tsx/.rb files found.\n')
    return
  }

  process.stderr.write(`Checking ${relevant.length} file(s) [${label}]\n`)

  const report = checkFiles(relevant, repoRoot, store, {
    threshold,
    minTokens,
    base: from || undefined,
    onProgress: json ? undefined : progress,
  })
  clearProgress()

  process.stdout.write(formatCheckReport(report, repoRoot, { showCode, json }))
  if (failOnFound && countFindings(report) > 0) process.exitCode = 1
}

async function main(argv: string[]): Promise<void> {
  const [command, ...args] = argv

  switch (command) {
    case 'index':
      return runIndex(args)
    case 'check':
      return runCheck(args)
    case 'report':
      // alias for `check --all`
      return runCheck(['--all', ...args])
    default:
      console.log(HELP)
  }
}

main(process.argv.slice(2)).catch(error => {
  if (error instanceof UsageError) {
    console.error(`Error: ${error.message}`)
  } else {
    console.error(error)
  }
  process.exit(1)
})
