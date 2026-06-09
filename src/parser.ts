import Parser from 'tree-sitter'
import type { SyntaxNode } from 'tree-sitter'
import * as fs from 'fs'
import { normalizeNode } from './normalizer'
import { fingerprint } from './fingerprinter'
import type { CodeUnit, Language, UnitType } from './types'

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

function extractTypeScriptUnits(root: SyntaxNode): RawUnit[] {
  const units: RawUnit[] = []

  function walk(node: SyntaxNode) {
    switch (node.type) {
      case 'function_declaration': {
        const name = node.childForFieldName('name')
        if (name) units.push({ name: name.text, type: 'function', node })
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
        const value = node.childForFieldName('value')
        const name = node.childForFieldName('name')
        if (name && value && (value.type === 'arrow_function' || value.type === 'function')) {
          units.push({ name: name.text, type: 'arrow', node: value })
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
export function parseSource(source: string, filePath: string): CodeUnit[] {
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

  return rawUnits.map(({ name, type, node }) => {
    const tokens = normalizeNode(node)
    const fp = fingerprint(tokens)
    return {
      file: filePath,
      startLine: node.startPosition.row + 1,
      endLine: node.endPosition.row + 1,
      name, type, language,
      tokenCount: tokens.length,
      fingerprint: fp,
    }
  })
}

export function parseFile(filePath: string): CodeUnit[] {
  let source: string
  try {
    source = fs.readFileSync(filePath, 'utf8')
  } catch {
    return []
  }

  return parseSource(source, filePath)
}

