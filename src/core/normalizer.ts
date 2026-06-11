import type { SyntaxNode } from 'tree-sitter'

// Node types whose text is replaced with a canonical token.
// Structural tokens (keywords, operators, brackets) are kept as-is —
// they encode the shape of the code, which is exactly what we want to compare.
const IDENTIFIER_TYPES = new Set([
  'identifier',
  'property_identifier',
  'shorthand_property_identifier',
  // Destructuring shorthand: the `token` in `const { token } = x`. Without this
  // `{ token }` and `{ credential }` would produce different fingerprints and
  // their otherwise-identical functions would not be detected as Type-2 clones.
  'shorthand_property_identifier_pattern',
  'type_identifier',
  'constant',
  'self',
  'super',
  // Ruby variable flavors: `@user`, `@@count`, `$global`. These carry the
  // domain name, so they must normalize like any other identifier.
  'instance_variable',
  'class_variable',
  'global_variable',
])

const STRING_TYPES = new Set([
  'string',
  'template_string',
  'string_literal',
  'string_content',
  'heredoc_body',
  'heredoc_beginning',
])

// Ruby symbols (`:user_key`, `key:` hash labels) are name-like literals: two
// methods that differ only in the symbols they use are Type-2 clones. They get
// their own canonical token rather than ID so that `foo(:bar)` (symbol literal)
// stays structurally distinct from `foo(bar)` (variable reference).
const SYMBOL_TYPES = new Set(['simple_symbol', 'hash_key_symbol', 'delimited_symbol'])

const NUMBER_TYPES = new Set(['number', 'integer', 'float', 'complex', 'rational'])

export function normalizeNode(node: SyntaxNode): string[] {
  // Collapse entire string subtrees (e.g. template strings with interpolation)
  if (STRING_TYPES.has(node.type)) return ['STR']
  // Collapse symbol subtrees too (e.g. interpolated `:"user_#{id}"`)
  if (SYMBOL_TYPES.has(node.type)) return ['SYM']

  if (node.childCount === 0) {
    if (IDENTIFIER_TYPES.has(node.type)) return ['ID']
    if (NUMBER_TYPES.has(node.type)) return ['NUM']
    const text = node.text.trim()
    return text ? [text] : []
  }

  return node.children.flatMap(normalizeNode)
}
