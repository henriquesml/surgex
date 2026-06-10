import type { ClonePair, CloneGroup, CodeUnit } from '../types'

// Union-Find: groups transitively similar units into clusters.
// If A~B and B~C, then A, B and C all land in the same group.
export function groupClones(pairs: ClonePair[]): CloneGroup[] {
  const parentById = new Map<number, number>()
  const maxSimilarityByRoot = new Map<number, number>()

  function findRoot(id: number): number {
    if (!parentById.has(id)) parentById.set(id, id)
    if (parentById.get(id) !== id) parentById.set(id, findRoot(parentById.get(id)!))
    return parentById.get(id)!
  }

  function union(idA: number, idB: number, similarity: number) {
    const rootA = findRoot(idA),
      rootB = findRoot(idB)
    parentById.set(rootA, rootB)
    maxSimilarityByRoot.set(
      rootB,
      Math.max(
        maxSimilarityByRoot.get(rootA) ?? 0,
        maxSimilarityByRoot.get(rootB) ?? 0,
        similarity,
      ),
    )
  }

  for (const { unitA, unitB, similarity } of pairs) union(unitA.id!, unitB.id!, similarity)

  const unitsByRoot = new Map<number, Map<number, CodeUnit>>()
  for (const { unitA, unitB } of pairs) {
    const root = findRoot(unitA.id!)
    if (!unitsByRoot.has(root)) unitsByRoot.set(root, new Map())
    const groupUnits = unitsByRoot.get(root)!
    groupUnits.set(unitA.id!, unitA)
    groupUnits.set(unitB.id!, unitB)
  }

  return Array.from(unitsByRoot.entries())
    .map(([root, groupUnits]) => ({
      similarity: maxSimilarityByRoot.get(root) ?? 0,
      units: Array.from(groupUnits.values()),
    }))
    .sort((first, second) => second.similarity - first.similarity)
}
