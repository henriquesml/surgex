// Winnowing algorithm (Schleimer, Wilkerson, Aiken — SIGMOD 2003)
// Guarantees: any shared substring of length >= K is detected.
// Avoids noise by only selecting one hash per sliding window of size W.

export interface FingerprintParams {
  k: number // k-gram size: minimum match length in tokens
  w: number // window size: controls density of selected hashes
}

export const DEFAULT_PARAMS: FingerprintParams = { k: 5, w: 4 }

function kgrams(tokens: string[], k: number): string[] {
  const result: string[] = []
  for (let i = 0; i <= tokens.length - k; i++) {
    result.push(tokens.slice(i, i + k).join('\0'))
  }
  return result
}

// FNV-1a: fast, low-collision, deterministic
function fnv1a(s: string): number {
  let h = 2166136261
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return h >>> 0
}

function winnow(hashes: number[], w: number): Set<number> {
  const selected = new Set<number>()
  for (let i = 0; i <= hashes.length - w; i++) {
    let min = hashes[i]
    for (let j = i + 1; j < i + w; j++) {
      if (hashes[j] < min) min = hashes[j]
    }
    selected.add(min)
  }
  return selected
}

export function fingerprint(
  tokens: string[],
  params: FingerprintParams = DEFAULT_PARAMS,
): number[] {
  const { k, w } = params
  if (tokens.length < k) return tokens.map(fnv1a)
  const grams = kgrams(tokens, k)
  const hashes = grams.map(fnv1a)
  if (hashes.length < w) return hashes
  return Array.from(winnow(hashes, w))
}

export function jaccard(a: number[], b: number[]): number {
  return jaccardSets(new Set(a), new Set(b))
}

// Set-based variant: callers comparing many pairs should build each unit's
// Set once and reuse it, instead of paying two Set allocations per pair.
export function jaccardSets(setA: Set<number>, setB: Set<number>): number {
  if (setA.size === 0 && setB.size === 0) return 0
  // iterate the smaller set
  const [small, large] = setA.size <= setB.size ? [setA, setB] : [setB, setA]
  let intersection = 0
  for (const h of small) {
    if (large.has(h)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}
