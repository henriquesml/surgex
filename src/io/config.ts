import * as fs from 'fs'
import * as path from 'path'
import { UsageError } from '../errors'
import type { Language } from '../types'

export const CONFIG_FILENAME = 'surgex.json'

export interface SurgexConfig {
  presets: string[]
  exclude: string[]
  threshold?: number
  minTokens?: MinTokens
  maxGroupSize?: number
}

// Ruby says in three lines what TypeScript says in ten, so one global floor
// either lets a pair of two-line accessors through or hides real duplication
// in the more verbose language. A project can set the floor per language.
export type MinTokens = number | Partial<Record<Language, number>>

export const DEFAULT_MIN_TOKENS = 20

const LANGUAGES: Language[] = ['typescript', 'ruby', 'erb']

export function minTokensResolver(
  configured: MinTokens | undefined,
  override?: number,
): (language: Language) => number {
  if (override !== undefined) return () => override
  if (typeof configured === 'number') return () => configured
  if (!configured) return () => DEFAULT_MIN_TOKENS
  return language => configured[language] ?? DEFAULT_MIN_TOKENS
}

// Paths a framework owns and regenerates. Every app has them, they are
// identical by construction, and no one can act on a report that says so —
// excluding them is what separates a useful signal from a wall of scaffolding.
//
// `tests` is deliberately separate: duplication between test cases is often
// intentional (table-driven tests repeat a shape on purpose), so whether it is
// noise is a project's call, not a default.
export const PRESETS: Record<string, string[]> = {
  rails: [
    '**/db/migrate/**',
    '**/db/schema.rb',
    '**/db/*_schema.rb',
    '**/db/seeds.rb',
    '**/config/environments/**',
    '**/config/application.rb',
    '**/config/boot.rb',
    '**/config/environment.rb',
    '**/config/puma.rb',
    '**/bin/**',
  ],
  tests: [
    '**/test/**',
    '**/spec/**',
    '**/*_test.rb',
    '**/*_spec.rb',
    '**/*.test.ts',
    '**/*.test.tsx',
  ],
}

export const EMPTY_CONFIG: SurgexConfig = { presets: [], exclude: [] }

function readArrayOfStrings(value: unknown, field: string, file: string): string[] {
  if (value === undefined) return []
  if (!Array.isArray(value) || value.some(entry => typeof entry !== 'string')) {
    throw new UsageError(`${file}: "${field}" must be an array of strings`)
  }
  return value as string[]
}

function readOptionalNumber(value: unknown, field: string, file: string): number | undefined {
  if (value === undefined) return undefined
  if (typeof value !== 'number' || Number.isNaN(value)) {
    throw new UsageError(`${file}: "${field}" must be a number`)
  }
  return value
}

function readMinTokens(value: unknown, file: string): MinTokens | undefined {
  if (value === undefined || typeof value === 'number') {
    return readOptionalNumber(value, 'minTokens', file)
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new UsageError(`${file}: "minTokens" must be a number or an object keyed by language`)
  }
  const byLanguage: Partial<Record<Language, number>> = {}
  for (const [language, floor] of Object.entries(value)) {
    if (!LANGUAGES.includes(language as Language)) {
      throw new UsageError(
        `${file}: unknown language "${language}" in "minTokens" (known: ${LANGUAGES.join(', ')})`,
      )
    }
    if (typeof floor !== 'number') {
      throw new UsageError(`${file}: "minTokens.${language}" must be a number`)
    }
    byLanguage[language as Language] = floor
  }
  return byLanguage
}

// Reads `surgex.json` from the project root. Absent is not an error: a project
// without one behaves exactly as it did before the file existed.
export function loadConfig(root: string): SurgexConfig {
  const file = path.join(root, CONFIG_FILENAME)
  if (!fs.existsSync(file)) return EMPTY_CONFIG

  let raw: unknown
  try {
    raw = JSON.parse(fs.readFileSync(file, 'utf8'))
  } catch {
    throw new UsageError(`Invalid JSON in ${file}`)
  }
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw new UsageError(`${file}: expected a JSON object`)
  }

  const data = raw as Record<string, unknown>
  const presets = readArrayOfStrings(data.presets, 'presets', file)
  for (const preset of presets) {
    if (!PRESETS[preset]) {
      throw new UsageError(
        `${file}: unknown preset "${preset}" (known: ${Object.keys(PRESETS).join(', ')})`,
      )
    }
  }

  return {
    presets,
    exclude: readArrayOfStrings(data.exclude, 'exclude', file),
    threshold: readOptionalNumber(data.threshold, 'threshold', file),
    minTokens: readMinTokens(data.minTokens, file),
    maxGroupSize: readOptionalNumber(data.maxGroupSize, 'maxGroupSize', file),
  }
}

// The full exclude list for a run: the named presets, the config's own globs,
// and anything passed on the command line.
export function resolveExcludes(config: SurgexConfig, extra: string[] = []): string[] {
  return [...config.presets.flatMap(preset => PRESETS[preset]), ...config.exclude, ...extra]
}
