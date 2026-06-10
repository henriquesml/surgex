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

  const allFiles = groups.flatMap(g => g.units.map(u => u.unit.file))
  const root = repoRoot ?? commonDirPrefix(allFiles)
  const rel = (f: string) =>
    root && f.startsWith(root) ? f.slice(root.length).replace(/^\//, '') : f

  // bucket groups by clone type, preserving similarity order within each bucket
  const buckets = new Map<string, DisplayGroup[]>()
  for (const g of groups) {
    const b = buckets.get(g.cloneType) ?? []
    b.push(g)
    buckets.set(g.cloneType, b)
  }

  const lines: string[] = [`Found ${groups.length} item(s):\n`]

  const orderedTypes = [
    ...TYPE_ORDER.filter(t => buckets.has(t)),
    ...[...buckets.keys()].filter(t => !TYPE_ORDER.includes(t)),
  ]

  let counter = 0

  for (const type of orderedTypes) {
    const bucket = buckets.get(type)!

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
          `        ${roleTag} ${unit.name.padEnd(42)} [${unit.type}]  ${rel(unit.file)}:${unit.startLine}`,
        )
      }

      if (showCode && units.length >= 2) {
        const a = units[0].unit
        const b = units[units.length - 1].unit
        const labelA = `${a.name}${units[0].role ? ` (${units[0].role})` : ''}`
        const labelB = `${b.name}${units[units.length - 1].role ? ` (${units[units.length - 1].role})` : ''}`
        lines.push('')
        lines.push(
          showDuplicatedLines(
            labelA,
            a.file,
            a.startLine,
            a.endLine,
            labelB,
            b.file,
            b.startLine,
            b.endLine,
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
  const dirs = files.map(f => f.split('/').slice(0, -1))
  let prefix = dirs[0]
  for (const dir of dirs.slice(1)) {
    let i = 0
    while (i < prefix.length && i < dir.length && prefix[i] === dir[i]) i++
    prefix = prefix.slice(0, i)
  }
  return prefix.length ? prefix.join('/') + '/' : ''
}
