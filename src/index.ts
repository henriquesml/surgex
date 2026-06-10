// Public library API.

export { indexPaths, FILE_PATTERNS, IGNORE } from './pipeline/indexer'
export { checkFiles } from './pipeline/checker'
export { detectClones } from './core/detector'
export { groupClones } from './core/grouping'
export { fingerprint, jaccard, jaccardSets, DEFAULT_PARAMS } from './core/fingerprint'
export { formatReport, formatCheckReport, countFindings } from './report/report'
export { Store } from './io/store'
export { UsageError } from './errors'

export type { IndexOptions } from './pipeline/indexer'
export type { CheckMatch, FileCheckResult, CheckReport, CheckOptions } from './pipeline/checker'
export type { DetectOptions } from './core/detector'
export type { FingerprintParams } from './core/fingerprint'
export type { ReportOptions } from './report/report'
export type { CodeUnit, ClonePair, CloneGroup, IndexStats, Language, UnitType } from './types'
