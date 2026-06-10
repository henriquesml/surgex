import { describe, it, expect } from 'vitest'
import { normalizeNode } from '../src/core/normalizer'
import type { SyntaxNode } from 'tree-sitter'

function leafNode(type: string, text: string): SyntaxNode {
  return { type, text, childCount: 0, children: [] } as unknown as SyntaxNode
}

function parentNode(children: SyntaxNode[]): SyntaxNode {
  return { type: 'program', text: '', childCount: children.length, children } as unknown as SyntaxNode
}

describe('normalizeNode', () => {
  it('replaces identifier leaves with ID', () => {
    expect(normalizeNode(leafNode('identifier', 'myVar'))).toEqual(['ID'])
  })

  it('replaces string leaves with STR', () => {
    expect(normalizeNode(leafNode('string', '"hello"'))).toEqual(['STR'])
  })

  it('replaces number leaves with NUM', () => {
    expect(normalizeNode(leafNode('integer', '42'))).toEqual(['NUM'])
  })

  it('keeps structural tokens (operators, keywords) as-is', () => {
    expect(normalizeNode(leafNode('return', 'return'))).toEqual(['return'])
    expect(normalizeNode(leafNode('{', '{'))).toEqual(['{'])
  })

  it('returns empty array for leaf nodes with blank text', () => {
    expect(normalizeNode(leafNode('comment', '   '))).toEqual([])
  })

  it('flattens children of a parent node', () => {
    const node = parentNode([leafNode('return', 'return'), leafNode('integer', '1')])
    expect(normalizeNode(node)).toEqual(['return', 'NUM'])
  })

  it('collapses entire string subtrees to a single STR token', () => {
    const inner = parentNode([leafNode('string_content', 'hello')])
    const outer = { ...inner, type: 'string' } as unknown as SyntaxNode
    expect(normalizeNode(outer)).toEqual(['STR'])
  })
})
