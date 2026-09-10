import Parser from 'tree-sitter'
import type { SyntaxNode } from 'tree-sitter'
import * as fs from 'fs'
import { normalizeNode } from '../core/normalizer'
import { fingerprint, DEFAULT_PARAMS, type FingerprintParams } from '../core/fingerprint'
import type { CodeUnit, Language, UnitType } from '../types'
import { extractTemplateUnits } from './template'

// tree-sitter grammars ship as native CommonJS modules without type declarations.
// They are loaded lazily so that consumers of the pure fingerprint/jaccard API
// don't pay the cost of loading native grammars they'll never use.
let tsParserInstance: Parser | null = null
let tsxParserInstance: Parser | null = null
let rubyParserInstance: Parser | null = null

function tsParser(): Parser {
  if (!tsParserInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { typescript } = require('tree-sitter-typescript')
    tsParserInstance = new Parser()
    tsParserInstance.setLanguage(typescript)
  }
  return tsParserInstance
}

function tsxParser(): Parser {
  if (!tsxParserInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const { tsx } = require('tree-sitter-typescript')
    tsxParserInstance = new Parser()
    tsxParserInstance.setLanguage(tsx)
  }
  return tsxParserInstance
}

function rubyParser(): Parser {
  if (!rubyParserInstance) {
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const RubyGrammar = require('tree-sitter-ruby')
    rubyParserInstance = new Parser()
    rubyParserInstance.setLanguage(RubyGrammar)
  }
  return rubyParserInstance
}

interface RawUnit {
  name: string
  type: UnitType
  node: SyntaxNode
}

const FUNCTION_TYPES = new Set(['arrow_function', 'function_expression', 'function'])

// Unwraps wrapper calls like `memo(fn)`, `forwardRef(fn)`, `memo(forwardRef(fn))`
// down to the inner function node, so wrapped React components are indexed too.
function unwrapFunction(node: SyntaxNode | null): SyntaxNode | null {
  if (node && FUNCTION_TYPES.has(node.type)) return node
  if (node?.type !== 'call_expression') return null
  const args = node.childForFieldName('arguments') as SyntaxNode
  for (const arg of args.namedChildren) {
    const inner = unwrapFunction(arg)
    if (inner) return inner
  }
  return null
}

