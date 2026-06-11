import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { execFileSync } from 'child_process'
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

  it('preserves relative file paths passed directly to replaceAll', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([makeUnit('src/foo.ts')])

    const onDisk = JSON.parse(fs.readFileSync(path.join(tmp, '.surgex/index.json'), 'utf8'))
    expect(onDisk.units[0].file).toBe('src/foo.ts')
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
      JSON.stringify({ version: 3, params: { k: 5, w: 4 }, files: {}, units: [{ bogus: true }] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/malformed unit/)
  })

  it('rejects indexes with malformed file entries', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({
        version: 3,
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

  it('rejects indexes whose top-level JSON is null', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(path.join(tmp, '.surgex/index.json'), 'null')
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/not an object/)
  })

  describe('fileCache', () => {
    it('round-trips file metadata and units keyed by absolute path', () => {
      const store = new Store(path.join(tmp, '.surgex'))
      const file = path.join(tmp, 'src/foo.ts')
      const meta = { mtimeMs: 123.45, size: 678 }
      store.replaceAll(
        [makeUnit(file), { ...makeUnit(file), name: 'bar' }],
        { k: 5, w: 4 },
        new Map([[file, meta]]),
      )

      const cache = new Store(path.join(tmp, '.surgex')).fileCache({ k: 5, w: 4 })
      expect(cache).not.toBeNull()
      const entry = cache!.get(file)
      expect(entry?.meta).toEqual(meta)
      expect(entry?.units).toHaveLength(2)
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

  it('writes the index atomically, leaving no temp file behind', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    store.replaceAll([makeUnit(path.join(tmp, 'a.ts'))])

    const leftovers = fs
      .readdirSync(path.join(tmp, '.surgex'))
      .filter(name => name.includes('.tmp'))
    expect(leftovers).toEqual([])
    // the index itself is valid and reloadable
    expect(new Store(path.join(tmp, '.surgex')).count()).toBe(1)
  })

  it('cleans up the temp file and rethrows when the atomic rename fails', () => {
    const surgexDir = path.join(tmp, '.surgex')
    // Make the index path a non-empty directory so renaming a file onto it
    // fails — exercising the cleanup-and-rethrow path without mocking fs.
    fs.mkdirSync(path.join(surgexDir, 'index.json'), { recursive: true })
    fs.writeFileSync(path.join(surgexDir, 'index.json', 'keep'), 'x')

    const store = new Store(surgexDir)
    expect(() => store.replaceAll([makeUnit(path.join(tmp, 'a.ts'))])).toThrow()

    // the half-written temp file was removed
    const leftovers = fs.readdirSync(surgexDir).filter(name => name.includes('.tmp'))
    expect(leftovers).toEqual([])
  })

  it('count returns the number of stored units', () => {
    const store = new Store(path.join(tmp, '.surgex'))
    expect(store.count()).toBe(0)
    store.replaceAll([makeUnit(path.join(tmp, 'a.ts')), makeUnit(path.join(tmp, 'b.ts'))])
    expect(store.count()).toBe(2)
  })

  it('rejects indexes where files is an array instead of an object', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({ version: 3, params: { k: 5, w: 4 }, files: [], units: [] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/files is not an object/)
  })

  it('rejects indexes with missing fingerprint params', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({ version: 3, params: null, files: {}, units: [] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(
      /missing fingerprint params/,
    )
  })

  it('rejects indexes where units is not an array', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({ version: 3, params: { k: 5, w: 4 }, files: {}, units: {} }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/units is not an array/)
  })

  it('loads indexes that store absolute file paths', () => {
    const absoluteFile = path.join(tmp, 'src/legacy.ts')
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(
      path.join(tmp, '.surgex/index.json'),
      JSON.stringify({
        version: 3,
        params: { k: 5, w: 4 },
        files: {},
        units: [{ ...makeUnit(absoluteFile), id: 1 }],
      }),
    )

    const loaded = new Store(path.join(tmp, '.surgex')).getAll()
    expect(loaded[0].file).toBe(absoluteFile)
  })

  describe('discover', () => {
    it('finds the nearest .surgex walking up outside a git repo', () => {
      fs.mkdirSync(path.join(tmp, '.surgex'))
      fs.mkdirSync(path.join(tmp, 'src/deep'), { recursive: true })
      const store = Store.discover(path.join(tmp, 'src/deep'))
      expect(store.dir).toBe(path.join(fs.realpathSync(tmp), '.surgex'))
    })

    it('anchors a new store at the git repository root', () => {
      // .surgex above the repo root must be ignored
      fs.mkdirSync(path.join(tmp, '.surgex'))
      fs.mkdirSync(path.join(tmp, 'repo/.git'), { recursive: true })
      fs.mkdirSync(path.join(tmp, 'repo/src'), { recursive: true })
      const store = Store.discover(path.join(tmp, 'repo/src'))
      expect(store.dir).toBe(path.join(fs.realpathSync(path.join(tmp, 'repo')), '.surgex'))
    })

    it('uses git to discover the repository root when available', () => {
      const repo = path.join(tmp, 'repo')
      fs.mkdirSync(path.join(repo, 'src/deep'), { recursive: true })
      execFileSync('git', ['init'], { cwd: repo, stdio: 'ignore' })

      const store = Store.discover(path.join(repo, 'src/deep'))
      expect(store.dir).toBe(path.join(fs.realpathSync(repo), '.surgex'))
    })

    it('ignores nested .surgex directories inside a git repo', () => {
      const repo = path.join(tmp, 'repo')
      fs.mkdirSync(path.join(repo, '.git'), { recursive: true })
      fs.mkdirSync(path.join(repo, 'src/deep/.surgex'), { recursive: true })

      const store = Store.discover(path.join(repo, 'src/deep'))
      expect(store.dir).toBe(path.join(fs.realpathSync(repo), '.surgex'))
    })

    it('falls back to cwd when no repo root exists', () => {
      fs.mkdirSync(path.join(tmp, 'nested/deep'), { recursive: true })
      const store = Store.discover(path.join(tmp, 'nested/deep'))
      expect(store.dir).toBe(path.join(fs.realpathSync(path.join(tmp, 'nested/deep')), '.surgex'))
    })

    it('falls back when the provided cwd cannot be realpathed', () => {
      const missing = path.join(tmp, 'missing/deep')
      const store = Store.discover(missing)
      expect(store.dir).toBe(path.join(missing, '.surgex'))
    })
  })
})
