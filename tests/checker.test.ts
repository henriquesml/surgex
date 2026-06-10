import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
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
})
