import { describe, it, expect } from 'vitest'
import { detectClones } from '../src/core/detector'
import { groupClones } from '../src/core/grouping'
import { parseSource } from '../src/lang/parser'
import type { CodeUnit } from '../src/types'

const FN_A = `function useProducts(token) {
  const items = fetchData(token)
  if (!items) { throw new Error('no data') }
  return items.map(i => i.id)
}`

const FN_B = `function useCategories(auth) {
  const list = fetchData(auth)
  if (!list) { throw new Error('missing') }
  return list.map(c => c.id)
}`

const FN_C = `function totallyDifferent(x, y) {
  let acc = 0
  for (let i = x; i < y; i++) { acc += i * i }
  while (acc > 100) { acc = Math.sqrt(acc) }
  return acc.toFixed(2)
}`

function unitsFrom(sources: Array<[string, string]>): CodeUnit[] {
  const units = sources.flatMap(([src, file]) => parseSource(src, file))
  return units.map((u, i) => ({ ...u, id: i + 1 }))
}

describe('detectClones', () => {
  it('detects structurally identical functions with different names', () => {
    const units = unitsFrom([
      [FN_A, 'a.ts'],
      [FN_B, 'b.ts'],
    ])
    const pairs = detectClones(units, { threshold: 0.75 })
    expect(pairs).toHaveLength(1)
    expect(pairs[0].similarity).toBe(1)
  })

  it('does not pair unrelated functions', () => {
    const units = unitsFrom([
      [FN_A, 'a.ts'],
      [FN_C, 'c.ts'],
    ])
    expect(detectClones(units, { threshold: 0.75 })).toHaveLength(0)
  })

  it('respects the threshold', () => {
    const units = unitsFrom([
      [FN_A, 'a.ts'],
      [FN_B, 'b.ts'],
    ])
    expect(detectClones(units, { threshold: 1.0 })).toHaveLength(1)
  })
})

describe('groupClones', () => {
  it('groups transitively similar units', () => {
    const units = unitsFrom([
      [FN_A, 'a.ts'],
      [FN_B, 'b.ts'],
      [FN_A.replace('useProducts', 'useSuppliers'), 'c.ts'],
    ])
    const groups = groupClones(detectClones(units, { threshold: 0.75 }))
    expect(groups).toHaveLength(1)
    expect(groups[0].units).toHaveLength(3)
    expect(groups[0].similarity).toBe(1)
  })
})
