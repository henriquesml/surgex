import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { execFileSync } from 'child_process'
import { Store } from '../src/io/store'
import { checkFiles } from '../src/pipeline/checker'
import { parseFile } from '../src/lang/parser'

const CLONE_A = `export function useProducts(token) {
  const items = fetchData(token)
  if (!items) { throw new Error('no data') }
  return items.map(i => i.id)
}
`

const CLONE_B = CLONE_A.replace(/useProducts/g, 'useCategories')
  .replace(/items/g, 'list')
  .replace(/'no data'/g, "'missing'")

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-check-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function write(rel: string, content: string): string {
  const abs = path.join(tmp, rel)
  fs.mkdirSync(path.dirname(abs), { recursive: true })
  fs.writeFileSync(abs, content)
  return abs
}

describe('checkFiles', () => {
  it('matches a new unit against the index', () => {
    const indexedFile = write('src/existing.ts', CLONE_A)
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll(parseFile(indexedFile))

    const newFile = write('src/new.ts', CLONE_B)
    const report = checkFiles(
      [{ absolutePath: newFile, repoRelativePath: 'src/new.ts' }],
      tmp,
      store,
    )

    expect(report.files).toHaveLength(1)
    expect(report.files[0].insertions).toHaveLength(1)
    expect(report.files[0].insertions[0].similarity).toBe(1)
    expect(report.files[0].insertions[0].existing.file).toBe(indexedFile)
  })

  it('detects clones within the changeset itself (not in the index)', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([]) // empty index

    const fileA = write('src/a.ts', CLONE_A)
    const fileB = write('src/b.ts', CLONE_B)
    const report = checkFiles(
      [
        { absolutePath: fileA, repoRelativePath: 'src/a.ts' },
        { absolutePath: fileB, repoRelativePath: 'src/b.ts' },
      ],
      tmp,
      store,
    )

    expect(report.files).toHaveLength(0) // nothing in the index to match
    expect(report.internal).toHaveLength(1)
    expect(report.internal[0].units).toHaveLength(2)
    expect(report.internal[0].similarity).toBe(1)
  })

  it('does not match a unit against its own file in the index', () => {
    const file = write('src/self.ts', CLONE_A)
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll(parseFile(file))

    const report = checkFiles([{ absolutePath: file, repoRelativePath: 'src/self.ts' }], tmp, store)
    expect(report.files).toHaveLength(0)
  })

  it('calls onProgress for each file checked', () => {
    const indexedFile = write('src/existing.ts', CLONE_A)
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll(parseFile(indexedFile))

    const newFile = write('src/new.ts', CLONE_B)
    const progressEvents: string[] = []
    checkFiles([{ absolutePath: newFile, repoRelativePath: 'src/new.ts' }], tmp, store, {
      onProgress: (_current, _total, file) => progressEvents.push(file),
    })
    expect(progressEvents).toContain(newFile)
  })

  it('skips files that produce no units', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([])
    const empty = write('src/empty.ts', '')
    const report = checkFiles(
      [{ absolutePath: empty, repoRelativePath: 'src/empty.ts' }],
      tmp,
      store,
    )
    expect(report.files).toHaveLength(0)
    expect(report.internal).toHaveLength(0)
  })

  it('returns no matches when indexed files exist but share no fingerprint hashes', () => {
    const indexedFile = write('src/existing.ts', CLONE_A)
    const unrelated = write(
      'src/unrelated.ts',
      `export function maybeProducts(token) {
  const items = fetchData(token)
  if (!items) { return [] }
  const total = items.reduce((sum, item) => sum + item.id, 0)
  return [total]
}
`,
    )
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll(parseFile(indexedFile))

    const report = checkFiles(
      [{ absolutePath: unrelated, repoRelativePath: 'src/unrelated.ts' }],
      tmp,
      store,
    )

    expect(report.files).toEqual([])
    expect(report.internal).toEqual([])
  })

  it('picks the best indexed match and sorts multiple findings by similarity', () => {
    const exactIndexed = write('src/exact.ts', CLONE_A)
    const weakerIndexed = write(
      'src/weaker.ts',
      CLONE_A.replace('return items.map(i => i.id)', 'return items.map(i => i.id).filter(Boolean)'),
    )

    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([...parseFile(weakerIndexed), ...parseFile(exactIndexed)])

    const newFile = write(
      'src/new.ts',
      [CLONE_B, CLONE_A.replace('useProducts', 'useSuppliers')].join('\n\n'),
    )

    const report = checkFiles(
      [{ absolutePath: newFile, repoRelativePath: 'src/new.ts' }],
      tmp,
      store,
    )

    expect(report.files).toHaveLength(1)
    expect(report.files[0].insertions).toHaveLength(2)
    expect(report.files[0].insertions[0].similarity).toBeGreaterThanOrEqual(
      report.files[0].insertions[1].similarity,
    )
    expect(report.files[0].insertions[0].existing.file).toBe(exactIndexed)
  })

  describe('with base ref', () => {
    function git(args: string[]) {
      execFileSync('git', args, { cwd: tmp, stdio: 'pipe' })
    }

    beforeEach(() => {
      git(['init'])
      git(['config', 'user.email', 'test@test.com'])
      git(['config', 'user.name', 'Test'])
    })

    it('classifies a unit not in base as an insertion', () => {
      write('src/base.ts', CLONE_A)
      git(['add', 'src/base.ts'])
      git(['commit', '-m', 'base'])

      const indexedFile = write('src/indexed.ts', CLONE_A)
      const store = new Store(path.join(tmp, '.surgex'))
      store.replaceAll(parseFile(indexedFile))

      // New file not in base — all its units are insertions
      const newFile = write('src/new.ts', CLONE_B)
      git(['add', 'src/new.ts'])
      const report = checkFiles(
        [{ absolutePath: newFile, repoRelativePath: 'src/new.ts' }],
        tmp,
        store,
        { base: 'HEAD' },
      )
      expect(report.files[0]?.insertions.length).toBeGreaterThan(0)
    })

    it('classifies a structurally changed unit as a modification', () => {
      write('src/a.ts', CLONE_A)
      git(['add', 'src/a.ts'])
      git(['commit', '-m', 'base'])

      const indexedFile = write('src/indexed.ts', CLONE_A)
      const store = new Store(path.join(tmp, '.surgex'))
      store.replaceAll(parseFile(indexedFile))

      // Overwrite with structurally different content
      const changed = CLONE_A.replace(
        '  return items.map(i => i.id)\n',
        '  return items.filter(Boolean).map(i => i.id)\n',
      )
      write('src/a.ts', changed)

      const report = checkFiles(
        [{ absolutePath: path.join(tmp, 'src/a.ts'), repoRelativePath: 'src/a.ts' }],
        tmp,
        store,
        { base: 'HEAD' },
      )
      expect(report.files).toHaveLength(1)
      expect(report.files[0].modifications).toHaveLength(1)
      expect(report.files[0].modifications[0].existing.file).toBe(indexedFile)
    })

    it('handles a file with duplicate unit names (occurrenceKeys)', () => {
      // Ruby files can have multiple methods with the same name; TypeScript can too
      const twoFns = CLONE_A + '\n' + CLONE_A.replace('useProducts', 'useProducts')
      write('src/dup.ts', twoFns)
      git(['add', 'src/dup.ts'])
      git(['commit', '-m', 'dup'])

      const store = new Store(path.join(tmp, '.surgex'))
      store.replaceAll([])

      const report = checkFiles(
        [{ absolutePath: path.join(tmp, 'src/dup.ts'), repoRelativePath: 'src/dup.ts' }],
        tmp,
        store,
        { base: 'HEAD' },
      )
      // Exercises occurrenceKeys with same-named units — should not throw
      expect(report).toBeDefined()
    })
  })
})
