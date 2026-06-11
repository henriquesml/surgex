import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { readLines } from '../src/io/source'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-source-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('readLines', () => {
  it('reads an inclusive 1-based line range', () => {
    const file = path.join(tmp, 'a.ts')
    fs.writeFileSync(file, 'line1\nline2\nline3\nline4\n')
    expect(readLines(file, 2, 3)).toEqual(['line2', 'line3'])
  })

  it('returns a single line when start equals end', () => {
    const file = path.join(tmp, 'b.ts')
    fs.writeFileSync(file, 'only\n')
    expect(readLines(file, 1, 1)).toEqual(['only'])
  })

  it('returns [] for a file that does not exist', () => {
    expect(readLines(path.join(tmp, 'missing.ts'), 1, 5)).toEqual([])
  })

  it('serves repeated reads of the same file from cache', () => {
    const file = path.join(tmp, 'cache.ts')
    fs.writeFileSync(file, 'a\nb\nc\n')
    expect(readLines(file, 1, 1)).toEqual(['a'])
    // second read hits the cache (same mtime) and returns a different range
    expect(readLines(file, 2, 3)).toEqual(['b', 'c'])
  })

  it('re-reads when the file changes (mtime invalidates the cache)', () => {
    const file = path.join(tmp, 'changing.ts')
    fs.writeFileSync(file, 'old\n')
    expect(readLines(file, 1, 1)).toEqual(['old'])
    // bump mtime into the future so the cached entry is considered stale
    const future = new Date(Date.now() + 10_000)
    fs.writeFileSync(file, 'new\n')
    fs.utimesSync(file, future, future)
    expect(readLines(file, 1, 1)).toEqual(['new'])
  })
})
