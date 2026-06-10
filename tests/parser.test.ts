import { describe, it, expect } from 'vitest'
import { parseSource } from '../src/lang/parser'

function names(source: string, file: string) {
  return parseSource(source, file).map(u => `${u.name}:${u.type}`)
}

describe('parseSource — TypeScript', () => {
  it('extracts function declarations', () => {
    expect(names('function foo() { return 1 }', 'a.ts')).toContain('foo:function')
  })

  it('extracts class declarations and methods', () => {
    const src = 'class Foo { bar() { return 1 } }'
    const got = names(src, 'a.ts')
    expect(got).toContain('Foo:class')
    expect(got).toContain('bar:method')
  })

  it('extracts arrow functions assigned to const', () => {
    expect(names('const foo = () => 1', 'a.ts')).toContain('foo:arrow')
  })

  it('extracts anonymous function expressions assigned to const', () => {
    expect(names('const foo = function () { return 1 }', 'a.ts')).toContain('foo:arrow')
  })

  it('extracts memo/forwardRef-wrapped components', () => {
    const src = [
      'const Foo = memo(() => { return null })',
      'const Bar = forwardRef((props, ref) => { return null })',
      'const Baz = memo(forwardRef(() => null))',
    ].join('\n')
    const got = names(src, 'a.tsx')
    expect(got).toContain('Foo:arrow')
    expect(got).toContain('Bar:arrow')
    expect(got).toContain('Baz:arrow')
  })

  it('extracts class property arrows', () => {
    const src = 'class Foo { handleClick = () => { return 1 } }'
    expect(names(src, 'a.ts')).toContain('handleClick:method')
  })

  it('extracts object literal function entries', () => {
    const src = 'const api = { fetchAll: () => 1, save() { return 2 } }'
    const got = names(src, 'a.ts')
    expect(got).toContain('fetchAll:arrow')
    expect(got).toContain('save:method')
  })

  it('extracts default exports', () => {
    expect(names('export default function () { return 1 }', 'a.ts')).toContain('default:function')
    expect(names('export default () => { return 1 }', 'a.ts')).toContain('default:arrow')
  })

  it('does not produce duplicate units for the same node', () => {
    const src = 'export default function foo() { return 1 }'
    const got = names(src, 'a.ts').filter(n => n.startsWith('foo') || n.startsWith('default'))
    expect(got).toHaveLength(1)
  })
})

describe('parseSource — Ruby', () => {
  it('extracts methods, singleton methods and classes', () => {
    const src = [
      'class Foo',
      '  def bar',
      '    1',
      '  end',
      '  def self.baz',
      '    2',
      '  end',
      'end',
    ].join('\n')
    const got = names(src, 'a.rb')
    expect(got).toContain('Foo:class')
    expect(got).toContain('bar:method')
    expect(got).toContain('baz:method')
  })
})

describe('parseSource — normalization', () => {
  it('gives identical fingerprints to renamed but identical functions', () => {
    const a = parseSource(
      'function useProducts(token) { const items = fetch(token); return items }',
      'a.ts',
    )[0]
    const b = parseSource(
      'function useCategories(auth) { const list = fetch(auth); return list }',
      'b.ts',
    )[0]
    expect(a.fingerprint).toEqual(b.fingerprint)
  })

  it('returns [] for unsupported extensions', () => {
    expect(parseSource('function foo() {}', 'a.py')).toEqual([])
  })
})
