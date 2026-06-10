import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import { UsageError } from '../errors'
import type { CodeUnit } from '../types'

export interface StoredUnit extends Omit<CodeUnit, 'id'> {
  id: number
}

interface IndexData {
  version: number
  params: FingerprintParams
  units: StoredUnit[]
}

const INDEX_VERSION = 1

// Persists the fingerprint index to <dir>/index.json.
//
// File paths are stored relative to the project root (the directory that
// contains `.surgex/`), so the index keeps working when the project is moved
// or checked out on another machine (e.g. CI). They are resolved back to
// absolute paths on load.
//
// The index is loaded and written as a whole, so callers should batch their
// writes (see `replaceAll`) rather than saving one unit at a time. Writing per
// unit would re-serialize the entire index on every call — O(N²) disk I/O.
export class Store {
  readonly dir: string
  readonly root: string
  private readonly indexPath: string
  private cache: IndexData | null = null

  constructor(dir: string) {
    this.dir = dir
    this.root = path.dirname(dir)
    this.indexPath = path.join(dir, 'index.json')
  }

  // Finds the nearest `.surgex/` by walking up from `cwd`, like git finds `.git/`.
  // The walk stops at the git repository root (an index above the repo you are
  // working in is almost certainly someone else's). Falls back to
  // `<cwd>/.surgex` when none exists yet.
  static discover(cwd: string = process.cwd()): Store {
    let dir = cwd
    while (true) {
      const candidate = path.join(dir, '.surgex')
      if (fs.existsSync(candidate)) return new Store(candidate)
      if (fs.existsSync(path.join(dir, '.git'))) break // repo root reached
      const parent = path.dirname(dir)
      if (parent === dir) break // reached filesystem root
      dir = parent
    }
    return new Store(path.join(cwd, '.surgex'))
  }

  exists(): boolean {
    return fs.existsSync(this.indexPath)
  }

  private read(): IndexData {
    if (this.cache) return this.cache
    if (!this.exists()) {
      return { version: INDEX_VERSION, params: DEFAULT_PARAMS, units: [] }
    }

    let raw: unknown
    try {
      raw = JSON.parse(fs.readFileSync(this.indexPath, 'utf8'))
    } catch {
      throw new UsageError(`Corrupted index at ${this.indexPath} — re-run \`surgex index\``)
    }
    this.cache = validateIndex(raw, this.indexPath)
    return this.cache
  }

  private write(data: IndexData): void {
    fs.mkdirSync(this.dir, { recursive: true })
    fs.writeFileSync(this.indexPath, JSON.stringify(data))
    this.cache = data
  }

  // Replaces the entire index in a single write. Each unit is assigned a fresh
  // id and its file path is made relative to the project root.
  replaceAll(units: CodeUnit[], params: FingerprintParams = DEFAULT_PARAMS): void {
    let nextId = 1
    const stored: StoredUnit[] = units.map(u => ({
      ...u,
      id: nextId++,
      file: path.isAbsolute(u.file) ? path.relative(this.root, u.file) : u.file,
    }))
    this.write({ version: INDEX_VERSION, params, units: stored })
  }

  // Fingerprint parameters the index was built with. Checks must use the same
  // parameters or fingerprints would never match.
  params(): FingerprintParams {
    return this.read().params
  }

  getAll(): StoredUnit[] {
    return this.read().units.map(u => ({
      ...u,
      file: path.isAbsolute(u.file) ? u.file : path.resolve(this.root, u.file),
    }))
  }

  count(): number {
    return this.read().units.length
  }
}

function validateIndex(raw: unknown, indexPath: string): IndexData {
  const fail = (why: string): never => {
    throw new UsageError(`Invalid index at ${indexPath} (${why}) — re-run \`surgex index\``)
  }

  if (typeof raw !== 'object' || raw === null) fail('not an object')
  const data = raw as Record<string, unknown>

  // Pre-1.0 indexes (no version field) lack params and relative paths.
  if (typeof data.version !== 'number' || data.version !== INDEX_VERSION) {
    fail(`unsupported version ${String(data.version)}`)
  }

  const params = data.params as Record<string, unknown> | undefined
  if (!params || typeof params.k !== 'number' || typeof params.w !== 'number') {
    fail('missing fingerprint params')
  }

  if (!Array.isArray(data.units)) fail('units is not an array')
  for (const u of data.units as Array<Record<string, unknown>>) {
    if (
      typeof u !== 'object' ||
      u === null ||
      typeof u.file !== 'string' ||
      typeof u.name !== 'string' ||
      typeof u.startLine !== 'number' ||
      typeof u.endLine !== 'number' ||
      typeof u.tokenCount !== 'number' ||
      !Array.isArray(u.fingerprint)
    ) {
      fail('malformed unit entry')
    }
  }

  return raw as unknown as IndexData
}
