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
      JSON.stringify({ version: 1, params: { k: 5, w: 4 }, units: [{ bogus: true }] }),
    )
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/malformed unit/)
  })

  it('rejects pre-versioned indexes', () => {
    fs.mkdirSync(path.join(tmp, '.surgex'))
    fs.writeFileSync(path.join(tmp, '.surgex/index.json'), JSON.stringify({ nextId: 1, units: [] }))
    expect(() => new Store(path.join(tmp, '.surgex')).getAll()).toThrow(/unsupported version/)
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
