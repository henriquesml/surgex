// Winnowing algorithm (Schleimer, Wilkerson, Aiken — SIGMOD 2003)
// Guarantees: any shared substring of length >= K is detected.
// Avoids noise by only selecting one hash per sliding window of size W.

export interface FingerprintParams {
  k: number // k-gram size: minimum match length in tokens
  w: number // window size: controls density of selected hashes
}

export const DEFAULT_PARAMS: FingerprintParams = { k: 5, w: 4 }

function buildKGrams(tokens: string[], kGramSize: number): string[] {
  const kGrams: string[] = []
  for (let start = 0; start <= tokens.length - kGramSize; start++) {
    kGrams.push(tokens.slice(start, start + kGramSize).join('\0'))
  }
  return kGrams
}

// FNV-1a: fast, low-collision, deterministic
function hashFnv1a(text: string): number {
  let hash = 2166136261
  for (let i = 0; i < text.length; i++) {
    hash ^= text.charCodeAt(i)
    hash = Math.imul(hash, 16777619)
  }
  return hash >>> 0
}

function winnow(hashes: number[], windowSize: number): Set<number> {
  const selected = new Set<number>()
  for (let windowStart = 0; windowStart <= hashes.length - windowSize; windowStart++) {
    let minimum = hashes[windowStart]
    for (let offset = windowStart + 1; offset < windowStart + windowSize; offset++) {
      if (hashes[offset] < minimum) minimum = hashes[offset]
    }
    selected.add(minimum)
  }
  return selected
}

export function fingerprint(
  tokens: string[],
  params: FingerprintParams = DEFAULT_PARAMS,
): number[] {
  const { k: kGramSize, w: windowSize } = params
  if (tokens.length < kGramSize) return tokens.map(hashFnv1a)
  const kGrams = buildKGrams(tokens, kGramSize)
  const hashes = kGrams.map(hashFnv1a)
  if (hashes.length < windowSize) return hashes
  return Array.from(winnow(hashes, windowSize))
}

export function jaccard(first: number[], second: number[]): number {
  return jaccardSets(new Set(first), new Set(second))
}

// Set-based variant: callers comparing many pairs should build each unit's
// Set once and reuse it, instead of paying two Set allocations per pair.
export function jaccardSets(first: Set<number>, second: Set<number>): number {
  if (first.size === 0 && second.size === 0) return 0
  // iterate the smaller set
  const [smaller, larger] = first.size <= second.size ? [first, second] : [second, first]
  let intersectionSize = 0
  for (const hash of smaller) {
    if (larger.has(hash)) intersectionSize++
  }
  const unionSize = first.size + second.size - intersectionSize
  return unionSize === 0 ? 0 : intersectionSize / unionSize
}
