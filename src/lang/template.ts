import { Herb } from '@herb-tools/node-wasm'

// Herb is a WebAssembly module and has to be instantiated before it can parse.
// The rest of surgex parses synchronously, so the load happens once up front
// rather than being awaited per file; until it has, ERB files yield no units.
let herbLoaded = false

export async function loadTemplateParser(): Promise<void> {
  if (herbLoaded) return
  await Herb.load()
  herbLoaded = true
}

export function templateParserReady(): boolean {
  return herbLoaded
}

export interface TemplateUnit {
  name: string
  type: 'template' | 'block'
  startLine: number
  endLine: number
  tokens: string[]
}

// Herb's AST is plain data, so the fields are read defensively: a node type
// this walker does not know about still contributes its children rather than
// silently dropping a subtree out of the fingerprint.
type HerbNode = Record<string, unknown> & { type: string }

function isNode(value: unknown): value is HerbNode {
  return typeof value === 'object' && value !== null && typeof (value as HerbNode).type === 'string'
}

// Names arrive as either a raw string or a lexer token carrying `value`.
function tokenText(value: unknown): string {
  if (typeof value === 'string') return value
  if (value && typeof value === 'object' && 'value' in value) {
    const inner = (value as { value: unknown }).value
    if (typeof inner === 'string') return inner
  }
  return ''
}

function lineOf(node: unknown, edge: 'start' | 'end'): number {
  const location = isNode(node) ? (node.location as Record<string, unknown> | undefined) : undefined
  const point = location?.[edge] as { line?: number } | undefined
  return typeof point?.line === 'number' ? point.line : 1
}

// Child arrays live under different field names depending on the node.
const CHILD_FIELDS = [
  'children',
  'body',
  'statements',
  'rescue_clause',
  'else_clause',
  'ensure_clause',
  'subsequent',
]

function childNodes(node: HerbNode): HerbNode[] {
  const found: HerbNode[] = []
  for (const field of CHILD_FIELDS) {
    const value = node[field]
    if (Array.isArray(value)) found.push(...value.filter(isNode))
    else if (isNode(value)) found.push(value)
  }
  return found
}

export interface TemplateOptions {
  // Ruby embedded in `<%= %>` is normalized by the Ruby normalizer, so
  // `<%= org.name %>` and `<%= company.title %>` collapse to the same shape.
  rubyTokens: (source: string) => string[]
  // Class lists are the noisiest attribute in a utility-CSS codebase: keeping
  // them makes near-identical markup diverge. Collapsed by default.
  keepClassNames?: boolean
}

const COLLAPSED_ATTRIBUTES = new Set(['class'])

// Each class name is its own token, so `flex gap-2` and `flex p-8` share a
// token rather than being two opaque strings.
function classWords(value: HerbNode, options: TemplateOptions): string[] {
  return childNodes(value).flatMap(child =>
    child.type === 'AST_LITERAL_NODE'
      ? (tokenText(child.content) || String(child.content ?? '')).split(/\s+/).filter(Boolean)
      : normalize(child, options),
  )
}

function normalize(node: HerbNode, options: TemplateOptions): string[] {
  switch (node.type) {
    // Text and quoted literals carry the domain words, not the structure.
    case 'AST_HTML_TEXT_NODE': {
      const content = tokenText(node.content) || String(node.content ?? '')
      return content.trim() ? ['TEXT'] : []
    }
    case 'AST_LITERAL_NODE':
      return ['STR']
    case 'AST_HTML_COMMENT_NODE':
    case 'AST_WHITESPACE_NODE':
    case 'AST_HTML_DOCTYPE_NODE':
    case 'AST_XML_DECLARATION_NODE':
      return []

    case 'AST_HTML_ELEMENT_NODE': {
      const tag = tokenText(node.tag_name) || 'tag'
      const open = isNode(node.open_tag) ? normalize(node.open_tag, options) : []
      const body = childNodes(node).flatMap(child => normalize(child, options))
      return [`<${tag}`, ...open, '>', ...body, `</${tag}>`]
    }

    case 'AST_HTML_OPEN_TAG_NODE':
      return childNodes(node).flatMap(child => normalize(child, options))

    case 'AST_HTML_ATTRIBUTE_NODE': {
      const name = isNode(node.name)
        ? childNodes(node.name)
            .map(part => tokenText(part.content) || String(part.content ?? ''))
            .join('')
        : tokenText(node.name)

      // The attribute name is structure; its value rarely is. A class list is
      // the exception worth a switch: collapsed, two cards that differ only in
      // padding read as one shape; kept, they never match at all.
      if (COLLAPSED_ATTRIBUTES.has(name)) {
        if (!options.keepClassNames) return [name, '=', 'STR']
        const words = isNode(node.value) ? classWords(node.value, options) : []
        return [name, '=', ...(words.length ? words : ['STR'])]
      }

      const value = isNode(node.value) ? normalize(node.value, options) : []
      return value.length ? [name, '=', ...value] : [name]
    }

    case 'AST_HTML_ATTRIBUTE_VALUE_NODE':
      return childNodes(node).flatMap(child => normalize(child, options))

    default:
      break
  }

  if (node.type.startsWith('AST_ERB_')) {
    const ruby = tokenText(node.content) || String(node.content ?? '')
    const body = childNodes(node).flatMap(child => normalize(child, options))
    return ['ERB', ...options.rubyTokens(ruby), ...body, 'ERB_END']
  }

  return childNodes(node).flatMap(child => normalize(child, options))
}

// A duplicated view is usually a whole file — "these two partials are the same,
// extract one" is the finding Rails codebases actually act on. Blocks are
// emitted too so a repeated `each` body inside one long template is still
// visible; `dropContainedUnits` collapses the pair when both match.
export function extractTemplateUnits(
  source: string,
  filePath: string,
  options: TemplateOptions,
): TemplateUnit[] {
  if (!herbLoaded) return []

  let document: HerbNode
  try {
    const parsed = Herb.parse(source) as unknown as { value?: unknown }
    if (!isNode(parsed.value)) return []
    document = parsed.value
  } catch {
    return []
  }

  const units: TemplateUnit[] = []
  const name = filePath.split(/[\\/]/).pop() ?? filePath

  units.push({
    name,
    type: 'template',
    startLine: 1,
    endLine: source.split('\n').length,
    tokens: normalize(document, options),
  })

  const visit = (node: HerbNode) => {
    if (node.type === 'AST_ERB_BLOCK_NODE') {
      const ruby = (tokenText(node.content) || String(node.content ?? '')).trim()
      units.push({
        name: ruby || 'block',
        type: 'block',
        startLine: lineOf(node, 'start'),
        endLine: lineOf(node, 'end'),
        tokens: normalize(node, options),
      })
    }
    for (const child of childNodes(node)) visit(child)
  }
  visit(document)

  return units
}
