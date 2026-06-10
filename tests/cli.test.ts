import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { execFileSync } from 'child_process'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'

const CLI = path.join(__dirname, '..', 'dist', 'cli', 'index.js')

const CLONE_A = `export function useProducts(token) {
  const items = fetchData(token)
  if (!items) { throw new Error('no data') }
  return items.map(i => i.id)
}
`

interface RunResult {
  stdout: string
  stderr: string
  status: number
}

function run(args: string[], cwd: string): RunResult {
  try {
    const stdout = execFileSync('node', [CLI, ...args], { cwd, encoding: 'utf8' })
    return { stdout, stderr: '', status: 0 }
  } catch (err) {
    const e = err as { stdout?: string; stderr?: string; status?: number }
    return { stdout: e.stdout ?? '', stderr: e.stderr ?? '', status: e.status ?? 1 }
  }
}

let tmp: string

beforeAll(() => {
  // CLI smoke tests run against the built output
  execFileSync('npx', ['tsc'], { cwd: path.join(__dirname, '..') })

  tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-cli-'))
  fs.mkdirSync(path.join(tmp, 'src'))
  fs.writeFileSync(path.join(tmp, 'src/a.ts'), CLONE_A)
  fs.writeFileSync(path.join(tmp, 'src/b.ts'), CLONE_A.replace(/useProducts/g, 'useSuppliers'))
}, 120_000)

afterAll(() => {
  fs.rmSync(tmp, { recursive: true, force: true })
})

describe('surgex CLI', () => {
  it('prints help for unknown commands', () => {
    const { stdout, status } = run([], tmp)
    expect(status).toBe(0)
    expect(stdout).toContain('surgex — deterministic code clone detector')
  })

  it('fails with a friendly message when no index exists', () => {
    const { stderr, status } = run(['check', '--all'], tmp)
    expect(status).toBe(1)
    expect(stderr).toContain('No index found')
    expect(stderr).not.toContain('at ') // no stack trace
  })

  it('indexes and reports clones (report alias must not recurse)', () => {
    const indexRun = run(['index', 'src'], tmp)
    expect(indexRun.status).toBe(0)
    expect(indexRun.stdout).toContain('Done:')

    const { stdout, status } = run(['report'], tmp)
    expect(status).toBe(0)
    expect(stdout).toContain('Type-1')
    expect(stdout).toContain('useProducts')
    expect(stdout).toContain('useSuppliers')
  })

  it('emits machine-readable output with --json', () => {
    const { stdout, status } = run(['check', '--all', '--json'], tmp)
    expect(status).toBe(0)
    const parsed = JSON.parse(stdout)
    expect(parsed.found).toBe(1)
    expect(parsed.groups[0].units.map((u: { name: string }) => u.name).sort()).toEqual([
      'useProducts',
      'useSuppliers',
    ])
    expect(parsed.groups[0].units[0].file).not.toContain(tmp) // relative paths
  })

  it('exits 1 with --fail-on-found when clones exist', () => {
    const { status } = run(['check', '--all', '--fail-on-found'], tmp)
    expect(status).toBe(1)
  })

  it('rejects invalid numeric flags', () => {
    const { stderr, status } = run(['check', '--all', '--threshold=abc'], tmp)
    expect(status).toBe(1)
    expect(stderr).toContain('Invalid value for --threshold')
  })
})
