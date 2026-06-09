// Winnowing algorithm (Schleimer, Wilkerson, Aiken — SIGMOD 2003)
// Guarantees: any shared substring of length >= K is detected.
// Avoids noise by only selecting one hash per sliding window of size W.

const K = 5  // k-gram size: minimum match length in tokens
const W = 4  // window size: controls density of selected hashes

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

export function fingerprint(tokens: string[]): number[] {
  if (tokens.length < K) return tokens.map(fnv1a)
  const grams = kgrams(tokens, K)
  const hashes = grams.map(fnv1a)
  if (hashes.length < W) return hashes
  return Array.from(winnow(hashes, W))
}

export function jaccard(a: number[], b: number[]): number {
  if (a.length === 0 && b.length === 0) return 0
  const setA = new Set(a)
  const setB = new Set(b)
  let intersection = 0
  for (const h of setA) {
    if (setB.has(h)) intersection++
  }
  const union = setA.size + setB.size - intersection
  return union === 0 ? 0 : intersection / union
}
