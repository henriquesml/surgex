#!/usr/bin/env node
import * as path from 'path'
import * as fs from 'fs'
import { glob } from 'glob'
import { indexPaths, FILE_PATTERNS, IGNORE } from '../pipeline/indexer'
import { checkFiles } from '../pipeline/checker'
import { detectClones } from '../core/detector'
import { groupClones } from '../core/grouping'
import { DEFAULT_PARAMS } from '../core/fingerprint'
import { formatReport, formatCheckReport, countFindings } from '../report/report'
import { getChangedFiles } from '../io/git'
import { Store } from '../io/store'
import { UsageError } from '../errors'
import { HELP } from './help'

function parseNumberFlag(
  args: string[],
  prefix: string,
  fallback: number,
  { min, max }: { min: number; max: number },
): number {
  const match = args.find(a => a.startsWith(prefix))
  if (!match) return fallback
  const value = parseFloat(match.slice(prefix.length))
  if (Number.isNaN(value) || value < min || value > max) {
    throw new UsageError(
      `Invalid value for ${prefix.slice(0, -1)}: expected a number between ${min} and ${max}`,
    )
  }
  return value
}

function parseStringFlag(args: string[], prefix: string): string {
  const match = args.find(a => a.startsWith(prefix))
  return match ? match.slice(prefix.length) : ''
}

const progress = (current: number, total: number, label: string) => {
  if (label === 'pairs') {
    process.stderr.write(
      `\x1b[2K\r  matching ${current.toLocaleString()}/${total.toLocaleString()} pairs`,
    )
  } else {
    const short = label.split('/').slice(-2).join('/')
    process.stderr.write(`\x1b[2K\r  ${current}/${total}  ${short}`)
  }
}

const clearProgress = () => process.stderr.write('\x1b[2K\r')

function requireIndex(store: Store): void {
  if (!store.exists()) {
    throw new UsageError('No index found — run `surgex index` first.')
  }
}

async function runIndex(args: string[]): Promise<void> {
  const targets = args.filter(a => !a.startsWith('--'))
  const verbose = args.includes('--verbose') || args.includes('-v')
  const force = args.includes('--force')
  const k = parseNumberFlag(args, '--kgram=', DEFAULT_PARAMS.k, { min: 2, max: 50 })
  const w = parseNumberFlag(args, '--window=', DEFAULT_PARAMS.w, { min: 1, max: 50 })
  const paths = targets.length ? targets : [process.cwd()]

  console.log(`Indexing: ${paths.join(', ')}`)
  const store = Store.discover()
  const stats = await indexPaths(paths, store, { verbose, params: { k, w }, force })
  const cacheNote = stats.reused > 0 ? `, ${stats.reused} unchanged from cache` : ''
  console.log(
    `Done: ${stats.units} units across ${stats.files} files ` +
      `(${stats.parsed} parsed${cacheNote}, ${stats.durationMs}ms)`,
  )
}

async function runCheck(args: string[]): Promise<void> {
  const store = Store.discover()
  requireIndex(store)

  const all = args.includes('--all')
  const from = parseStringFlag(args, '--from=')
  const threshold = parseNumberFlag(args, '--threshold=', 0.75, { min: 0, max: 1 })
  const minTokens = parseNumberFlag(args, '--min-tokens=', 20, { min: 0, max: 100_000 })
  const showCode = args.includes('--show-code')
  const json = args.includes('--json')
  const failOnFound = args.includes('--fail-on-found')

  if (all) {
    const allUnits = store.getAll().filter(u => u.tokenCount >= minTokens)
    const fileCount = new Set(allUnits.map(u => u.file)).size
    process.stderr.write(`Checking ${fileCount} file(s) [all indexed files]\n`)

    const pairs = detectClones(allUnits, { threshold, onProgress: json ? undefined : progress })
    clearProgress()

    const groups = groupClones(pairs)
    process.stdout.write(formatReport(groups, { showCode, json, repoRoot: store.root }))
    if (failOnFound && groups.length > 0) process.exitCode = 1
    return
  }

  const explicitFiles = args.filter(a => !a.startsWith('--'))
  let relevant: Array<{ absolutePath: string; repoRelativePath: string }>
  let repoRoot: string
  let label: string

  if (explicitFiles.length > 0) {
    repoRoot = process.cwd()
    const expanded: Array<{ absolutePath: string; repoRelativePath: string }> = []
    for (const arg of explicitFiles) {
      const abs = path.resolve(arg)
      if (fs.statSync(abs, { throwIfNoEntry: false })?.isDirectory()) {
        const files = await glob(FILE_PATTERNS, {
          cwd: abs,
          absolute: true,
          ignore: IGNORE,
        })
        for (const f of files) {
          expanded.push({ absolutePath: f, repoRelativePath: path.relative(repoRoot, f) })
        }
      } else {
        expanded.push({ absolutePath: abs, repoRelativePath: arg })
      }
    }
    relevant = expanded
    label = `${relevant.length} file(s) in ${explicitFiles.join(', ')}`
  } else {
    const git = getChangedFiles(process.cwd(), from || undefined)
    repoRoot = git.repoRoot
    relevant = git.changedFiles.filter(f => /\.(ts|tsx|rb)$/.test(f.absolutePath))
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

main(process.argv.slice(2)).catch(err => {
  if (err instanceof UsageError) {
    console.error(`Error: ${err.message}`)
  } else {
    console.error(err)
  }
  process.exit(1)
})
