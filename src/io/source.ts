import * as fs from 'fs'

// The structural-match view (`--show-code`) reads line ranges from the same
// file many times. Cache the split lines per file, invalidating on mtime change
// so a file edited mid-process is still read fresh. A cheap statSync per call
// replaces a full re-read of the file.
const lineCache = new Map<string, { mtimeMs: number; lines: string[] }>()

// Reads a 1-based inclusive line range from a file. Returns [] if unreadable.
export function readLines(file: string, startLine: number, endLine: number): string[] {
  try {
    const { mtimeMs } = fs.statSync(file)
    let entry = lineCache.get(file)
    if (!entry || entry.mtimeMs !== mtimeMs) {
      entry = { mtimeMs, lines: fs.readFileSync(file, 'utf8').split('\n') }
      lineCache.set(file, entry)
    }
    return entry.lines.slice(startLine - 1, endLine)
  } catch {
    return []
  }
}
