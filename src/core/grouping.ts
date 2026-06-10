import type { ClonePair, CloneGroup, CodeUnit } from '../types'

// Union-Find: groups transitively similar units into clusters.
// If A~B and B~C, then A, B and C all land in the same group.
export function groupClones(pairs: ClonePair[]): CloneGroup[] {
  const parent = new Map<number, number>()
  const maxSim = new Map<number, number>()

  function find(id: number): number {
    if (!parent.has(id)) parent.set(id, id)
    if (parent.get(id) !== id) parent.set(id, find(parent.get(id)!))
    return parent.get(id)!
  }

  function union(a: number, b: number, sim: number) {
    const ra = find(a),
      rb = find(b)
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
