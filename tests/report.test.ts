import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { formatReport, formatCheckReport, countFindings } from '../src/report/report'
import { formatGroups, commonDirPrefix, cloneType, cloneTypeLabel } from '../src/report/format'
import { renderStructuralMatchView } from '../src/report/structural-match-view'
import type { CloneGroup, CodeUnit } from '../src/types'
import type { CheckReport } from '../src/pipeline/checker'
import type { DisplayGroup } from '../src/report/format'

let tmp: string

beforeEach(() => {
  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-report-'))
})

afterEach(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

function makeUnit(overrides: Partial<CodeUnit> = {}): CodeUnit {
  return {
    file: '/project/src/a.ts',
    startLine: 1,
    endLine: 10,
    name: 'foo',
    type: 'function',
    language: 'typescript',
    tokenCount: 30,
    fingerprint: [1, 2, 3],
    ...overrides,
  }
}

function makeGroup(units: CodeUnit[], similarity = 1): CloneGroup {
  return { similarity, units: units.map((u, i) => ({ ...u, id: i + 1 })) }
}

// ── commonDirPrefix ───────────────────────────────────────────────────────────

describe('commonDirPrefix', () => {
  it('returns empty string for an empty list', () => {
    expect(commonDirPrefix([])).toBe('')
  })

  it('returns the directory of a single file', () => {
    expect(commonDirPrefix(['/a/b/c.ts'])).toBe('/a/b/')
  })

  it('returns the shared prefix of multiple files', () => {
    expect(commonDirPrefix(['/a/b/c.ts', '/a/b/d.ts'])).toBe('/a/b/')
  })

  it('returns the filesystem root when files share only root', () => {
    expect(commonDirPrefix(['/a/b/c.ts', '/x/y/z.ts'])).toBe('/')
  })

  it('returns empty string for disjoint relative paths', () => {
    expect(commonDirPrefix(['src/a.ts', 'lib/b.ts'])).toBe('')
  })
})

// ── cloneType / cloneTypeLabel ────────────────────────────────────────────────

describe('cloneType', () => {
  it('returns Type-1 for identical similarity and same line count', () => {
    const units = [
      makeUnit({ startLine: 1, endLine: 10 }),
      makeUnit({ startLine: 20, endLine: 29 }),
    ]
    expect(cloneType(1.0, units)).toBe('Type-1')
  })

  it('returns Type-2 for identical similarity but different line counts', () => {
    const units = [
      makeUnit({ startLine: 1, endLine: 10 }),
      makeUnit({ startLine: 20, endLine: 35 }),
    ]
    expect(cloneType(1.0, units)).toBe('Type-2')
  })

  it('returns Type-3 for similarity below 1', () => {
    const units = [makeUnit(), makeUnit()]
    expect(cloneType(0.8, units)).toBe('Type-3')
  })
})

describe('cloneTypeLabel', () => {
  it('returns a description for known types', () => {
    expect(cloneTypeLabel('Type-1')).toMatch(/exact copy/)
    expect(cloneTypeLabel('Type-2')).toMatch(/same structure/)
    expect(cloneTypeLabel('Type-3')).toMatch(/similar structure/)
  })

  it('returns empty string for unknown types', () => {
    expect(cloneTypeLabel('Type-99')).toBe('')
  })
})

// ── formatGroups ──────────────────────────────────────────────────────────────

describe('formatGroups', () => {
  it('returns "No similar code found." for empty input', () => {
    expect(formatGroups([])).toBe('No similar code found.\n')
  })

  it('renders a group with units and similarity', () => {
    const groups: DisplayGroup[] = [
      {
        similarity: 1,
        cloneType: 'Type-1',
        description: '2 functions in the same file',
        units: [{ unit: makeUnit({ name: 'alpha' }) }, { unit: makeUnit({ name: 'beta' }) }],
      },
    ]
    const output = formatGroups(groups)
    expect(output).toContain('alpha')
    expect(output).toContain('beta')
    expect(output).toContain('Type-1')
    expect(output).toContain('100%')
  })

  it('renders units with a role tag', () => {
    const groups: DisplayGroup[] = [
      {
        similarity: 0.9,
        cloneType: 'Type-3',
        description: 'insertion',
        units: [
          { unit: makeUnit({ name: 'newFn' }), role: 'new' },
          { unit: makeUnit({ name: 'existingFn' }), role: 'existing' },
        ],
      },
    ]
    const output = formatGroups(groups)
    expect(output).toContain('[new]')
    expect(output).toContain('[existing]')
  })

  it('uses the repoRoot option to shorten file paths', () => {
    const groups: DisplayGroup[] = [
      {
        similarity: 1,
        cloneType: 'Type-1',
        description: 'test',
        units: [
          { unit: makeUnit({ file: '/project/src/a.ts' }) },
          { unit: makeUnit({ file: '/project/src/b.ts' }) },
        ],
      },
    ]
    const output = formatGroups(groups, { repoRoot: '/project/' })
    expect(output).toContain('src/a.ts')
    expect(output).not.toContain('/project/src/a.ts')
  })

  it('keeps full file paths when repoRoot does not match', () => {
    const groups: DisplayGroup[] = [
      {
        similarity: 1,
        cloneType: 'Type-1',
        description: 'test',
        units: [
          { unit: makeUnit({ file: '/elsewhere/src/a.ts' }) },
          { unit: makeUnit({ file: '/elsewhere/src/b.ts' }) },
        ],
      },
    ]
    const output = formatGroups(groups, { repoRoot: '/project/' })
    expect(output).toContain('/elsewhere/src/a.ts')
  })

  it('renders the structural match view when showCode is true', () => {
    const fileA = path.join(tmp, 'a.ts')
    const fileB = path.join(tmp, 'b.ts')
    fs.writeFileSync(fileA, 'function foo() {\n  return 1\n}\n')
    fs.writeFileSync(fileB, 'function bar() {\n  return 1\n}\n')

    const groups: DisplayGroup[] = [
      {
        similarity: 1,
        cloneType: 'Type-1',
        description: 'test',
        units: [
          { unit: makeUnit({ file: fileA, name: 'foo', startLine: 1, endLine: 3 }) },
          { unit: makeUnit({ file: fileB, name: 'bar', startLine: 1, endLine: 3 }) },
        ],
      },
    ]
    const output = formatGroups(groups, { showCode: true })
    expect(output).toContain('foo')
    expect(output).toContain('bar')
  })

  it('adds roles to showCode labels', () => {
    const fileA = path.join(tmp, 'role-a.ts')
    const fileB = path.join(tmp, 'role-b.ts')
    fs.writeFileSync(fileA, 'function foo() {\n  return 1\n}\n')
    fs.writeFileSync(fileB, 'function bar() {\n  return 1\n}\n')

    const groups: DisplayGroup[] = [
      {
        similarity: 1,
        cloneType: 'Type-1',
        description: 'test',
        units: [
          { unit: makeUnit({ file: fileA, name: 'foo', startLine: 1, endLine: 3 }), role: 'new' },
          {
            unit: makeUnit({ file: fileB, name: 'bar', startLine: 1, endLine: 3 }),
            role: 'existing',
          },
        ],
      },
    ]
    const output = formatGroups(groups, { showCode: true })
    expect(output).toContain('foo (new)')
    expect(output).toContain('bar (existing)')
  })
})

// ── formatReport ─────────────────────────────────────────────────────────────

describe('formatReport', () => {
  it('returns "No similar code found." for empty groups', () => {
    expect(formatReport([])).toBe('No similar code found.\n')
  })

  it('filters out units contained within a larger unit in the same group', () => {
    const parent = makeUnit({ file: '/p/a.ts', startLine: 1, endLine: 20, name: 'Parent' })
    const child = makeUnit({ file: '/p/a.ts', startLine: 5, endLine: 10, name: 'child' })
    const otherParent = makeUnit({ file: '/p/b.ts', startLine: 1, endLine: 20, name: 'Parent' })
    const otherChild = makeUnit({ file: '/p/b.ts', startLine: 5, endLine: 10, name: 'child' })

    const groups = [makeGroup([parent, child, otherParent, otherChild])]
    const output = formatReport(groups)
    // Contained units are dropped, so only the parent-level units remain
    expect(output).toContain('Parent')
    // Group with < 2 units after filtering is dropped entirely (both files keep 1 unit each = 2 total)
    expect(output).not.toBe('No similar code found.\n')
  })

  it('drops units contained by another unit with the same start line', () => {
    const parent = makeUnit({ file: '/p/a.ts', startLine: 1, endLine: 20, name: 'Parent' })
    const child = makeUnit({ file: '/p/a.ts', startLine: 1, endLine: 10, name: 'child' })
    const otherParent = makeUnit({
      file: '/p/b.ts',
      startLine: 1,
      endLine: 20,
      name: 'OtherParent',
    })
    const otherChild = makeUnit({ file: '/p/b.ts', startLine: 1, endLine: 10, name: 'otherChild' })

    const output = formatReport([makeGroup([parent, child, otherParent, otherChild])])
    expect(output).toContain('Parent')
    expect(output).not.toContain('otherChild')
  })

  it('renders JSON output when json option is set', () => {
    const unitA = makeUnit({ file: '/p/a.ts', name: 'foo' })
    const unitB = makeUnit({ file: '/p/b.ts', name: 'bar' })
    const groups = [makeGroup([unitA, unitB])]
    const output = formatReport(groups, { json: true })
    const parsed = JSON.parse(output)
    expect(parsed.found).toBe(1)
    expect(parsed.groups[0].units).toHaveLength(2)
  })

  it('describes mixed unit types across different directories', () => {
    const functionUnit = makeUnit({ file: '/root/apps/web/a.ts', type: 'function', name: 'alpha' })
    const classUnit = makeUnit({ file: '/other/services/api/b.ts', type: 'class', name: 'Beta' })
    const output = formatReport([makeGroup([functionUnit, classUnit], 0.8)])
    expect(output).toContain('2 units across different directories')
  })

  it('describes clones inside a single file', () => {
    const unitA = makeUnit({ file: '/root/src/a.ts', name: 'alpha' })
    const unitB = makeUnit({ file: '/root/src/a.ts', name: 'beta', startLine: 20, endLine: 30 })
    const output = formatReport([makeGroup([unitA, unitB])])
    expect(output).toContain('2 functions in the same file')
  })

  it('keeps absolute paths in JSON when repoRoot does not match', () => {
    const unitA = makeUnit({ file: '/p/a.ts', name: 'foo' })
    const unitB = makeUnit({ file: '/q/b.ts', name: 'bar' })
    const output = formatReport([makeGroup([unitA, unitB])], { json: true, repoRoot: '/root/' })
    const parsed = JSON.parse(output)
    expect(parsed.groups[0].units[0].file).toBe('/p/a.ts')
  })
})

// ── formatCheckReport ─────────────────────────────────────────────────────────

describe('formatCheckReport', () => {
  it('renders insertions and modifications', () => {
    const unit = makeUnit({ name: 'newFn', file: '/p/src/new.ts' })
    const existing = makeUnit({ name: 'existingFn', file: '/p/src/existing.ts' })
    const report: CheckReport = {
      files: [
        {
          file: '/p/src/new.ts',
          insertions: [{ unit, existing, similarity: 0.9 }],
          modifications: [{ unit, existing, similarity: 0.85 }],
        },
      ],
      internal: [],
    }
    const output = formatCheckReport(report, '/p/')
    expect(output).toContain('newFn')
    expect(output).toContain('existingFn')
  })

  it('renders internal clone groups', () => {
    const unitA = makeUnit({ name: 'alpha', file: '/p/a.ts', id: 1 } as CodeUnit)
    const unitB = makeUnit({ name: 'beta', file: '/p/b.ts', id: 2 } as CodeUnit)
    const report: CheckReport = {
      files: [],
      internal: [{ similarity: 1, units: [unitA, unitB] }],
    }
    const output = formatCheckReport(report, '/p/')
    expect(output).toContain('alpha')
    expect(output).toContain('beta')
  })

  it('renders JSON output when json option is set', () => {
    const unit = makeUnit({ name: 'f', file: '/p/a.ts' })
    const existing = makeUnit({ name: 'g', file: '/p/b.ts' })
    const report: CheckReport = {
      files: [
        { file: '/p/a.ts', insertions: [{ unit, existing, similarity: 1 }], modifications: [] },
      ],
      internal: [],
    }
    const output = formatCheckReport(report, '/p/', { json: true })
    const parsed = JSON.parse(output)
    expect(parsed.found).toBe(1)
  })

  it('keeps absolute paths in JSON when repoRoot does not match', () => {
    const unit = makeUnit({ name: 'f', file: '/somewhere/a.ts' })
    const existing = makeUnit({ name: 'g', file: '/elsewhere/b.ts' })
    const report: CheckReport = {
      files: [
        {
          file: '/somewhere/a.ts',
          insertions: [{ unit, existing, similarity: 1 }],
          modifications: [],
        },
      ],
      internal: [],
    }
    const output = formatCheckReport(report, '/root/', { json: true })
    const parsed = JSON.parse(output)
    expect(parsed.groups[0].units[0].file).toBe('/somewhere/a.ts')
  })
})

// ── countFindings ─────────────────────────────────────────────────────────────

describe('countFindings', () => {
  it('returns 0 for an empty report', () => {
    expect(countFindings({ files: [], internal: [] })).toBe(0)
  })

  it('counts insertions and modifications across files', () => {
    const unit = makeUnit()
    const existing = makeUnit({ name: 'other' })
    const report: CheckReport = {
      files: [
        {
          file: '/p/a.ts',
          insertions: [{ unit, existing, similarity: 1 }],
          modifications: [{ unit, existing, similarity: 0.9 }],
        },
      ],
      internal: [],
    }
    expect(countFindings(report)).toBe(2)
  })

  it('counts internal clone groups', () => {
    const unitA = makeUnit({ file: '/p/a.ts', name: 'a', id: 1 } as CodeUnit)
    const unitB = makeUnit({ file: '/p/b.ts', name: 'b', id: 2 } as CodeUnit)
    const report: CheckReport = {
      files: [],
      internal: [{ similarity: 1, units: [unitA, unitB] }],
    }
    expect(countFindings(report)).toBe(1)
  })
})

// ── renderStructuralMatchView ────────────────────────────────────────────────

describe('renderStructuralMatchView', () => {
  it('returns empty string when a file does not exist', () => {
    const result = renderStructuralMatchView(
      'a',
      '/nonexistent/a.ts',
      1,
      5,
      'b',
      '/nonexistent/b.ts',
      1,
      5,
    )
    expect(result).toBe('')
  })

  it('renders a side-by-side structural match view of two real files', () => {
    const fileA = path.join(tmp, 'a.ts')
    const fileB = path.join(tmp, 'b.ts')
    fs.writeFileSync(fileA, 'function foo(x) {\n  return x + 1\n}\n')
    fs.writeFileSync(fileB, 'function bar(y) {\n  return y + 1\n}\n')
    const result = renderStructuralMatchView('foo', fileA, 1, 3, 'bar', fileB, 1, 3)
    expect(result).toContain('foo')
    expect(result).toContain('bar')
    expect(result).toContain('lines structurally matched')
  })

  it('backtracks through equal and non-equal rows in the structural match walk', () => {
    const fileA = path.join(tmp, 'lcs-a.ts')
    const fileB = path.join(tmp, 'lcs-b.ts')
    fs.writeFileSync(fileA, 'value = 1\nvalue = 1\nvalue = 1\n')
    fs.writeFileSync(fileB, 'value = 1\nvalue = 1\nvalue += 1\n')
    const result = renderStructuralMatchView('a', fileA, 1, 3, 'b', fileB, 1, 3)
    expect(result).toContain('2 of 3 lines structurally matched')
  })

  it('renders colors and handles uneven file lengths when stdout is a TTY', () => {
    const fileA = path.join(tmp, 'tty-a.ts')
    const fileB = path.join(tmp, 'tty-b.ts')
    fs.writeFileSync(fileA, 'alpha\nbeta\n')
    fs.writeFileSync(fileB, 'beta\ngamma\ndelta\n')

    const descriptor = Object.getOwnPropertyDescriptor(process.stdout, 'isTTY')
    Object.defineProperty(process.stdout, 'isTTY', { value: true, configurable: true })
    try {
      const result = renderStructuralMatchView('left', fileA, 1, 3, 'right', fileB, 1, 2)
      expect(result).toContain('\x1b[')
      expect(result).toContain('left')
      expect(result).toContain('right')
    } finally {
      if (descriptor) Object.defineProperty(process.stdout, 'isTTY', descriptor)
      else delete (process.stdout as NodeJS.WriteStream & { isTTY?: boolean }).isTTY
    }
  })

  it('pads missing left-side lines when the right-side snippet is longer', () => {
    const fileA = path.join(tmp, 'short-left.ts')
    const fileB = path.join(tmp, 'long-right.ts')
    fs.writeFileSync(fileA, 'alpha\n')
    fs.writeFileSync(fileB, 'alpha\nbeta\ngamma\n')

    const result = renderStructuralMatchView('left', fileA, 1, 1, 'right', fileB, 1, 3)
    expect(result).toContain('gamma')
  })

  it('reports 0 duplicated significant lines when only trivial lines match', () => {
    const fileA = path.join(tmp, 'trivial-a.ts')
    const fileB = path.join(tmp, 'trivial-b.ts')
    fs.writeFileSync(fileA, '{\n}\n')
    fs.writeFileSync(fileB, '{\n}\n')
    const result = renderStructuralMatchView('a', fileA, 1, 2, 'b', fileB, 1, 2)
    expect(result).toContain('0 of 0 lines structurally matched (0%)')
  })

  it('skips the structural match view when units are too large', () => {
    const lines = Array.from({ length: 1001 }, (_, i) => `const x${i} = ${i}`).join('\n')
    const fileA = path.join(tmp, 'big_a.ts')
    const fileB = path.join(tmp, 'big_b.ts')
    fs.writeFileSync(fileA, lines)
    fs.writeFileSync(fileB, lines)
    const result = renderStructuralMatchView('a', fileA, 1, 1001, 'b', fileB, 1, 1001)
    expect(result).toContain('too large to compare')
  })
})
