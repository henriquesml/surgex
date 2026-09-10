import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import * as fs from 'fs'
import * as os from 'os'
import * as path from 'path'
import { loadConfig, resolveExcludes, PRESETS, EMPTY_CONFIG } from '../src/io/config'

let root: string
beforeEach(() => {
  root = fs.mkdtempSync(path.join(os.tmpdir(), 'surgex-config-'))
})
afterEach(() => {
  fs.rmSync(root, { recursive: true, force: true })
})

function write(config: unknown) {
  fs.writeFileSync(path.join(root, 'surgex.json'), JSON.stringify(config))
}

describe('loadConfig', () => {
  it('treats a missing config as no config at all', () => {
    expect(loadConfig(root)).toEqual(EMPTY_CONFIG)
  })

  it('reads presets, excludes and thresholds', () => {
    write({ presets: ['rails'], exclude: ['engines/ui/**'], threshold: 0.8, minTokens: 30 })
    expect(loadConfig(root)).toEqual({
      presets: ['rails'],
      exclude: ['engines/ui/**'],
      threshold: 0.8,
      minTokens: 30,
    })
  })

  it('names an unknown preset rather than silently ignoring it', () => {
    write({ presets: ['railz'] })
    expect(() => loadConfig(root)).toThrow(/unknown preset "railz"/)
  })

  it('rejects a malformed exclude list', () => {
    write({ exclude: 'engines/ui/**' })
    expect(() => loadConfig(root)).toThrow(/"exclude" must be an array of strings/)
  })

  it('rejects invalid JSON', () => {
    fs.writeFileSync(path.join(root, 'surgex.json'), '{ nope')
    expect(() => loadConfig(root)).toThrow(/Invalid JSON/)
  })
})

describe('resolveExcludes', () => {
  it('expands presets, then config globs, then command-line ones', () => {
    const excludes = resolveExcludes({ presets: ['rails'], exclude: ['engines/ui/**'] }, ['tmp/**'])
    expect(excludes).toEqual([...PRESETS.rails, 'engines/ui/**', 'tmp/**'])
  })

  it('is empty for a project with no config and no flags', () => {
    expect(resolveExcludes(EMPTY_CONFIG)).toEqual([])
  })
})
