import { parseFile, parseSource } from './parser'
import { getAllUnits } from './store'
import { jaccard } from './fingerprinter'
import { fileAtRef } from './git'
import { cloneType, formatGroups, type DisplayGroup, type FormatOptions } from './format'
import type { CodeUnit } from './types'

export interface CheckMatch {
  unit: CodeUnit
  existing: CodeUnit
  similarity: number
}

export interface FileCheckResult {
  file: string
  insertions: CheckMatch[]   // units added in this diff (didn't exist in base)
  modifications: CheckMatch[] // units that existed before but changed structure
}

export interface CheckOptions {
  threshold?: number
  minTokens?: number
  base?: string
  onProgress?: (current: number, total: number, file: string) => void
}

function findMatches(
  units: CodeUnit[],
  indexed: CodeUnit[],
  threshold: number,
  excludeFiles: Set<string>
): CheckMatch[] {
  const candidates = indexed.filter(u => !excludeFiles.has(u.file))
  if (candidates.length === 0) return []

  // hash → indexed unit indices for O(1) candidate lookup
  const hashToIdx = new Map<number, number[]>()
  for (let i = 0; i < candidates.length; i++) {
    for (const h of candidates[i].fingerprint) {
      let b = hashToIdx.get(h)
      if (!b) { b = []; hashToIdx.set(h, b) }
      b.push(i)
    }
  }

  const matches: CheckMatch[] = []

  for (const unit of units) {
    const seen = new Set<number>()
    let best: CheckMatch | null = null

    for (const h of unit.fingerprint) {
      for (const idx of hashToIdx.get(h) ?? []) {
        if (seen.has(idx)) continue
        seen.add(idx)
        const sim = jaccard(unit.fingerprint, candidates[idx].fingerprint)
        if (sim >= threshold && (!best || sim > best.similarity)) {
          best = { unit, existing: candidates[idx], similarity: sim }
        }
      }
    }

    if (best) matches.push(best)
  }

  return matches.sort((a, b) => b.similarity - a.similarity)
}

export function checkFiles(
  files: Array<{ absolutePath: string; repoRelativePath: string }>,
  repoRoot: string,
  options: CheckOptions = {}
): FileCheckResult[] {
  const { threshold = 0.75, minTokens = 20, base, onProgress } = options

  const excludeFiles = new Set(files.map(f => f.absolutePath))
  const indexed = getAllUnits().filter(u => u.tokenCount >= minTokens)

  const results: FileCheckResult[] = []

  for (let fi = 0; fi < files.length; fi++) {
    const { absolutePath, repoRelativePath } = files[fi]
    onProgress?.(fi + 1, files.length, absolutePath)
    const currentUnits = parseFile(absolutePath).filter(u => u.tokenCount >= minTokens)
    if (currentUnits.length === 0) continue

    let insertedUnits: CodeUnit[]
    let modifiedUnits: CodeUnit[]

    if (base) {
      const baseSource = fileAtRef(repoRoot, repoRelativePath, base)
      const baseUnits = baseSource
        ? parseSource(baseSource, absolutePath).filter(u => u.tokenCount >= minTokens)
        : []

      const baseNames = new Set(baseUnits.map(u => u.name))
      const baseFpByName = new Map(baseUnits.map(u => [u.name, u.fingerprint]))

      insertedUnits = currentUnits.filter(u => !baseNames.has(u.name))
      modifiedUnits = currentUnits.filter(u => {
        const baseFp = baseFpByName.get(u.name)
        if (!baseFp) return false
        return jaccard(u.fingerprint, baseFp) < 0.95  // structure changed meaningfully
      })
    } else {
      // No base ref: treat all as insertions (uncommitted new code)
      insertedUnits = currentUnits
      modifiedUnits = []
    }

    const insertions = findMatches(insertedUnits, indexed, threshold, excludeFiles)
    const modifications = findMatches(modifiedUnits, indexed, threshold, excludeFiles)

    if (insertions.length > 0 || modifications.length > 0) {
      results.push({ file: absolutePath, insertions, modifications })
    }
  }

  return results
}

export function formatCheckReport(
  results: FileCheckResult[],
  repoRoot: string,
  options: FormatOptions = {}
): string {
  const display: DisplayGroup[] = []

  for (const { insertions, modifications } of results) {
    for (const m of insertions) {
      display.push({
        similarity: m.similarity,
        cloneType: cloneType(m.similarity, [m.unit, m.existing]),
        description: `insertion in ${m.unit.file.split('/').pop()}`,
        units: [
          { unit: m.unit,     role: 'new' },
          { unit: m.existing, role: 'existing' },
        ],
      })
    }
    for (const m of modifications) {
      display.push({
        similarity: m.similarity,
        cloneType: cloneType(m.similarity, [m.unit, m.existing]),
        description: `modification in ${m.unit.file.split('/').pop()}`,
        units: [
          { unit: m.unit,     role: 'changed' },
          { unit: m.existing, role: 'existing' },
        ],
      })
    }
  }

  return formatGroups(display, { ...options, repoRoot })
}
