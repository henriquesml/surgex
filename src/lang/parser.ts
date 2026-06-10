import Parser from 'tree-sitter'
import type { SyntaxNode } from 'tree-sitter'
import * as fs from 'fs'
import { normalizeNode } from '../core/normalizer'
import { fingerprint, DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import type { CodeUnit, Language, UnitType } from '../types'

// tree-sitter grammars ship as native CommonJS modules without type declarations.
// eslint-disable-next-line @typescript-eslint/no-var-requires
const { typescript: TypeScriptGrammar, tsx: TsxGrammar } = require('tree-sitter-typescript')
// eslint-disable-next-line @typescript-eslint/no-var-requires
const RubyGrammar = require('tree-sitter-ruby')

const tsParser = new Parser()
tsParser.setLanguage(TypeScriptGrammar)

const tsxParser = new Parser()
tsxParser.setLanguage(TsxGrammar)

const rubyParser = new Parser()
rubyParser.setLanguage(RubyGrammar)

interface RawUnit {
  name: string
  type: UnitType
  node: SyntaxNode
}

const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function'])

// Unwraps wrapper calls like `memo(fn)`, `forwardRef(fn)`, `memo(forwardRef(fn))`
// down to the inner function node, so wrapped React components are indexed too.
function unwrapFunction(node: SyntaxNode | null): SyntaxNode | null {
  if (!node) return null
  if (FUNCTION_TYPES.has(node.type)) return node
  if (node.type === 'call_expression') {
    const args = node.childForFieldName('arguments')
    if (!args) return null
    for (const arg of args.namedChildren) {
      const inner = unwrapFunction(arg)
      if (inner) return inner
    }
  }
  return null
}

function extractTypeScriptUnits(root: SyntaxNode): RawUnit[] {
  const units: RawUnit[] = []

  function walk(node: SyntaxNode) {
    switch (node.type) {
      case 'function_declaration': {
        const name = node.childForFieldName('name')
        // `export default function () {}` has no name
        units.push({ name: name?.text ?? 'default', type: 'function', node })
        break
      }
      case 'method_definition': {
        const name = node.childForFieldName('name')
        if (name) units.push({ name: name.text, type: 'method', node })
        break
      }
      case 'class_declaration': {
        const name = node.childForFieldName('name')
        if (name) units.push({ name: name.text, type: 'class', node })
        break
      }
      case 'variable_declarator': {
        const name = node.childForFieldName('name')
        const fn = unwrapFunction(node.childForFieldName('value'))
        if (name && fn) units.push({ name: name.text, type: 'arrow', node: fn })
        break
      }
      // Class property arrows: `handleClick = () => {...}`
      case 'public_field_definition': {
        const name = node.childForFieldName('name')
        const fn = unwrapFunction(node.childForFieldName('value'))
        if (name && fn) units.push({ name: name.text, type: 'method', node: fn })
        break
      }
      // Object literal entries: `{ fetchAll: () => {...} }`
      case 'pair': {
        const key = node.childForFieldName('key')
        const fn = unwrapFunction(node.childForFieldName('value'))
        if (key && fn) units.push({ name: key.text, type: 'arrow', node: fn })
        break
      }
      // `export default () => {}` / `export default function () {}` (function
      // declarations are caught above; this covers bare expressions)
      case 'export_statement': {
        const value = node.childForFieldName('value')
        if (value && FUNCTION_TYPES.has(value.type)) {
          const type = value.type === 'arrow_function' ? 'arrow' : 'function'
          units.push({ name: 'default', type, node: value })
        }
        break
      }
    }

    for (const child of node.children) walk(child)
  }

  walk(root)
  return units
}

function extractRubyUnits(root: SyntaxNode): RawUnit[] {
  const units: RawUnit[] = []

  function walk(node: SyntaxNode) {
    if (node.type === 'method' || node.type === 'singleton_method') {
      const name = node.childForFieldName('name')
      if (name) units.push({ name: name.text, type: 'method', node })
    } else if (node.type === 'class') {
      const name = node.childForFieldName('name')
      if (name) units.push({ name: name.text, type: 'class', node })
    }

    for (const child of node.children) walk(child)
  }

  walk(root)
  return units
}

// Parse source code directly (used when content comes from git, not disk)
export function parseSource(
  source: string,
  filePath: string,
  params: FingerprintParams = DEFAULT_PARAMS,
): CodeUnit[] {
  const ext = filePath.split('.').pop()?.toLowerCase()
  let tree: ReturnType<Parser['parse']>
  let language: Language
  let rawUnits: RawUnit[]

  try {
    if (ext === 'tsx') {
      tree = tsxParser.parse(source)
      language = 'typescript'
      rawUnits = extractTypeScriptUnits(tree.rootNode)
    } else if (ext === 'ts') {
      tree = tsParser.parse(source)
      language = 'typescript'
      rawUnits = extractTypeScriptUnits(tree.rootNode)
    } else if (ext === 'rb') {
      tree = rubyParser.parse(source)
      language = 'ruby'
      rawUnits = extractRubyUnits(tree.rootNode)
    } else {
      return []
    }
  } catch {
    return []
  }

  const units = rawUnits.map(({ name, type, node }) => {
    const tokens = normalizeNode(node)
    const fp = fingerprint(tokens, params)
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      name,
      type,
      language,
      tokenCount: tokens.length,
      fingerprint: fp,
    }
  })

  // Dedupe: a node can be reached through two cases (e.g. `export default
  // function f() {}` via function_declaration only, but wrappers can overlap).
  const seen = new Set<string>()
  return units.filter(u => {
    const key = `${u.startLine}:${u.endLine}:${u.name}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

export function parseFile(
  filePath: string,
  params: FingerprintParams = DEFAULT_PARAMS,
): CodeUnit[] {
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  return parseSource(source, filePath, params)
}
