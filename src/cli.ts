#!/usr/bin/env ts-node
import * as path from 'path'
import { indexPaths } from './indexer'
import { detectClones } from './detector'
import { groupClones, formatReport } from './reporter'
import { getChangedFiles } from './git'
import { checkFiles, formatCheckReport } from './checker'
import { getAllUnits } from './store'

function parseFlag<T>(args: string[], prefix: string, fallback: T): T {
  const match = args.find(a => a.startsWith(prefix))
  if (!match) return fallback
  const raw = match.slice(prefix.length)
  if (typeof fallback === 'number') return parseFloat(raw) as unknown as T
  return raw as unknown as T
}

const progress = (current: number, total: number, label: string) => {
  if (label === 'pairs') {
    process.stderr.write(`\x1b[2K\r  matching ${current.toLocaleString()}/${total.toLocaleString()} pairs`)
  } else {
    const short = label.split('/').slice(-2).join('/')
    process.stderr.write(`\x1b[2K\r  ${current}/${total}  ${short}`)
  }
}

const clearProgress = () => process.stderr.write('\x1b[2K\r')

const [,, command, ...args] = process.argv

async function main() {
  switch (command) {
    case 'index': {
      const targets = args.filter(a => !a.startsWith('--'))
      const verbose = args.includes('--verbose') || args.includes('-v')

      console.log(`Indexing: ${(targets.length ? targets : [process.cwd()]).join(', ')}`)
      const stats = await indexPaths(targets.length ? targets : [process.cwd()], { reset: true, verbose })
      console.log(`Done: ${stats.units} units across ${stats.files} files (${stats.durationMs}ms)`)
      break
    }

    case 'report':
      // alias for `check --all`
      process.argv.splice(2, 1, 'check', '--all')
      return main()

    case 'check': {
      const all        = args.includes('--all')
      const from       = parseFlag(args, '--from=', '')
      const threshold  = parseFlag(args, '--threshold=', 0.75)
      const minTokens  = parseFlag(args, '--min-tokens=', 20)
      const showCode   = args.includes('--show-code')

      if (all) {
        const allUnits = getAllUnits().filter(u => u.tokenCount >= minTokens)
        const fileCount = new Set(allUnits.map(u => u.file)).size
        process.stderr.write(`Checking ${fileCount} file(s) [all indexed files]\n`)

        const pairs = detectClones({ threshold, minTokens, onProgress: progress })
        clearProgress()

        const groups = groupClones(pairs)
        process.stdout.write(formatReport(groups, { showCode }))
        break
      }

      const explicitFiles = args.filter(a => !a.startsWith('--'))
      let relevant: Array<{ absolutePath: string; repoRelativePath: string }>
      let repoRoot: string
      let label: string

      if (explicitFiles.length > 0) {
        repoRoot = process.cwd()
        relevant = explicitFiles.map(f => ({
          absolutePath: path.resolve(f),
          repoRelativePath: f,
        }))
        label = `${relevant.length} file(s) specified`
      } else {
        const git = getChangedFiles(process.cwd(), from || undefined)
        repoRoot = git.repoRoot
        relevant = git.changedFiles.filter(f => /\.(ts|tsx|rb)$/.test(f.absolutePath))
        label = from ? `branch diff vs ${from}` : 'uncommitted changes'
      }

      if (relevant.length === 0) {
        process.stderr.write('No .ts/.tsx/.rb files found.\n')
        break
      }

      process.stderr.write(`Checking ${relevant.length} file(s) [${label}]\n`)

      const results = checkFiles(relevant, repoRoot, {
        threshold, minTokens, base: from || undefined,
        onProgress: progress,
      })
      clearProgress()

      process.stdout.write(formatCheckReport(results, repoRoot, { showCode }))
      break
    }

    default:
      console.log([
        'dry — deterministic code clone detector',
        '',
        'Commands:',
        '  dry index [paths...]          Index the codebase (default: cwd)',
        '    --verbose                   Print each indexed file',
        '',
        '  dry check                     Check for duplicates',
        '    (no flags)                  Uncommitted changes vs index',
        '    --all                       All indexed files (full scan)',
        '    --from=main                 Branch diff vs base ref',
        '    [files...]                  Specific files vs index',
        '    --threshold=0.75            Similarity cutoff (default: 0.75)',
        '    --min-tokens=20             Ignore small units (default: 20)',
        '    --show-code                 Show duplicated lines side by side',
      ].join('\n'))
  }
}

main().catch(err => {
  console.error(err)
  process.exit(1)
})
