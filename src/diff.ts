import * as fs from 'fs'

const RESET = '\x1b[0m'
const DIM   = '\x1b[2m'
const BOLD  = '\x1b[1m'
const YELLOW = '\x1b[33m'
const CYAN  = '\x1b[36m'

function color(c: string, s: string): string {
  return process.stdout.isTTY ? c + s + RESET : s
}

export function readLines(file: string, startLine: number, endLine: number): string[] {
  try {
    return fs.readFileSync(file, 'utf8').split('\n').slice(startLine - 1, endLine)
  } catch {
    return []
  }
}

// Normalize a single line to its token sequence for structural comparison
function normalizeLine(line: string): string {
  return line
    .replace(/\/\/.*$/g, '')                // strip comments
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, 'STR')  // string literals
    .replace(/\b\d+(\.\d+)?\b/g, 'NUM')    // numbers
    .replace(/\b[a-z_][a-zA-Z0-9_]*\b/g, 'ID')   // identifiers → ID
    .replace(/\s+/g, ' ')
    .trim()
}

// LCS on normalized lines to find matching pairs
function lcsLines(a: string[], b: string[]): Array<[number, number]> {
  const m = a.length, n = b.length
  const dp: number[][] = Array.from({ length: m + 1 }, () => new Array(n + 1).fill(0))
  for (let i = 1; i <= m; i++)
    for (let j = 1; j <= n; j++)
      dp[i][j] = a[i - 1] === b[j - 1]
        ? dp[i - 1][j - 1] + 1
        : Math.max(dp[i - 1][j], dp[i][j - 1])

  const pairs: Array<[number, number]> = []
  let i = m, j = n
  while (i > 0 && j > 0) {
    if (a[i - 1] === b[j - 1]) { pairs.unshift([i - 1, j - 1]); i--; j-- }
    else if (dp[i - 1][j] >= dp[i][j - 1]) i--
    else j--
  }
  return pairs
}

export function showDuplicatedLines(
  labelA: string, fileA: string, startA: number, endA: number,
  labelB: string, fileB: string, startB: number, endB: number,
  indent = '    '
): string {
  const linesA = readLines(fileA, startA, endA)
  const linesB = readLines(fileB, startB, endB)

  if (linesA.length === 0 || linesB.length === 0) return ''

  const normA = linesA.map(normalizeLine)
  const normB = linesB.map(normalizeLine)

  const matchedA = new Set<number>()
  const matchedB = new Set<number>()

  for (const [ia, ib] of lcsLines(normA, normB)) {
    if (normA[ia].length > 2) {  // ignore trivial lines like '{' or '}'
      matchedA.add(ia)
      matchedB.add(ib)
    }
  }

  const dupCount = matchedA.size
  const totalA = linesA.filter(l => l.trim().length > 2).length
  const pct = totalA > 0 ? Math.round((dupCount / totalA) * 100) : 0

  const lines: string[] = []
  const col = (c: string, s: string) => process.stdout.isTTY ? c + s + RESET : s
  const maxW = Math.max(...linesA.map(l => l.length), labelA.length) + 2

  // Header
  lines.push(
    indent + col(CYAN, labelA.padEnd(maxW)) + '  ' + col(CYAN, labelB)
  )
  lines.push(indent + col(DIM, '─'.repeat(maxW) + '──' + '─'.repeat(labelB.length)))

  // Side-by-side with match markers
  const maxRows = Math.max(linesA.length, linesB.length)
  for (let i = 0; i < maxRows; i++) {
    const lineA = linesA[i] ?? ''
    const lineB = linesB[i] ?? ''
    const isDup = matchedA.has(i) || matchedB.has(i)
    const marker = isDup ? col(YELLOW, ' ≡ ') : col(DIM, '   ')
    lines.push(indent + col(DIM, lineA.padEnd(maxW)) + marker + col(DIM, lineB))
  }

  lines.push(indent + col(DIM, '─'.repeat(maxW) + '──' + '─'.repeat(labelB.length)))
  lines.push(indent + col(BOLD, `${dupCount} of ${totalA} lines structurally duplicated (${pct}%)`))

  return lines.join('\n') + '\n'
}
