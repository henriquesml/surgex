import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { Store } from '../src/io/store'
import { indexPaths } from '../src/pipeline/indexer'

const FN = (name: string) => `export function ${name}(token: string) {
  const items = fetchData(token)
  if (!items) { throw new Error('no data') }
  return items.map((i: number) => i + 1)
}
`

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-indexer-'))
  fs.mkdirSync(path.join(tmp, 'src'))
  fs.writeFileSync(path.join(tmp, 'src/a.ts'), FN('alpha'))
  fs.writeFileSync(path.join(tmp, 'src/b.ts'), FN('beta'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

// stderr progress output is noise in test logs
function quiet<T>(fn: () => Promise<T>): Promise<T> {
  const write = process.stderr.write
  process.stderr.write = () => true
  return fn().finally(() => {
    process.stderr.write = write
  })
}

function makeStore(): Store {
  return new Store(path.join(tmp, '.surgex'))
}

describe('indexPaths — incremental', () => {
  it('parses everything on the first run', async () => {
    const stats = await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    expect(stats.parsed).toBe(2)
    expect(stats.reused).toBe(0)
    expect(stats.units).toBe(2)
  })

  it('reuses unchanged files on re-index', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    const stats = await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    expect(stats.parsed).toBe(0)
    expect(stats.reused).toBe(2)
    expect(stats.units).toBe(2)
  })

  it('re-parses only files that changed', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))

    // different size guarantees a cache miss even with coarse mtime granularity
    fs.writeFileSync(path.join(tmp, 'src/a.ts'), FN('alphaRenamedLonger'))

    const stats = await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    expect(stats.parsed).toBe(1)
    expect(stats.reused).toBe(1)

    const names = makeStore()
      .getAll()
      .map(u => u.name)
      .sort()
    expect(names).toEqual(['alphaRenamedLonger', 'beta'])
  })

  it('drops units of deleted files', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    fs.rmSync(path.join(tmp, 'src/b.ts'))

    const stats = await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    expect(stats.files).toBe(1)
    expect(
      makeStore()
        .getAll()
        .map(u => u.name),
    ).toEqual(['alpha'])
  })

  it('ignores the cache when fingerprint params change', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    const stats = await quiet(() =>
      indexPaths([path.join(tmp, 'src')], makeStore(), { params: { k: 7, w: 4 } }),
    )
    expect(stats.parsed).toBe(2)
    expect(stats.reused).toBe(0)
  })

  it('ignores the cache with force: true', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    const stats = await quiet(() =>
      indexPaths([path.join(tmp, 'src')], makeStore(), { force: true }),
    )
    expect(stats.parsed).toBe(2)
    expect(stats.reused).toBe(0)
  })

  it('keeps cached fingerprints identical to freshly parsed ones', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
    const first = makeStore().getAll()

    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore())) // cached run
    const second = makeStore().getAll()

    expect(second.map(u => ({ ...u, id: 0 }))).toEqual(first.map(u => ({ ...u, id: 0 })))
  })

  it('writes verbose output to stderr for each file', async () => {
    const lines: string[] = []
    const write = process.stderr.write
    process.stderr.write = (chunk: unknown) => {
      lines.push(String(chunk))
      return true
    }
    try {
      await indexPaths([path.join(tmp, 'src')], makeStore(), { verbose: true })
    } finally {
      process.stderr.write = write
    }
    expect(lines.some(l => l.includes('parsed') || l.includes('cached'))).toBe(true)
  })

  it('labels reused files as cached in verbose mode', async () => {
    await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))

    const lines: string[] = []
    const write = process.stderr.write
    process.stderr.write = (chunk: unknown) => {
      lines.push(String(chunk))
      return true
    }
    try {
      await indexPaths([path.join(tmp, 'src')], makeStore(), { verbose: true })
    } finally {
      process.stderr.write = write
    }
    expect(lines.some(line => line.includes('(cached)'))).toBe(true)
  })

  it('skips a file that disappears between glob and stat (race condition)', async () => {
    // Replace a.ts with an unreadable symlink to a non-existent target so
    // statSync throws ENOENT when that file is processed.
    fs.rmSync(path.join(tmp, 'src/a.ts'))
    fs.symlinkSync('/nonexistent_surgex_target', path.join(tmp, 'src/a.ts'))
    try {
      const stats = await quiet(() => indexPaths([path.join(tmp, 'src')], makeStore()))
      expect(stats.files).toBe(1) // only b.ts was indexed
    } finally {
      fs.rmSync(path.join(tmp, 'src/a.ts')) // remove the symlink so afterEach cleanup works
    }
  })
})
