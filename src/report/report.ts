import type { CloneGroup, CodeUnit } from '../types'
import type { CheckReport } from '../pipeline/checker'
import {
  cloneType,
  commonDirPrefix,
  formatGroups,
  type DisplayGroup,
  type FormatOptions,
} from './format'

export type OutputFormat = 'text' | 'json' | 'github'

export interface ReportOptions extends FormatOptions {
  json?: boolean
  format?: OutputFormat
}

function outputFormat(options: ReportOptions): OutputFormat {
  return options.format ?? (options.json ? 'json' : 'text')
}

const PLURAL_TYPE: Record<CodeUnit['type'], string> = {
  arrow: 'arrows',
  block: 'blocks',
  class: 'classes',
  function: 'functions',
  method: 'methods',
  module: 'modules',
  template: 'templates',
}

// Drops units that are fully contained in another unit of the same group
// (e.g. a cloned class and each of its methods land in one group — the class
// alone tells the story). Groups left with fewer than 2 units are removed.
function dropContainedUnits(groups: CloneGroup[]): CloneGroup[] {
  return groups
    .map(group => ({
      ...group,
      units: group.units.filter(
        unit =>
          !group.units.some(
            other =>
              other !== unit &&
              other.file === unit.file &&
              other.startLine <= unit.startLine &&
              other.endLine >= unit.endLine &&
              (other.startLine < unit.startLine || other.endLine > unit.endLine),
          ),
      ),
    }))
    .filter(group => group.units.length >= 2)
}

// Sibling DSL blocks in one file repeat a shape on purpose: a table-driven
// test with a case per row, a `describe` whose examples differ only in their
// data. Reporting them says nothing but "this file is written the way it was
// meant to be" — on a Rails monorepo they were nearly every finding a pull
// request turned up. The same block duplicated *across* files is a different
// claim, and is still reported.
function dropSiblingBlocks(groups: CloneGroup[]): CloneGroup[] {
  return groups.filter(group => {
    const everyUnitIsABlock = group.units.every(unit => unit.type === 'block')
    const allInOneFile = new Set(group.units.map(unit => unit.file)).size === 1
    return !(everyUnitIsABlock && allInOneFile)
  })
}

// `dropContainedUnits` works inside one group, but a template and the block it
// wraps land in *different* groups: four identical mailers report once as four
// templates and again as the four blocks inside them. When every unit of one
// group sits inside a unit of another, the outer group already told the story.
function dropContainedGroups(groups: CloneGroup[]): CloneGroup[] {
  const contains = (outer: CodeUnit, inner: CodeUnit) =>
    outer.file === inner.file &&
    outer.startLine <= inner.startLine &&
    outer.endLine >= inner.endLine

  return groups.filter(
    (group, index) =>
      !groups.some(
        (other, otherIndex) =>
          otherIndex !== index &&
          other.units.length >= group.units.length &&
          // ties would drop both halves of a mutually contained pair
          (other.units.length > group.units.length || otherIndex < index) &&
          group.units.every(unit => other.units.some(candidate => contains(candidate, unit))),
      ),
  )
}

// The larger a clone group, the less likely it is an accident. Three copies of
// a hook is a copy-paste; thirty identical Rails mailer layouts, generated
// migrations or value objects are a convention the codebase chose. Off by
// default — a project sets `maxGroupSize` once it knows its own shape.
function dropIdiomGroups(groups: CloneGroup[], maxGroupSize?: number): CloneGroup[] {
  if (!maxGroupSize) return groups
  return groups.filter(group => group.units.length <= maxGroupSize)
}

// Every reported group goes through here, so `check` and `check --all` agree
// on what counts as a finding.
function presentableGroups(groups: CloneGroup[], maxGroupSize?: number): CloneGroup[] {
  return dropIdiomGroups(
    dropContainedGroups(dropSiblingBlocks(dropContainedUnits(groups))),
    maxGroupSize,
  )
}

function toJson(display: DisplayGroup[], rel: (f: string) => string): string {
  const out = {
    found: display.length,
    groups: display.map(g => ({
      similarity: Number(g.similarity.toFixed(4)),
      cloneType: g.cloneType,
      description: g.description,
      units: g.units.map(({ unit, role }) => ({
        name: unit.name,
        type: unit.type,
        language: unit.language,
        file: rel(unit.file),
        startLine: unit.startLine,
        endLine: unit.endLine,
        ...(role ? { role } : {}),
      })),
    })),
  }
  return JSON.stringify(out, null, 2) + '\n'
}

// GitHub Actions reads `::warning file=…,line=…::message` off stdout and pins
// the message to that line of the pull request diff. No token, no API call, no
// bot account — the annotation appears next to the code that caused it.
//
// Workflow commands are line-based, so anything that could contain a newline,
// a `%`, or (in a property) a `:` or `,` has to be percent-encoded or the
// command silently truncates.
function escapeData(value: string): string {
  return value.replace(/%/g, '%25').replace(/\r/g, '%0D').replace(/\n/g, '%0A')
}

function escapeProperty(value: string): string {
  return escapeData(value).replace(/:/g, '%3A').replace(/,/g, '%2C')
}

