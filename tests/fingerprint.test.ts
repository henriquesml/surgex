import { describe, it, expect } from 'vitest'
import { fingerprint, jaccard, jaccardSets, DEFAULT_PARAMS } from '../src/core/fingerprint'

describe('fingerprint', () => {
  const tokens = 'const [ ID , ID ] = ID < ID > ( [ ] )'.split(' ')

  it('is deterministic', () => {
    expect(fingerprint(tokens)).toEqual(fingerprint(tokens))
  })

  it('produces identical fingerprints for identical token sequences', () => {
    const a = fingerprint(tokens)
    const b = fingerprint([...tokens])
    expect(a).toEqual(b)
  })

  it('produces disjoint fingerprints for unrelated sequences', () => {
    const a = fingerprint('if ( ID ) { return STR }'.split(' '))
    const b = fingerprint('while ( NUM < NUM ) NUM ++ ;'.split(' '))
    expect(jaccard(a, b)).toBe(0)
  })

  it('handles sequences shorter than k', () => {
    const short = fingerprint(['ID', 'ID'])
    expect(short.length).toBe(2)
  })

  it('respects custom k/w params', () => {
    const a = fingerprint(tokens, { k: 3, w: 2 })
    const b = fingerprint(tokens, DEFAULT_PARAMS)
    expect(a).not.toEqual(b)
  })
})

describe('jaccard', () => {
  it('returns 1 for identical sets', () => {
    expect(jaccard([1, 2, 3], [3, 2, 1])).toBe(1)
  })

  it('returns 0 for disjoint sets', () => {
    expect(jaccard([1, 2], [3, 4])).toBe(0)
  })

  it('returns 0 for two empty sets', () => {
    expect(jaccard([], [])).toBe(0)
  })

  it('computes partial overlap', () => {
    expect(jaccard([1, 2, 3], [2, 3, 4])).toBe(0.5)
  })

  it('jaccardSets matches array variant regardless of argument order', () => {
    const a = new Set([1, 2, 3, 4, 5])
    const b = new Set([4, 5, 6])
    expect(jaccardSets(a, b)).toBe(jaccardSets(b, a))
    expect(jaccardSets(a, b)).toBe(jaccard([1, 2, 3, 4, 5], [4, 5, 6]))
  })
})
