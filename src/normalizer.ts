import type { SyntaxNode } from 'tree-sitter'

// Node types whose text is replaced with a canonical token.
// Structural tokens (keywords, operators, brackets) are kept as-is —
// they encode the shape of the code, which is exactly what we want to compare.
const IDENTIFIER_TYPES = new Set([
  'identifier', 'property_identifier', 'shorthand_property_identifier',
  'type_identifier', 'constant', 'self', 'super',
])

const STRING_TYPES = new Set([
  'string', 'template_string', 'string_literal', 'string_content',
  'heredoc_body', 'heredoc_beginning',
])

const NUMBER_TYPES = new Set([
  'number', 'integer', 'float', 'complex', 'rational',
])

export function normalizeNode(node: SyntaxNode): string[] {
  // Collapse entire string subtrees (e.g. template strings with interpolation)
  if (STRING_TYPES.has(node.type)) return ['STR']

  if (node.childCount === 0) {
    if (IDENTIFIER_TYPES.has(node.type)) return ['ID']
    if (NUMBER_TYPES.has(node.type)) return ['NUM']
    const text = node.text.trim()
    return text ? [text] : []
  }

  return node.children.flatMap(normalizeNode)
}
