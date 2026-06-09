import { execSync } from 'child_process'
import * as path from 'path'

export interface ChangedFile {
  absolutePath: string
  repoRelativePath: string
}

export interface GitContext {
  repoRoot: string
  changedFiles: ChangedFile[]
}

function run(cmd: string, cwd: string): string {
  return execSync(cmd, { cwd, encoding: 'utf8' }).trim()
}

function isGitRepo(dir: string): boolean {
  try { run('git rev-parse --git-dir', dir); return true }
  catch { return false }
}

function repoRoot(cwd: string): string {
  return run('git rev-parse --show-toplevel', cwd)
}

function listChanged(root: string, filter: string): ChangedFile[] {
  const out = run(`git diff --name-only --diff-filter=ACM ${filter}`, root)
  return out.split('\n').filter(Boolean).map(rel => ({
    absolutePath: path.join(root, rel),
    repoRelativePath: rel,
  }))
}

function listUntracked(root: string): ChangedFile[] {
  const out = run('git ls-files --others --exclude-standard', root)
  return out.split('\n').filter(Boolean).map(rel => ({
    absolutePath: path.join(root, rel),
    repoRelativePath: rel,
  }))
}

export function getChangedFiles(cwd: string, from?: string): GitContext {
  if (!isGitRepo(cwd)) throw new Error(`Not a git repository: ${cwd}`)

  const root = repoRoot(cwd)
  const filter = from ? `${from}...HEAD` : 'HEAD'

  const changed = from
    ? listChanged(root, filter)
    : [
        ...listChanged(root, '--cached'),
        ...listChanged(root, ''),
        ...listUntracked(root),
      ]

  const seen = new Set<string>()
  const changedFiles = changed.filter(f => {
    if (seen.has(f.absolutePath)) return false
    seen.add(f.absolutePath)
    return true
  })

  return { repoRoot: root, changedFiles }
}

// Returns the content of a file at a given git ref, or null if it didn't exist
export function fileAtRef(repoRoot: string, repoRelativePath: string, ref: string): string | null {
  try {
    return execSync(`git show ${ref}:${repoRelativePath}`, {
      cwd: repoRoot,
      encoding: 'utf8',
      stdio: ['pipe', 'pipe', 'pipe'],  // suppress stderr
    })
  } catch {
    return null
  }
}
