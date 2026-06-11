import { execFileSync } from 'child_process'
import * as path from 'path'
import { UsageError } from '../errors'

export interface ChangedFile {
  absolutePath: string
  repoRelativePath: string
}

export interface GitContext {
  repoRoot: string
  changedFiles: ChangedFile[]
}

// All git invocations go through execFileSync with an argument array: nothing
// is ever interpolated into a shell string, so file names and refs containing
// shell metacharacters (`$(...)`, backticks, spaces) are passed through safely.
function git(args: string[], cwd: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8' }).trim()
}

// A caller-supplied ref reaches git as part of a larger token (`<ref>...HEAD`,
// `<ref>:<path>`). Even though execFileSync never invokes a shell, a ref like
// `--output=/etc/passwd` is parsed by git itself as an *option*, not a revision
// — argument injection. We reject refs that look like options and pass
// `--end-of-options` at the call sites as a second line of defence.
function assertSafeRef(ref: string): void {
  if (ref.startsWith('-')) {
    throw new UsageError(`Invalid git ref: ${ref} (must not start with "-")`)
  }
}

function isGitRepo(dir: string): boolean {
  try {
    git(['rev-parse', '--git-dir'], dir)
    return true
  } catch {
    return false
  }
}

function repoRoot(cwd: string): string {
  return git(['rev-parse', '--show-toplevel'], cwd)
}

function listChanged(root: string, extraArgs: string[]): ChangedFile[] {
  const output = git(['diff', '--name-only', '--diff-filter=ACM', ...extraArgs], root)
  return output
    .split('\n')
    .filter(Boolean)
    .map(relativePath => ({
      absolutePath: path.join(root, relativePath),
      repoRelativePath: relativePath,
    }))
}

function listUntracked(root: string): ChangedFile[] {
  const output = git(['ls-files', '--others', '--exclude-standard'], root)
  return output
    .split('\n')
    .filter(Boolean)
    .map(relativePath => ({
      absolutePath: path.join(root, relativePath),
      repoRelativePath: relativePath,
    }))
}

export function getChangedFiles(cwd: string, from?: string): GitContext {
  if (!isGitRepo(cwd)) throw new UsageError(`Not a git repository: ${cwd}`)

  const root = repoRoot(cwd)

  if (from) assertSafeRef(from)
  const changed = from
    ? listChanged(root, ['--end-of-options', `${from}...HEAD`])
    : [...listChanged(root, ['--cached']), ...listChanged(root, []), ...listUntracked(root)]

  const seenPaths = new Set<string>()
  const changedFiles = changed.filter(file => {
    if (seenPaths.has(file.absolutePath)) return false
    seenPaths.add(file.absolutePath)
    return true
  })

  return { repoRoot: root, changedFiles }
}

// Returns the content of a file at a given git ref, or null if it didn't exist
export function fileAtRef(repoRoot: string, repoRelativePath: string, ref: string): string | null {
  assertSafeRef(ref)
  try {
    return execFileSync('git', ['show', '--end-of-options', `${ref}:${repoRelativePath}`], {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'], // suppress stderr
    })
  } catch {
    return null
  }
}

// Finds the git repository root containing `dir`, or null if not in a repo.
export function findRepoRoot(dir: string): string | null {
  try {
    return repoRoot(dir)
  } catch {
    return null
  }
}
