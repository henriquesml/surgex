import { jaccardSets } from './fingerprint'
import type { ClonePair, CodeUnit } from '../types'

// Hashes shared by more than this many units are structural noise (like stop words).
// Skipping them avoids O(N²) explosion on patterns like `const { ID } = ID()`.
const MAX_UNITS_PER_HASH = 50

export interface DetectOptions {
  threshold?: number
  onProgress?: (current: number, total: number, label: string) => void
}

// Detects clone pairs among the given units. Pure: the caller is responsible
// for loading and pre-filtering units (e.g. by minimum token count).
export function detectClones(units: CodeUnit[], options: DetectOptions = {}): ClonePair[] {
  const { threshold = 0.75, onProgress } = options

  // Each unit's fingerprint as a Set, built once — jaccard is computed for
  // many pairs and would otherwise re-allocate two Sets per comparison.
  const fingerprintSets = units.map(unit => new Set(unit.fingerprint))

  // Phase 1: build hash → unit-index map, reporting per-file progress
  const unitIndicesByHash = new Map<number, number[]>()
  const files = [...new Set(units.map(unit => unit.file))]
  const reportedFiles = new Set<string>()

  for (let unitIndex = 0; unitIndex < units.length; unitIndex++) {
    const unit = units[unitIndex]
    if (onProgress && !reportedFiles.has(unit.file)) {
      reportedFiles.add(unit.file)
      onProgress(reportedFiles.size, files.length, unit.file)
    }
    for (const hash of unit.fingerprint) {
      let unitIndices = unitIndicesByHash.get(hash)
      if (!unitIndices) {
        unitIndices = []
        unitIndicesByHash.set(hash, unitIndices)
      }
      unitIndices.push(unitIndex)
    }
  }

  // Phase 2: collect candidate pairs (skip hashes shared by too many units to be meaningful)
  const seenPairKeys = new Set<number>()
  const candidatePairs: Array<[number, number]> = []
  const unitCount = units.length

  for (const unitIndices of unitIndicesByHash.values()) {
    if (unitIndices.length > MAX_UNITS_PER_HASH) continue
    for (let i = 0; i < unitIndices.length; i++) {
      for (let j = i + 1; j < unitIndices.length; j++) {
        const indexA = unitIndices[i],
          indexB = unitIndices[j]
        const pairKey = indexA * unitCount + indexB
        if (!seenPairKeys.has(pairKey)) {
          seenPairKeys.add(pairKey)
          candidatePairs.push([indexA, indexB])
        }
      }
    }
  }

  // Phase 3: compute Jaccard for each candidate pair, reporting progress every 500
  const clones: ClonePair[] = []

  for (let pairIndex = 0; pairIndex < candidatePairs.length; pairIndex++) {
    if (onProgress && pairIndex % 500 === 0) {
      onProgress(pairIndex, candidatePairs.length, 'pairs')
    }
    const [indexA, indexB] = candidatePairs[pairIndex]
    const similarity = jaccardSets(fingerprintSets[indexA], fingerprintSets[indexB])
    if (similarity >= threshold) {
      clones.push({ unitA: units[indexA], unitB: units[indexB], similarity })
    }
  }

  return clones.sort((first, second) => second.similarity - first.similarity)
}
