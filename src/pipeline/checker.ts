import { parseFile, parseSource } from '../lang/parser'
import { jaccardSets } from '../core/fingerprint'
import { detectClones } from '../core/detector'
import { groupClones } from '../core/grouping'
import { fileAtRef } from '../io/git'
import { Store } from '../io/store'
import type { CloneGroup, CodeUnit } from '../types'

export interface CheckMatch {
  unit: CodeUnit
  existing: CodeUnit
  similarity: number
}

export interface FileCheckResult {
  file: string
  insertions: CheckMatch[] // units added in this diff (didn't exist in base)
  modifications: CheckMatch[] // units that existed before but changed structure
}

export interface CheckReport {
  files: FileCheckResult[]
  // clone groups among the checked units themselves — duplicates introduced
  // within the same changeset, which the index knows nothing about
  internal: CloneGroup[]
}

export interface CheckOptions {
  threshold?: number
  minTokens?: number
  base?: string
  onProgress?: (current: number, total: number, file: string) => void
}

// Builds a reusable matcher over the indexed units. The hash → unit map and
// the per-unit fingerprint Sets are built once; calling the returned function
// per file only pays for the lookup, not for rebuilding the map.
function buildMatcher(indexed: CodeUnit[], excludeFiles: Set<string>, threshold: number) {
  const candidates = indexed.filter(u => !excludeFiles.has(u.file))
  const candidateSets = candidates.map(u => new Set(u.fingerprint))

  const hashToIdx = new Map<number, number[]>()
  for (let i = 0; i < candidates.length; i++) {
    for (const h of candidates[i].fingerprint) {
      let b = hashToIdx.get(h)
      if (!b) {
        b = []
        hashToIdx.set(h, b)
      }
      b.push(i)
    }
  }

  return function findMatches(units: CodeUnit[]): CheckMatch[] {
    if (candidates.length === 0) return []

    const matches: CheckMatch[] = []

    for (const unit of units) {
      const unitSet = new Set(unit.fingerprint)
      const seen = new Set<number>()
      let best: CheckMatch | null = null

      for (const h of unit.fingerprint) {
        for (const idx of hashToIdx.get(h) ?? []) {
          if (seen.has(idx)) continue
          seen.add(idx)
          const sim = jaccardSets(unitSet, candidateSets[idx])
          if (sim >= threshold && (!best || sim > best.similarity)) {
            best = { unit, existing: candidates[idx], similarity: sim }
          }
        }
      }

      if (best) matches.push(best)
    }

    return matches.sort((a, b) => b.similarity - a.similarity)
  }
}

// Stable key for matching units between base and current versions of a file.
// Name alone collides (every Ruby class has an `initialize`), so same-named
// units are disambiguated by order of appearance.
function occurrenceKeys(units: CodeUnit[]): Map<string, CodeUnit> {
  const counts = new Map<string, number>()
  const byKey = new Map<string, CodeUnit>()
  for (const u of units) {
    const n = counts.get(u.name) ?? 0
    counts.set(u.name, n + 1)
    byKey.set(`${u.name}#${n}`, u)
  }
  return byKey
}

export function checkFiles(
  files: Array<{ absolutePath: string; repoRelativePath: string }>,
  repoRoot: string,
  store: Store,
  options: CheckOptions = {},
): CheckReport {
  const { threshold = 0.75, minTokens = 20, base, onProgress } = options

  const params = store.params()
  const excludeFiles = new Set(files.map(f => f.absolutePath))
  const indexed = store.getAll().filter(u => u.tokenCount >= minTokens)
  const findMatches = buildMatcher(indexed, excludeFiles, threshold)

  const results: FileCheckResult[] = []
  const allInserted: CodeUnit[] = []

  for (let fi = 0; fi < files.length; fi++) {
    const { absolutePath, repoRelativePath } = files[fi]
    onProgress?.(fi + 1, files.length, absolutePath)
    const currentUnits = parseFile(absolutePath, params).filter(u => u.tokenCount >= minTokens)
    if (currentUnits.length === 0) continue

    let insertedUnits: CodeUnit[]
    let modifiedUnits: CodeUnit[]

    if (base) {
      const baseSource = fileAtRef(repoRoot, repoRelativePath, base)
      const baseUnits = baseSource
        ? parseSource(baseSource, absolutePath, params).filter(u => u.tokenCount >= minTokens)
        : []

      const baseByKey = occurrenceKeys(baseUnits)
      const currentKeys = occurrenceKeys(currentUnits)
      const keyOf = new Map<CodeUnit, string>()
      for (const [key, u] of currentKeys) keyOf.set(u, key)

      insertedUnits = currentUnits.filter(u => !baseByKey.has(keyOf.get(u)!))
      modifiedUnits = currentUnits.filter(u => {
        const baseUnit = baseByKey.get(keyOf.get(u)!)
        if (!baseUnit) return false
        const sim = jaccardSets(new Set(u.fingerprint), new Set(baseUnit.fingerprint))
        return sim < 0.95 // structure changed meaningfully
      })
    } else {
      // No base ref: treat all as insertions (uncommitted new code)
      insertedUnits = currentUnits
      modifiedUnits = []
    }

    allInserted.push(...insertedUnits)

    const insertions = findMatches(insertedUnits)
    const modifications = findMatches(modifiedUnits)

    if (insertions.length > 0 || modifications.length > 0) {
      results.push({ file: absolutePath, insertions, modifications })
    }
  }

  // Duplicates inside the changeset itself: new units compared against each
  // other (the index can't catch these — none of them is indexed yet).
  const withIds = allInserted.map((u, i) => ({ ...u, id: i + 1 }))
  const internal = groupClones(detectClones(withIds, { threshold }))

  return { files: results, internal }
}
