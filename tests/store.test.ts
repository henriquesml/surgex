import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Store } from '../src/io/store'
import { UsageError } from '../src/errors'
import type { CodeUnit } from '../src/types'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-store-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeUnit(file: string): CodeUnit {
  return {
    file,
    startLine: 1,
    endLine: 5,
    name: 'foo',
    type: 'function',
    language: 'typescript',
    tokenCount: 30,
    fingerprint: [1, 2, 3],
  }
}

describe('Store', () => {
  it('stores file paths relative to the project root and resolves them on load', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([makeUnit(path.join(tmp, 'src/foo.ts'))])

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, '.surgex/index.json'), 'utf8'))
    expect(onDisk.units[0].file).toBe('src/foo.ts')

    const loaded = store.getAll()
    expect(loaded[0].file).toBe(path.join(tmp, 'src/foo.ts'))
  })

  it('persists fingerprint params', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([], { k: 7, w: 3 })
    expect(new Store(path.join(tmp, '.surgex')).params()).toEqual({ k: 7, w: 3 })
  })

  it('reports existence', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    expect(store.exists()).toBe(false)
    store.replaceAll([])
    expect(store.exists()).toBe(true)
  })

  it('rejects corrupted JSON with a friendly error', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(path.join(tmp, '.surgex/index.json'), 'not json')
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(UsageError)
  })

  it('rejects indexes with a malformed schema', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({ version: 2, params: { k: 5, w: 4 }, files: {}, units: [{ bogus: true }] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/malformed unit/)
  })

  it('rejects indexes with malformed file entries', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({
        version: 2,
        params: { k: 5, w: 4 },
        files: { 'a.ts': { mtimeMs: 'nope' } },
        units: [],
      }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/malformed file entry/)
  })

  it('rejects indexes from older format versions', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({ version: 1, params: { k: 5, w: 4 }, units: [] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/unsupported version/)
  })

  it('rejects pre-versioned indexes', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(path.join(tmp, '.surgex/index.json'), JSON.stringify({ nextId: 1, units: [] }))
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/unsupported version/)
  })

  describe('fileCache', () => {
    it('round-trips file metadata and units keyed by absolute path', () => {
      const store = new Store(path.join(tmp, '.surgex'))
      const file = path.join(tmp, 'src/foo.ts')
      const meta = { mtimeMs: 123.45, size: 678 }
      store.replaceAll([makeUnit(file)], { k: 5, w: 4 }, new Map([[file, meta]]))

      const cache = new Store(path.join(tmp, '.surgex')).fileCache({ k: 5, w: 4 })
      expect(cache).not.toBeNull()
      const entry = cache!.get(file)
      expect(entry?.meta).toEqual(meta)
      expect(entry?.units).toHaveLength(1)
      expect(entry?.units[0].file).toBe(file)
      expect(entry?.units[0].fingerprint).toEqual([1, 2, 3])
    })

    it('keeps entries for files that produced no units', () => {
      const store = new Store(path.join(tmp, '.surgex'))
      const file = path.join(tmp, 'src/empty.ts')
      store.replaceAll([], { k: 5, w: 4 }, new Map([[file, { mtimeMs: 1, size: 0 }]]))

      const cache = store.fileCache({ k: 5, w: 4 })
      expect(cache!.get(file)?.units).toEqual([])
    })

    it('returns null when fingerprint params differ', () => {
      const store = new Store(path.join(tmp, '.surgex'))
      store.replaceAll([], { k: 5, w: 4 }, new Map())
      expect(store.fileCache({ k: 7, w: 4 })).toBeNull()
    })

    it('returns null when no index exists', () => {
      expect(new Store(path.join(tmp, '.surgex')).fileCache({ k: 5, w: 4 })).toBeNull()
    })
  })

  describe('discover', () => {
    it('finds the nearest .surgex walking up', () => {
      fs.mkdirSync(path.join(tmp, '.surgex'))
      fs.mkdirSync(path.join(tmp, 'src/deep'), { recursive: true })
      const store = Store.discover(path.join(tmp, 'src/deep'))
      expect(store.dir).toBe(path.join(tmp, '.surgex'))
    })

    it('does not walk above a git repository root', () => {
      // .surgex above the repo root must be ignored
      fs.mkdirSync(path.join(tmp, '.surgex'))
      fs.mkdirSync(path.join(tmp, 'repo/.git'), { recursive: true })
      fs.mkdirSync(path.join(tmp, 'repo/src'), { recursive: true })
      const store = Store.discover(path.join(tmp, 'repo/src'))
      expect(store.dir).toBe(path.join(tmp, 'repo/src/.surgex'))
    })
  })
})
