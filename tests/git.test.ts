import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { getChangedFiles, fileAtRef, findRepoRoot } from '../src/io/git'
import { UsageError } from '../src/errors'

let tmp: string

function git(args: string[], cwd: string) {
  execFileSync('git', args, { cwd, stdio: 'pipe' })
}

function initRepo(dir: string): void {
  git(['init'], dir)
  git(['config', 'user.email', 'test@test.com'], dir)
  git(['config', 'user.name', 'Test'], dir)
}

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-git-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('findRepoRoot', () => {
  it('returns the repo root when inside a git repository', () => {
    initRepo(tmp)
    const root = findRepoRoot(tmp)
    expect(root).toBeTruthy()
    expect(fs.existsSync(path.join(root!, '.git'))).toBe(true)
  })

  it('returns null when not inside a git repository', () => {
    const nonRepo = path.join(tmp, 'not-a-repo')
    fs.mkdirSync(nonRepo)
    expect(findRepoRoot(nonRepo)).toBeNull()
  })
})

describe('getChangedFiles', () => {
  it('throws UsageError when the directory is not a git repository', () => {
    const nonRepo = path.join(tmp, 'no-git')
    fs.mkdirSync(nonRepo)
    expect(() => getChangedFiles(nonRepo)).toThrow(UsageError)
  })

  it('returns uncommitted changes (staged, unstaged, untracked)', () => {
    initRepo(tmp)

    // Commit a base file
    fs.writeFileSync(path.join(tmp, 'existing.ts'), 'const a = 1\n')
    git(['add', 'existing.ts'], tmp)
    git(['commit', '-m', 'init'], tmp)

    // Staged change
    fs.writeFileSync(path.join(tmp, 'staged.ts'), 'const b = 2\n')
    git(['add', 'staged.ts'], tmp)

    // Unstaged change
    fs.writeFileSync(path.join(tmp, 'unstaged.ts'), 'const c = 3\n')

    // Untracked file
    fs.writeFileSync(path.join(tmp, 'untracked.ts'), 'const d = 4\n')

    const { changedFiles } = getChangedFiles(tmp)
    const names = changedFiles.map(f => path.basename(f.absolutePath)).sort()
    expect(names).toContain('staged.ts')
    expect(names).toContain('untracked.ts')
  })

  it('rejects a base ref that looks like a git option (argument injection)', () => {
    initRepo(tmp)
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a = 1\n')
    git(['add', 'a.ts'], tmp)
    git(['commit', '-m', 'init'], tmp)

    const sentinel = path.join(tmp, 'PWNED')
    expect(() => getChangedFiles(tmp, `--output=${sentinel}`)).toThrow(UsageError)
    // git must never have executed the injected --output flag
    expect(fs.existsSync(sentinel)).toBe(false)
    expect(fs.existsSync(`${sentinel}...HEAD`)).toBe(false)
  })

  it('returns files changed since a base ref', () => {
    initRepo(tmp)

    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a = 1\n')
    git(['add', 'a.ts'], tmp)
    git(['commit', '-m', 'first'], tmp)

    fs.writeFileSync(path.join(tmp, 'b.ts'), 'const b = 2\n')
    git(['add', 'b.ts'], tmp)
    git(['commit', '-m', 'second'], tmp)

    const { changedFiles } = getChangedFiles(tmp, 'HEAD~1')
    const names = changedFiles.map(f => path.basename(f.absolutePath))
    expect(names).toContain('b.ts')
    expect(names).not.toContain('a.ts')
  })

  it('deduplicates files that appear in multiple diff outputs', () => {
    initRepo(tmp)

    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a = 1\n')
    git(['add', 'a.ts'], tmp)
    git(['commit', '-m', 'init'], tmp)

    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a = 2\n')
    git(['add', 'a.ts'], tmp)
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'const a = 3\n')

    const { changedFiles } = getChangedFiles(tmp)
    const paths = changedFiles.map(f => f.absolutePath)
    const unique = new Set(paths)
    expect(paths.length).toBe(unique.size)
  })
})

describe('fileAtRef', () => {
  it('returns file content at a given git ref', () => {
    initRepo(tmp)

    const content = 'const x = 1\n'
    fs.writeFileSync(path.join(tmp, 'f.ts'), content)
    git(['add', 'f.ts'], tmp)
    git(['commit', '-m', 'add f'], tmp)

    const result = fileAtRef(tmp, 'f.ts', 'HEAD')
    expect(result).toBe(content)
  })

  it('returns null when the file did not exist at that ref', () => {
    initRepo(tmp)
    fs.writeFileSync(path.join(tmp, 'a.ts'), 'x\n')
    git(['add', 'a.ts'], tmp)
    git(['commit', '-m', 'init'], tmp)

    expect(fileAtRef(tmp, 'nonexistent.ts', 'HEAD')).toBeNull()
  })

  it('rejects a ref that looks like a git option (argument injection)', () => {
    initRepo(tmp)
    expect(() => fileAtRef(tmp, 'a.ts', '--output=x')).toThrow(UsageError)
  })
})
