import { getAllUnits } from './store'
import { jaccard } from './fingerprinter'
import type { ClonePair } from './types'

// Hashes shared by more than this many units are structural noise (like stop words).
// Skipping them avoids O(N²) explosion on patterns like `const { ID } = ID()`.
const MAX_BUCKET = 50

export interface DetectOptions {
  threshold?: number
  minTokens?: number
  onProgress?: (current: number, total: number, label: string) => void
}

export function detectClones(options: DetectOptions = {}): ClonePair[] {
  const { threshold = 0.75, minTokens = 20, onProgress } = options
  const units = getAllUnits().filter(u => u.tokenCount >= minTokens)

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
      if (!bucket) { bucket = []; hashToIndices.set(h, bucket) }
      bucket.push(i)
    }
  }

  // Phase 2: collect candidate pairs (skip buckets that are too common to be meaningful)
  const seen = new Set<number>()
  const candidates: Array<[number, number]> = []

  for (const indices of hashToIndices.values()) {
    if (indices.length > MAX_BUCKET) continue
    for (let i = 0; i < indices.length; i++) {
      for (let j = i + 1; j < indices.length; j++) {
        const a = indices[i], b = indices[j]
        const key = a < b ? a * 1_000_000 + b : b * 1_000_000 + a
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
    const unitA = units[ai], unitB = units[bi]
    const sim = jaccard(unitA.fingerprint, unitB.fingerprint)
    if (sim >= threshold) {
      clones.push({ unitA, unitB, similarity: sim })
    }
  }

  return clones.sort((a, b) => b.similarity - a.similarity)
}