function toGithub(display: DisplayGroup[], rel: (file: string) => string): string {
  return (
    display
      .map(group => {
        // Anchor on the unit the pull request actually introduced; the others
        // are what it duplicates and belong in the message.
        const anchorIndex = group.units.findIndex(
          ({ role }) => role === 'new' || role === 'changed',
        )
        const anchor = group.units[anchorIndex === -1 ? 0 : anchorIndex]
        const others = group.units.filter(entry => entry !== anchor)

        const percent = Math.round(group.similarity * 100)
        const where = others
          .slice(0, 3)
          .map(({ unit }) => `${unit.name} (${rel(unit.file)}:${unit.startLine})`)
          .join(', ')
        const more = others.length > 3 ? ` and ${others.length - 3} more` : ''
        const message = `${group.cloneType}, ${percent}% similar to ${where}${more}`

        const file = escapeProperty(rel(anchor.unit.file))
        const title = escapeProperty(`surgex: ${anchor.unit.name} duplicates existing code`)
        return `::warning file=${file},line=${anchor.unit.startLine},title=${title}::${escapeData(message)}`
      })
      .join('\n') + (display.length ? '\n' : '')
  )
}

function relativizer(root: string): (file: string) => string {
  return (file: string) =>
    root && file.startsWith(root) ? file.slice(root.length).replace(/^\//, '') : file
}

// ── full-scan report (`check --all`): CloneGroup[] → formatted string ───────

function scanDisplay(
  rawGroups: CloneGroup[],
  options: ReportOptions,
): { display: DisplayGroup[]; root: string } {
  const groups = presentableGroups(rawGroups, options.maxGroupSize)
  const files = [...new Set(groups.flatMap(group => group.units.map(unit => unit.file)))]
  const root = options.repoRoot ?? commonDirPrefix(files)
  const shortDir = (dirFiles: string[]) => {
    const prefix = commonDirPrefix(dirFiles)
    const segments = prefix.split('/').filter(Boolean)
    return segments.length ? segments.slice(-2).join('/') + '/' : ''
  }

  const display: DisplayGroup[] = groups.map(({ similarity, units }) => {
    const type = cloneType(similarity, units)
    const unitFiles = [...new Set(units.map(unit => unit.file))]
    const unitLabel =
      [...new Set(units.map(unit => unit.type))].length === 1
        ? `${units.length} ${PLURAL_TYPE[units[0].type]}`
        : `${units.length} units`

    const location =
      unitFiles.length === 1
        ? 'in the same file'
        : shortDir(unitFiles)
          ? `under ${shortDir(unitFiles)}`
          : 'across different directories'

    return {
      similarity,
      cloneType: type,
      description: `${unitLabel} ${location}`,
      units: units.map(unit => ({ unit })),
    }
  })

  return { display, root }
}

// The findings a full scan would report, for callers that need to decide
// something about them rather than print them.
export function scanFindings(rawGroups: CloneGroup[], options: ReportOptions = {}): DisplayGroup[] {
  return scanDisplay(rawGroups, options).display
}

export function formatReport(rawGroups: CloneGroup[], options: ReportOptions = {}): string {
  const { display, root } = scanDisplay(rawGroups, options)
  const rel = relativizer(root)

  switch (outputFormat(options)) {
    case 'json':
      return toJson(display, rel)
    case 'github':
      return toGithub(display, rel)
    default:
      return formatGroups(display, { ...options, repoRoot: root })
  }
}

// ── check report (`check`): CheckReport → formatted string ──────────────────

// The findings a check would report, in the order it reports them.
export function checkFindings(report: CheckReport, options: ReportOptions = {}): DisplayGroup[] {
  const display: DisplayGroup[] = []

  for (const { insertions, modifications } of report.files) {
    for (const match of insertions) {
      display.push({
        similarity: match.similarity,
        cloneType: cloneType(match.similarity, [match.unit, match.existing]),
        description: `insertion in ${match.unit.file.split('/').pop()}`,
        units: [
          { unit: match.unit, role: 'new' },
          { unit: match.existing, role: 'existing' },
        ],
      })
    }
    for (const match of modifications) {
      display.push({
        similarity: match.similarity,
        cloneType: cloneType(match.similarity, [match.unit, match.existing]),
        description: `modification in ${match.unit.file.split('/').pop()}`,
        units: [
          { unit: match.unit, role: 'changed' },
          { unit: match.existing, role: 'existing' },
        ],
      })
    }
  }

  for (const group of presentableGroups(report.internal, options.maxGroupSize)) {
    display.push({
      similarity: group.similarity,
      cloneType: cloneType(group.similarity, group.units),
      description: `${group.units.length} units within the checked files themselves`,
      units: group.units.map((unit: CodeUnit) => ({ unit, role: 'new' as const })),
    })
  }

  return display
}

export function formatCheckReport(
  report: CheckReport,
  repoRoot: string,
  options: ReportOptions = {},
): string {
  const display = checkFindings(report, options)
  const rel = relativizer(repoRoot)

  switch (outputFormat(options)) {
    case 'json':
      return toJson(display, rel)
    case 'github':
      return toGithub(display, rel)
    default:
      return formatGroups(display, { ...options, repoRoot })
  }
}

// Number of findings — used by the CLI for `--fail-on-found`. Takes the same
// options the report does: a gate that failed on groups the report never
// printed would be impossible to act on.
export function countFindings(report: CheckReport, options: ReportOptions = {}): number {
  return checkFindings(report, options).length
}
