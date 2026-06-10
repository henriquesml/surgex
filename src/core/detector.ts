import { jaccardSets } from './fingerprint'
import type { ClonePair, CodeUnit } from '../types'

// Hashes shared by more than this many units are structural noise (like stop words).
// Skipping them avoids O(N²) explosion on patterns like `const { ID } = ID()`.
const MAX_BUCKET = 50

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
  const fingerprintSets = units.map(u => new Set(u.fingerprint))

  // Phase 1: build hash → unit-index map, reporting per-file progress
  const hashToIndices = new Map<number, number[]>()
  const files = [...new Set(units.map(u => u.file))]
  const reportedFiles = new Set<string>()

  for (let i = 0; i < units.length; i++) {
    const u = units[i]
    if (onProgress && !reportedFiles.has(u.file)) {
      reportedFiles.add(u.file)
      onProgress(reportedFiles.size, files.length, u.file)
    }
    for (const h of u.fingerprint) {
      let bucket = hashToIndices.get(h)
      if (!bucket) {
        bucket = []
        hashToIndices.set(h, bucket)
      }
      bucket.push(i)
    }
  }

  // Phase 2: collect candidate pairs (skip buckets that are too common to be meaningful)
  const seen = new Set<number>()
  const candidates: Array<[number, number]> = []
  const n = units.length

  for (const indices of hashToIndices.values()) {
    if (indices.length > MAX_BUCKET) continue
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = indices[i],
          b = indices[j]
        const key = a < b ? a * n + b : b * n + a
        if (!seen.has(key)) {
          seen.add(key)
          candidates.push([a, b])
        }
      }
    }
  }

  // Phase 3: compute Jaccard for each candidate pair, reporting progress every 500
  const clones: ClonePair[] = []

  for (let i = 0; i < candidates.length; i++) {
    if (onProgress && i % 500 === 0) {
      onProgress(i, candidates.length, 'pairs')
    }
    const [ai, bi] = candidates[i]
    const sim = jaccardSets(fingerprintSets[ai], fingerprintSets[bi])
    if (sim >= threshold) {
      clones.push({ unitA: units[ai], unitB: units[bi], similarity: sim })
    }
  }

  return clones.sort((a, b) => b.similarity - a.similarity)
}