function extractTypeScriptUnits(root: SyntaxNode): RawUnit[] {
  const units: RawUnit[] = []

  function walk(node: SyntaxNode) {
    switch (node.type) {
      case 'function_declaration': {
        units.push({ name: node.childForFieldName('name')!.text, type: 'function', node })
        break
      }
      case 'method_definition': {
        const name = node.childForFieldName('name')?.text
        if (name) units.push({ name, type: 'method', node })
        break
      }
      case 'class_declaration': {
        units.push({ name: node.childForFieldName('name')!.text, type: 'class', node })
        break
      }
      case 'variable_declarator': {
        const name = node.childForFieldName('name')?.text
        const functionNode = unwrapFunction(node.childForFieldName('value'))
        if (name && functionNode) units.push({ name, type: 'arrow', node: functionNode })
        break
      }
      // Class property arrows: `handleClick = () => {...}`
      case 'public_field_definition': {
        const name = node.childForFieldName('name')?.text
        const functionNode = unwrapFunction(node.childForFieldName('value'))
        if (name && functionNode) units.push({ name, type: 'method', node: functionNode })
        break
      }
      // Object literal entries: `{ fetchAll: () => {...} }`
      case 'pair': {
        const key = node.childForFieldName('key')?.text
        const functionNode = unwrapFunction(node.childForFieldName('value'))
        if (key && functionNode) units.push({ name: key, type: 'arrow', node: functionNode })
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

// `test "..." do`, `included do`, `namespace :x do`: Rails and the test
// frameworks put real, duplicable bodies in blocks rather than in `def`s, so a
// block is named by its first string/symbol argument, falling back to the DSL
// method itself (`included do` has no arguments).
const LABEL_ARGUMENT_TYPES = new Set(['string', 'simple_symbol'])

function rubyBlockName(call: SyntaxNode): string {
  const firstArgument = call.childForFieldName('arguments')?.namedChildren[0]
  const label =
    firstArgument && LABEL_ARGUMENT_TYPES.has(firstArgument.type)
      ? firstArgument.text.replace(/^[:"']|["']$/g, '').trim()
      : ''
  return label || call.childForFieldName('method')!.text
}

// `module RuboCop; module Cop; class LaunchdarklySnakeCase ...` — the outer
// wrappers hold no code of their own. Emitting them makes every namespace read
// as a clone of every other namespace, and reports the real finding under a
// name nobody searches for. The nested definition is still extracted.
function isNamespaceShell(node: SyntaxNode): boolean {
  const body = node.childForFieldName('body')
  if (!body) return false
  const declarations = body.namedChildren.filter(child => child.type !== 'comment')
  return (
    declarations.length > 0 &&
    declarations.every(child => child.type === 'class' || child.type === 'module')
  )
}

function extractRubyUnits(root: SyntaxNode): RawUnit[] {
  const units: RawUnit[] = []

  // `insideMethod` keeps `rows.each do ... end` from becoming a unit of its
  // own: inside a method body a block is implementation detail the method unit
  // already covers. At class, module, or file level it is the body itself.
  function walk(node: SyntaxNode, insideMethod: boolean) {
    let childrenAreInsideMethod = insideMethod

    if (node.type === 'method' || node.type === 'singleton_method') {
      const name = node.childForFieldName('name')?.text
      if (name) units.push({ name, type: 'method', node })
      childrenAreInsideMethod = true
    } else if (node.type === 'class' || node.type === 'module') {
      const name = node.childForFieldName('name')?.text
      const type = node.type === 'class' ? 'class' : 'module'
      if (name && !isNamespaceShell(node)) units.push({ name, type, node })
    } else if (!insideMethod && node.type === 'call') {
      const block = node.childForFieldName('block')
      if (block) units.push({ name: rubyBlockName(node), type: 'block', node: block })
    }

    for (const child of node.children) walk(child, childrenAreInsideMethod)
  }

  walk(root, false)
  return units
}

// Ruby is not only `.rb`: task files, gemspecs and rack config are plain Ruby
// the walk used to step past. Extensionless Ruby is matched by basename.
const RUBY_EXTENSIONS = new Set(['rb', 'rake', 'gemspec', 'ru', 'jbuilder'])
const RUBY_BASENAMES = new Set(['Rakefile'])

type SourceKind = 'ts' | 'tsx' | 'ruby' | 'erb'

export function sourceKind(filePath: string): SourceKind | null {
  const basename = filePath.split(/[\\/]/).pop()!
  if (RUBY_BASENAMES.has(basename)) return 'ruby'
  const extension = basename.includes('.') ? basename.split('.').pop()!.toLowerCase() : ''
  if (extension === 'tsx') return 'tsx'
  if (extension === 'ts') return 'ts'
  if (extension === 'erb') return 'erb'
  if (RUBY_EXTENSIONS.has(extension)) return 'ruby'
  return null
}

// Single source of truth for "surgex can read this file", shared by the
// indexer glob and by the git-diff filter in `check`.
export function isSupportedFile(filePath: string): boolean {
  return sourceKind(filePath) !== null
}

// Normalized tokens for a Ruby fragment. Templates use it so the Ruby inside
// `<%= %>` collapses exactly the way it does in a `.rb` file: `<%= org.name %>`
// and `<%= company.title %>` produce the same shape.
export function rubyTokens(source: string): string[] {
  try {
    if (!source.trim()) return []
    return normalizeNode(rubyParser().parse(source).rootNode)
  } catch {
    return []
  }
}

// Parse source code directly (used when content comes from git, not disk)
export function parseSource(
  source: string,
  filePath: string,
  params: FingerprintParams = DEFAULT_PARAMS,
): CodeUnit[] {
  const kind = sourceKind(filePath)

  // Templates come from Herb, not tree-sitter, and carry their own tokens, so
  // they skip the shared node-walking path below entirely.
  if (kind === 'erb') {
    return extractTemplateUnits(source, filePath, { rubyTokens }).map(unit => ({
      file: filePath,
      startLine: unit.startLine,
      endLine: unit.endLine,
      name: unit.name,
      type: unit.type as UnitType,
      language: 'erb' as Language,
      tokenCount: unit.tokens.length,
      fingerprint: fingerprint(unit.tokens, params),
    }))
  }

  let tree: ReturnType<Parser['parse']>
  let language: Language
  let rawUnits: RawUnit[]

  try {
    if (kind === 'tsx') {
      tree = tsxParser().parse(source)
      language = 'typescript'
      rawUnits = extractTypeScriptUnits(tree.rootNode)
    } else if (kind === 'ts') {
      tree = tsParser().parse(source)
      language = 'typescript'
      rawUnits = extractTypeScriptUnits(tree.rootNode)
    } else if (kind === 'ruby') {
      tree = rubyParser().parse(source)
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
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      name,
      type,
      language,
      tokenCount: tokens.length,
      fingerprint: fingerprint(tokens, params),
    }
  })

  // Dedupe: a node can be reached through two cases (e.g. `export default
  // function f() {}` via function_declaration only, but wrappers can overlap).
  const seenKeys = new Set<string>()
  return units.filter(unit => {
    const key = `${unit.startLine}:${unit.endLine}:${unit.name}`
    if (seenKeys.has(key)) return false
    seenKeys.add(key)
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
