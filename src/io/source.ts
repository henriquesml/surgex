import * as fs from 'fs'

// Reads a 1-based inclusive line range from a file. Returns [] if unreadable.
export function readLines(file: string, startLine: number, endLine: number): string[] {
  try {
    return fs
      .readFileSync(file, 'utf8')
      .split('\n')
      .slice(startLine - 1, endLine)
  } catch {
    return []
  }
}
