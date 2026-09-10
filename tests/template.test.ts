import { describe, it, expect, beforeAll } from 'vitest'
import { loadTemplateParser, extractTemplateUnits } from '../src/lang/template'
import { rubyTokens, parseSource } from '../src/lang/parser'

beforeAll(async () => {
  await loadTemplateParser()
})

const options = { rubyTokens }

function tokensOf(source: string): string[] {
  const [template] = extractTemplateUnits(source, 'a.html.erb', options)
  return template.tokens
}

describe('extractTemplateUnits', () => {
  it('emits the whole template as a unit — "extract a partial" is a file-level finding', () => {
    const units = extractTemplateUnits('<p>hello</p>', 'views/_card.html.erb', options)
    expect(units[0]).toMatchObject({ name: '_card.html.erb', type: 'template', startLine: 1 })
  })

  it('emits each ERB block so a repeated body inside one template is visible', () => {
    const units = extractTemplateUnits(
      [
        '<ul>',
        '  <% rows.each do |row| %>',
        '    <li><%= row.name %></li>',
        '  <% end %>',
        '</ul>',
      ].join('\n'),
      'a.html.erb',
      options,
    )
    expect(units.map(unit => unit.type)).toContain('block')
  })

  it('keeps tag and attribute names, which are structure', () => {
    expect(tokensOf('<section id="main"></section>')).toEqual(
      expect.arrayContaining(['<section', 'id', '</section>']),
    )
  })

  it('collapses text and quoted values, which carry the domain words', () => {
    const withOneName = tokensOf('<p title="Organizations">Total payouts</p>')
    const withAnother = tokensOf('<p title="Companies">Total refunds</p>')
    expect(withOneName).toEqual(withAnother)
  })

  it('collapses class lists, so utility CSS does not make identical markup diverge', () => {
    const a = tokensOf('<div class="flex gap-2 rounded"></div>')
    const b = tokensOf('<div class="grid p-8"></div>')
    expect(a).toEqual(b)
  })

  it('keeps class lists apart when asked to', () => {
    const a = tokensOf('<div class="flex"></div>')
    const b = extractTemplateUnits('<div class="grid"></div>', 'a.html.erb', {
      rubyTokens,
      keepClassNames: true,
    })[0].tokens
    expect(a).not.toEqual(b)
  })

  it('normalizes embedded Ruby the way a .rb file would', () => {
    // Same shape, different domain — a Type-2 clone, and the tokens must agree.
    expect(tokensOf('<h2><%= organization.name %></h2>')).toEqual(
      tokensOf('<h2><%= company.title %></h2>'),
    )
  })

  it('tells two different template shapes apart', () => {
    expect(tokensOf('<div><span></span></div>')).not.toEqual(tokensOf('<div><p></p></div>'))
  })
})

describe('parseSource — .erb', () => {
  it('produces fingerprinted units for a template', () => {
    const units = parseSource('<div><%= a.b %></div>', 'views/show.html.erb')
    expect(units[0].language).toBe('erb')
    expect(units[0].fingerprint.length).toBeGreaterThan(0)
  })
})
