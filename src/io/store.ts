import * as fs from 'fs'
import * as path from 'path'
import { DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import { UsageError } from '../errors'
import { findRepoRoot } from './git'
import type { CodeUnit } from '../types'

export interface StoredUnit extends Omit<CodeUnit, 'id'> {
  id: number
}

// Cheap change detection: a file whose mtime and size both match the cached
// entry is assumed unchanged and its units are reused without re-parsing.
export interface FileMeta {
  mtimeMs: number
  size: number
}

export interface FileCacheEntry {
  meta: FileMeta
  units: CodeUnit[]
}

interface IndexData {
  version: number
  params: FingerprintParams
  files: Record<string, FileMeta> // project-root-relative path → stat snapshot
  units: StoredUnit[]
}

const INDEX_VERSION = 2

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
  // Inside a git repo, the store is always anchored at the repository root so
  // nested stale indexes are ignored. Outside a git repo, it finds the nearest
  // `.surgex/` walking up from `cwd` and otherwise falls back to `<cwd>/.surgex`.
  static discover(cwd: string = process.cwd()): Store {
    const resolvedCwd = realpathOrSelf(cwd)
    const repoRoot = realpathOrNull(findRepoRoot(resolvedCwd) ?? findRepoRootByWalking(resolvedCwd))
    if (repoRoot) return new Store(path.join(repoRoot, '.surgex'))

    let currentDir = resolvedCwd
    while (true) {
      const candidate = path.join(currentDir, '.surgex')
      if (fs.existsSync(candidate)) return new Store(candidate)
      const parentDir = path.dirname(currentDir)
      if (parentDir === currentDir) return new Store(path.join(resolvedCwd, '.surgex'))
      currentDir = parentDir
    }
  }

  exists(): boolean {
    return fs.existsSync(this.indexPath)
  }

  private read(): IndexData {
    if (this.cache) return this.cache
    if (!this.exists()) {
      return { version: INDEX_VERSION, params: DEFAULT_PARAMS, files: {}, units: [] }
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

  private relativize(file: string): string {
    return path.isAbsolute(file) ? path.relative(this.root, file) : file
  }

  private absolutize(file: string): string {
    return path.isAbsolute(file) ? file : path.resolve(this.root, file)
  }

  // Replaces the entire index in a single write. Each unit is assigned a fresh
  // id and its file path is made relative to the project root. `fileMeta`
  // (file path → stat snapshot) enables incremental re-indexing; without it
  // the next `surgex index` re-parses everything.
  replaceAll(
    units: CodeUnit[],
    params: FingerprintParams = DEFAULT_PARAMS,
    fileMeta?: Map<string, FileMeta>,
  ): void {
    let nextId = 1
    const stored: StoredUnit[] = units.map(unit => ({
      ...unit,
      id: nextId++,
      file: this.relativize(unit.file),
    }))
    const files: Record<string, FileMeta> = {}
    if (fileMeta) {
      for (const [file, meta] of fileMeta) files[this.relativize(file)] = meta
    }
    this.write({ version: INDEX_VERSION, params, files, units: stored })
  }

  // Per-file parse cache for incremental indexing: every indexed file (keyed
  // by absolute path) with its stat snapshot and previously parsed units.
  // Returns null when there is no usable cache — no index yet, or it was
  // built with different fingerprint params (fingerprints wouldn't match).
  fileCache(params: FingerprintParams): Map<string, FileCacheEntry> | null {
    if (!this.exists()) return null
    const data = this.read()
    if (data.params.k !== params.k || data.params.w !== params.w) return null

    const unitsByFile = new Map<string, CodeUnit[]>()
    for (const stored of data.units) {
      const absolutePath = this.absolutize(stored.file)
      let fileUnits = unitsByFile.get(absolutePath)
      if (!fileUnits) {
        fileUnits = []
        unitsByFile.set(absolutePath, fileUnits)
      }
      // stale ids are harmless: replaceAll always reassigns them
      fileUnits.push({ ...stored, file: absolutePath })
    }

    const cache = new Map<string, FileCacheEntry>()
    for (const [relativePath, meta] of Object.entries(data.files)) {
      const absolutePath = this.absolutize(relativePath)
      cache.set(absolutePath, { meta, units: unitsByFile.get(absolutePath) ?? [] })
    }
    return cache
  }

  // Fingerprint parameters the index was built with. Checks must use the same
  // parameters or fingerprints would never match.
  params(): FingerprintParams {
    return this.read().params
  }

  getAll(): StoredUnit[] {
    return this.read().units.map(unit => ({ ...unit, file: this.absolutize(unit.file) }))
  }

  count(): number {
    return this.read().units.length
  }
}

function findRepoRootByWalking(cwd: string): string | null {
  let currentDir = cwd
  while (true) {
    if (fs.existsSync(path.join(currentDir, '.git'))) return currentDir
    const parentDir = path.dirname(currentDir)
    if (parentDir === currentDir) return null
    currentDir = parentDir
  }
}

function realpathOrSelf(target: string): string {
  try {
    return fs.realpathSync(target)
  } catch {
    return target
  }
}

function realpathOrNull(target: string | null): string | null {
  return target ? realpathOrSelf(target) : null
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

  if (typeof data.files !== 'object' || data.files === null || Array.isArray(data.files)) {
    fail('files is not an object')
  }
  for (const rawMeta of Object.values(data.files as Record<string, unknown>)) {
    const meta = rawMeta as Record<string, unknown>
    if (
      typeof meta !== 'object' ||
      meta === null ||
      typeof meta.mtimeMs !== 'number' ||
      typeof meta.size !== 'number'
    ) {
      fail('malformed file entry')
    }
  }

  if (!Array.isArray(data.units)) fail('units is not an array')
  for (const unit of data.units as Array<Record<string, unknown>>) {
    if (
      typeof unit !== 'object' ||
      unit === null ||
      typeof unit.file !== 'string' ||
      typeof unit.name !== 'string' ||
      typeof unit.startLine !== 'number' ||
      typeof unit.endLine !== 'number' ||
      typeof unit.tokenCount !== 'number' ||
      !Array.isArray(unit.fingerprint)
    ) {
      fail('malformed unit entry')
    }
  }

  return raw as unknown as IndexData
}
