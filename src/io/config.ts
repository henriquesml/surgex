import * as fs from 'fs'
import * as path from 'path'
import { UsageError } from '../errors'

export const CONFIG_FILENAME = 'surgex.json'

export interface SurgexConfig {
  presets: string[]
  exclude: string[]
  threshold?: number
  minTokens?: number
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
    minTokens: readOptionalNumber(data.minTokens, 'minTokens', file),
  }
}

// The full exclude list for a run: the named presets, the config's own globs,
// and anything passed on the command line.
export function resolveExcludes(config: SurgexConfig, extra: string[] = []): string[] {
  return [...config.presets.flatMap(preset => PRESETS[preset] ?? []), ...config.exclude, ...extra]
}
