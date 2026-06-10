import { readLines } from '../io/source'

const RESET = '\x1b[0m'
const DIM = '\x1b[2m'
const BOLD = '\x1b[1m'
const YELLOW = '\x1b[33m'
const CYAN = '\x1b[36m'

// Normalize a single line to its token sequence for structural comparison
function normalizeLine(line: string): string {
  return line
    .replace(/\/\/.*$/g, '') // strip comments
    .replace(/'[^']*'|"[^"]*"|`[^`]*`/g, 'STR') // string literals
    .replace(/\b\d+(\.\d+)?\b/g, 'NUM') // numbers
    .replace(/\b[a-z_][a-zA-Z0-9_]*\b/g, 'ID') // identifiers → ID
    .replace(/\s+/g, ' ')
    .trim()
}

// The full DP table is O(m·n) memory; beyond this many cells (~1M ≈ two
// 1000-line units) the structural match view is skipped rather than risking an OOM.
const MAX_LCS_CELLS = 1_000_000

// LCS on normalized lines to find matching pairs
function lcsLines(linesA: string[], linesB: string[]): Array<[number, number]> {
  const lengthA = linesA.length,
    lengthB = linesB.length
  const lcsTable: number[][] = Array.from({ length: lengthA + 1 }, () =>
    new Array(lengthB + 1).fill(0),
  )
  for (let rowA = 1; rowA <= lengthA; rowA++)
    for (let rowB = 1; rowB <= lengthB; rowB++)
      lcsTable[rowA][rowB] =
        linesA[rowA - 1] === linesB[rowB - 1]
          ? lcsTable[rowA - 1][rowB - 1] + 1
          : Math.max(lcsTable[rowA - 1][rowB], lcsTable[rowA][rowB - 1])

  const matchedPairs: Array<[number, number]> = []
  let rowA = lengthA,
    rowB = lengthB
  while (rowA > 0 && rowB > 0) {
    if (linesA[rowA - 1] === linesB[rowB - 1]) {
      matchedPairs.unshift([rowA - 1, rowB - 1])
      rowA--
      rowB--
    } else if (lcsTable[rowA - 1][rowB] >= lcsTable[rowA][rowB - 1]) rowA--
    else rowB--
  }
  return matchedPairs
}

export function renderStructuralMatchView(
  labelA: string,
  fileA: string,
  startA: number,
  endA: number,
  labelB: string,
  fileB: string,
  startB: number,
  endB: number,
  indent = '    ',
): string {
  const linesA = readLines(fileA, startA, endA)
  const linesB = readLines(fileB, startB, endB)

  if (linesA.length === 0 || linesB.length === 0) return ''

  if (linesA.length * linesB.length > MAX_LCS_CELLS) {
    return `${indent}(units too large to compare — ${linesA.length} × ${linesB.length} lines)\n`
  }

  const normalizedA = linesA.map(normalizeLine)
  const normalizedB = linesB.map(normalizeLine)

  const matchedRowsA = new Set<number>()
  const matchedRowsB = new Set<number>()

  for (const [rowA, rowB] of lcsLines(normalizedA, normalizedB)) {
    if (normalizedA[rowA].length > 2) {
      // ignore trivial lines like '{' or '}'
      matchedRowsA.add(rowA)
      matchedRowsB.add(rowB)
    }
  }

  const matchedLineCount = matchedRowsA.size
  const significantCount = linesA.filter(line => line.trim().length > 2).length
  const matchedPercent =
    significantCount > 0 ? Math.round((matchedLineCount / significantCount) * 100) : 0

  const lines: string[] = []
  const colorize = (color: string, text: string) =>
    process.stdout.isTTY ? color + text + RESET : text
  const columnWidth = Math.max(...linesA.map(line => line.length), labelA.length) + 2

  // Header
  lines.push(indent + colorize(CYAN, labelA.padEnd(columnWidth)) + '  ' + colorize(CYAN, labelB))
  lines.push(indent + colorize(DIM, '─'.repeat(columnWidth) + '──' + '─'.repeat(labelB.length)))

  // Side-by-side with match markers
  const rowCount = Math.max(linesA.length, linesB.length)
  for (let row = 0; row < rowCount; row++) {
    const lineA = linesA[row] ?? ''
    const lineB = linesB[row] ?? ''
    const isMatched = matchedRowsA.has(row) || matchedRowsB.has(row)
    const marker = isMatched ? colorize(YELLOW, ' ≡ ') : colorize(DIM, '   ')
    lines.push(indent + colorize(DIM, lineA.padEnd(columnWidth)) + marker + colorize(DIM, lineB))
  }

  lines.push(indent + colorize(DIM, '─'.repeat(columnWidth) + '──' + '─'.repeat(labelB.length)))
  lines.push(
    indent +
      colorize(
        BOLD,
        `${matchedLineCount} of ${significantCount} lines structurally matched (${matchedPercent}%)`,
      ),
  )

  return lines.join('\n') + '\n'
}
