import { parseFile, parseSource } from '../lang/parser'
import { jaccardSets } from '../core/fingerprint'
import { detectClones, MAX_UNITS_PER_HASH } from '../core/detector'
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
  const candidates = indexed.filter(unit => !excludeFiles.has(unit.file))
  const candidateSets = candidates.map(unit => new Set(unit.fingerprint))

  const candidateIndicesByHash = new Map<number, number[]>()
  for (let candidateIndex = 0; candidateIndex < candidates.length; candidateIndex++) {
    for (const hash of candidates[candidateIndex].fingerprint) {
      let candidateIndices = candidateIndicesByHash.get(hash)
      if (!candidateIndices) {
        candidateIndices = []
        candidateIndicesByHash.set(hash, candidateIndices)
      }
      candidateIndices.push(candidateIndex)
    }
  }

  return function findMatches(units: CodeUnit[]): CheckMatch[] {
    if (candidates.length === 0) return []

    const matches: CheckMatch[] = []

    for (const unit of units) {
      const unitSet = new Set(unit.fingerprint)
      const seenCandidates = new Set<number>()
      let best: CheckMatch | null = null

      for (const hash of unit.fingerprint) {
        const bucket = candidateIndicesByHash.get(hash)
        if (!bucket) continue
        // Skip structural-noise hashes shared by very many indexed units, the
        // same cap detectClones uses — otherwise one common hash makes every
        // checked unit pay an O(N) scan over the whole index.
        if (bucket.length > MAX_UNITS_PER_HASH) continue
        for (const candidateIndex of bucket) {
          if (seenCandidates.has(candidateIndex)) continue
          seenCandidates.add(candidateIndex)
          const similarity = jaccardSets(unitSet, candidateSets[candidateIndex])
          if (similarity >= threshold && (!best || similarity > best.similarity)) {
            best = { unit, existing: candidates[candidateIndex], similarity }
          }
        }
      }

      if (best) matches.push(best)
    }

    return matches.sort((first, second) => second.similarity - first.similarity)
  }
}

// Stable key for matching units between base and current versions of a file.
// Name alone collides (every Ruby class has an `initialize`), so same-named
// units are disambiguated by order of appearance.
function occurrenceKeys(units: CodeUnit[]): Map<string, CodeUnit> {
  const occurrencesByName = new Map<string, number>()
  const unitByKey = new Map<string, CodeUnit>()
  for (const unit of units) {
    const occurrence = occurrencesByName.get(unit.name) ?? 0
    occurrencesByName.set(unit.name, occurrence + 1)
    unitByKey.set(`${unit.name}#${occurrence}`, unit)
  }
  return unitByKey
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

  for (let fileIndex = 0; fileIndex < files.length; fileIndex++) {
    const { absolutePath, repoRelativePath } = files[fileIndex]
    onProgress?.(fileIndex + 1, files.length, absolutePath)
    const currentUnits = parseFile(absolutePath, params).filter(u => u.tokenCount >= minTokens)
    if (currentUnits.length === 0) continue

    let insertedUnits: CodeUnit[]
    let modifiedUnits: CodeUnit[]

    if (base) {
      const baseSource = fileAtRef(repoRoot, repoRelativePath, base)
      const baseUnits = baseSource
        ? parseSource(baseSource, absolutePath, params).filter(u => u.tokenCount >= minTokens)
        : []

      const baseUnitByKey = occurrenceKeys(baseUnits)
      const currentUnitByKey = occurrenceKeys(currentUnits)
      const keyByUnit = new Map<CodeUnit, string>()
      for (const [key, unit] of currentUnitByKey) keyByUnit.set(unit, key)

      insertedUnits = currentUnits.filter(unit => !baseUnitByKey.has(keyByUnit.get(unit)!))
      modifiedUnits = currentUnits.filter(unit => {
        const baseUnit = baseUnitByKey.get(keyByUnit.get(unit)!)
        if (!baseUnit) return false
        const similarity = jaccardSets(new Set(unit.fingerprint), new Set(baseUnit.fingerprint))
        return similarity < 0.95 // structure changed meaningfully
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
  const insertedWithIds = allInserted.map((unit, index) => ({ ...unit, id: index + 1 }))
  const internal = groupClones(detectClones(insertedWithIds, { threshold }))

  return { files: results, internal }
}
