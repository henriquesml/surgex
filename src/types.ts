export type Language = 'typescript' | 'ruby'
export type UnitType = 'function' | 'method' | 'arrow' | 'class'

export interface CodeUnit {
  id?: number
  file: string
  startLine: number
  endLine: number
  name: string
  type: UnitType
  language: Language
  tokenCount: number
  fingerprint: number[]
}

export interface ClonePair {
  unitA: CodeUnit
  unitB: CodeUnit
  similarity: number
}

export interface CloneGroup {
  similarity: number
  units: CodeUnit[]
}

export interface IndexStats {
  files: number
  units: number
  parsed: number // files re-parsed this run
  reused: number // files reused from the cache (unchanged since last index)
  durationMs: number
}
