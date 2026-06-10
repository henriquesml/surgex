import type { CloneGroup, CodeUnit } from '../types'
import type { CheckReport } from '../pipeline/checker'
import {
  cloneType,
  commonDirPrefix,
  formatGroups,
  type DisplayGroup,
  type FormatOptions,
} from './format'

export interface ReportOptions extends FormatOptions {
  json?: boolean
}

// Drops units that are fully contained in another unit of the same group
// (e.g. a cloned class and each of its methods land in one group — the class
// alone tells the story). Groups left with fewer than 2 units are removed.
function dropContainedUnits(groups: CloneGroup[]): CloneGroup[] {
  return groups
    .map(g => ({
      ...g,
      units: g.units.filter(
        u =>
          !g.units.some(
            other =>
              other !== u &&
              other.file === u.file &&
              other.startLine <= u.startLine &&
              other.endLine >= u.endLine &&
              (other.startLine < u.startLine || other.endLine > u.endLine),
          ),
      ),
    }))
    .filter(g => g.units.length >= 2)
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

function relativizer(root: string): (f: string) => string {
  return (f: string) => (root && f.startsWith(root) ? f.slice(root.length).replace(/^\//, '') : f)
}

// ── full-scan report (`check --all`): CloneGroup[] → formatted string ───────

export function formatReport(rawGroups: CloneGroup[], options: ReportOptions = {}): string {
  const groups = dropContainedUnits(rawGroups)
  const files = [...new Set(groups.flatMap(g => g.units.map(u => u.file)))]
  const root = options.repoRoot ?? commonDirPrefix(files)
  const shortDir = (fs: string[]) => {
    const prefix = commonDirPrefix(fs)
    const segs = prefix.split('/').filter(Boolean)
    return segs.length ? segs.slice(-2).join('/') + '/' : ''
  }

  const display: DisplayGroup[] = groups.map(({ similarity, units }) => {
    const type = cloneType(similarity, units)
    const unitFiles = [...new Set(units.map(u => u.file))]
    const unitLabel =
      [...new Set(units.map(u => u.type))].length === 1
        ? `${units.length} ${units[0].type}${units.length > 1 ? 's' : ''}`
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

  if (options.json) return toJson(display, relativizer(root))
  return formatGroups(display, { ...options, repoRoot: root })
}

// ── diff report (`check`): CheckReport → formatted string ───────────────────

export function formatCheckReport(
  report: CheckReport,
  repoRoot: string,
  options: ReportOptions = {},
): string {
  const display: DisplayGroup[] = []

  for (const { insertions, modifications } of report.files) {
    for (const m of insertions) {
      display.push({
        similarity: m.similarity,
        cloneType: cloneType(m.similarity, [m.unit, m.existing]),
        description: `insertion in ${m.unit.file.split('/').pop()}`,
        units: [
          { unit: m.unit, role: 'new' },
          { unit: m.existing, role: 'existing' },
        ],
      })
    }
    for (const m of modifications) {
      display.push({
        similarity: m.similarity,
        cloneType: cloneType(m.similarity, [m.unit, m.existing]),
        description: `modification in ${m.unit.file.split('/').pop()}`,
        units: [
          { unit: m.unit, role: 'changed' },
          { unit: m.existing, role: 'existing' },
        ],
      })
    }
  }

  for (const group of dropContainedUnits(report.internal)) {
    display.push({
      similarity: group.similarity,
      cloneType: cloneType(group.similarity, group.units),
      description: `${group.units.length} units within the checked files themselves`,
      units: group.units.map((unit: CodeUnit) => ({ unit, role: 'new' as const })),
    })
  }

  if (options.json) return toJson(display, relativizer(repoRoot))
  return formatGroups(display, { ...options, repoRoot })
}

// Number of findings — used by the CLI for `--fail-on-found`.
export function countFindings(report: CheckReport): number {
  const fileMatches = report.files.reduce(
    (n, f) => n + f.insertions.length + f.modifications.length,
    0,
  )
  return fileMatches + dropContainedUnits(report.internal).length
}
