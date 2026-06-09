import type { ClonePair, CloneGroup, CodeUnit } from './types'
import { cloneType, cloneTypeLabel, formatGroups, type DisplayGroup, type FormatOptions } from './format'

// ── Union-Find: groups transitively similar units into clusters ─────────────

export function groupClones(pairs: ClonePair[]): CloneGroup[] {
  const parent = new Map<number, number>()
  const maxSim = new Map<number, number>()

  function find(id: number): number {
    if (!parent.has(id)) parent.set(id, id)
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!))
    return parent.get(id)!
  }

  function union(a: number, b: number, sim: number) {
    const ra = find(a), rb = find(b)
    parent.set(ra, rb)
    maxSim.set(rb, Math.max(maxSim.get(ra) ?? 0, maxSim.get(rb) ?? 0, sim))
  }

  for (const { unitA, unitB, similarity } of pairs) union(unitA.id!, unitB.id!, similarity)

  const groups = new Map<number, Map<number, CodeUnit>>()
  for (const { unitA, unitB } of pairs) {
    const root = find(unitA.id!)
    if (!groups.has(root)) groups.set(root, new Map())
    const g = groups.get(root)!
    g.set(unitA.id!, unitA)
    g.set(unitB.id!, unitB)
  }

  return Array.from(groups.entries())
    .map(([root, m]) => ({ similarity: maxSim.get(root) ?? 0, units: Array.from(m.values()) }))
    .sort((a, b) => b.similarity - a.similarity)
}

// ── Converts CloneGroup[] → DisplayGroup[] and delegates to formatGroups ───

export function formatReport(groups: CloneGroup[], options: FormatOptions = {}): string {
  const files = [...new Set(groups.flatMap(g => g.units.map(u => u.file)))]
  const root = commonDirPrefix(files)
  const shortDir = (fs: string[]) => {
    const prefix = commonDirPrefix(fs)
    const segs = prefix.split('/').filter(Boolean)
    return segs.length ? segs.slice(-2).join('/') + '/' : ''
  }

  const display: DisplayGroup[] = groups.map(({ similarity, units }) => {
    const type = cloneType(similarity, units)
    const unitFiles = [...new Set(units.map(u => u.file))]
    const unitLabel = [...new Set(units.map(u => u.type))].length === 1
      ? `${units.length} ${units[0].type}${units.length > 1 ? 's' : ''}`
      : `${units.length} units`

    const location = unitFiles.length === 1
      ? 'in the same file'
      : (shortDir(unitFiles) ? `under ${shortDir(unitFiles)}` : 'across different directories')

    return {
      similarity,
      cloneType: type,
      description: `${unitLabel} ${location}`,
      units: units.map(unit => ({ unit })),
    }
  })

  return formatGroups(display, { ...options, repoRoot: root })
}

function commonDirPrefix(files: string[]): string {
  if (files.length === 0) return ''
  const dirs = files.map(f => f.split('/').slice(0, -1))
  let prefix = dirs[0]
  for (const dir of dirs.slice(1)) {
    let i = 0
    while (i < prefix.length && i < dir.length && prefix[i] === dir[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix.length ? prefix.join('/') + '/' : ''
}
