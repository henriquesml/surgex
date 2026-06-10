import { showDuplicatedLines } from './diff'
import type { CodeUnit } from '../types'

export type UnitRole = 'new' | 'changed' | 'existing' | undefined

export interface DisplayUnit {
  unit: CodeUnit
  role?: UnitRole
}

export interface DisplayGroup {
  similarity: number
  cloneType: string
  description: string
  units: DisplayUnit[]
}

export interface FormatOptions {
  showCode?: boolean
  repoRoot?: string
}

// ── clone type classification ──────────────────────────────────────────────

export function cloneType(similarity: number, units: CodeUnit[]): string {
  if (similarity < 1.0) return 'Type-3'
  const lineCounts = units.map(u => u.endLine - u.startLine)
  return lineCounts.every(c => c === lineCounts[0]) ? 'Type-1' : 'Type-2'
}

const CLONE_TYPE_LABEL: Record<string, string> = {
  'Type-1': 'exact copy (only names/whitespace may differ)',
  'Type-2': 'same structure, different names',
  'Type-3': 'similar structure with insertions/removals',
}

export function cloneTypeLabel(type: string): string {
  return CLONE_TYPE_LABEL[type] ?? ''
}

// ── shared formatter ───────────────────────────────────────────────────────

const TYPE_ORDER = ['Type-1', 'Type-2', 'Type-3']

export function formatGroups(groups: DisplayGroup[], options: FormatOptions = {}): string {
  if (groups.length === 0) return 'No similar code found.\n'

  const { showCode = false, repoRoot } = options

  const allFiles = groups.flatMap(group => group.units.map(displayUnit => displayUnit.unit.file))
  const root = repoRoot ?? commonDirPrefix(allFiles)
  const relativize = (file: string) =>
    root && file.startsWith(root) ? file.slice(root.length).replace(/^\//, '') : file

  // bucket groups by clone type, preserving similarity order within each bucket
  const groupsByType = new Map<string, DisplayGroup[]>()
  for (const group of groups) {
    const bucket = groupsByType.get(group.cloneType) ?? []
    bucket.push(group)
    groupsByType.set(group.cloneType, bucket)
  }

  const lines: string[] = [`Found ${groups.length} item(s):\n`]

  const orderedTypes = [
    ...TYPE_ORDER.filter(type => groupsByType.has(type)),
    ...[...groupsByType.keys()].filter(type => !TYPE_ORDER.includes(type)),
  ]

  let counter = 0

  for (const type of orderedTypes) {
    const bucket = groupsByType.get(type)!

    lines.push(
      `── ${type}  ${cloneTypeLabel(type)}  (${bucket.length} item${bucket.length > 1 ? 's' : ''})`,
    )
    lines.push('')

    for (const { similarity, description, units } of bucket) {
      counter++

      lines.push(`   #${counter}  ${(similarity * 100).toFixed(0)}%  ${description}`)
      lines.push('')

      for (const { unit, role } of units) {
        const roleTag = role ? `[${role}]`.padEnd(10) : '          '
        lines.push(
          `        ${roleTag} ${unit.name.padEnd(42)} [${unit.type}]  ${relativize(unit.file)}:${unit.startLine}`,
        )
      }

      if (showCode && units.length >= 2) {
        const firstUnit = units[0].unit
        const lastUnit = units[units.length - 1].unit
        const firstLabel = `${firstUnit.name}${units[0].role ? ` (${units[0].role})` : ''}`
        const lastLabel = `${lastUnit.name}${units[units.length - 1].role ? ` (${units[units.length - 1].role})` : ''}`
        lines.push('')
        lines.push(
          showDuplicatedLines(
            firstLabel,
            firstUnit.file,
            firstUnit.startLine,
            firstUnit.endLine,
            lastLabel,
            lastUnit.file,
            lastUnit.startLine,
            lastUnit.endLine,
          ),
        )
      } else {
        lines.push('')
      }
    }
  }

  return lines.join('\n')
}

// ── helpers ────────────────────────────────────────────────────────────────

// Longest common leading directory path shared by all files.
export function commonDirPrefix(files: string[]): string {
  if (files.length === 0) return ''
  const dirSegments = files.map(file => file.split('/').slice(0, -1))
  let prefix = dirSegments[0]
  for (const segments of dirSegments.slice(1)) {
    let matchLength = 0
    while (
      matchLength < prefix.length &&
      matchLength < segments.length &&
      prefix[matchLength] === segments[matchLength]
    )
      matchLength++
    prefix = prefix.slice(0, matchLength)
  }
  return prefix.length ? prefix.join('/') + '/' : ''
}
