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

  it('still collapses an empty class list when class names are kept', () => {
    const [unit] = extractTemplateUnits('<div class=""></div>', 'a.html.erb', {
      rubyTokens,
      keepClassNames: true,
    })
    expect(unit.tokens).toEqual(expect.arrayContaining(['class', '=', 'STR']))
  })

  it('normalizes ERB inside a kept class list', () => {
    const kept = (source: string) =>
      extractTemplateUnits(source, 'a.html.erb', { rubyTokens, keepClassNames: true })[0].tokens
    expect(kept('<div class="<%= org.state %>"></div>')).toEqual(
      kept('<div class="<%= company.status %>"></div>'),
    )
  })

  it('handles a class attribute with no value at all', () => {
    const [unit] = extractTemplateUnits('<div class></div>', 'a.html.erb', {
      rubyTokens,
      keepClassNames: true,
    })
    expect(unit.tokens).toEqual(expect.arrayContaining(['class', '=', 'STR']))
  })

  it('survives a close tag with nothing open', () => {
    expect(() => tokensOf('&lt;/div&gt;')).not.toThrow()
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

describe('loadTemplateParser', () => {
  it('is safe to call again once the module is instantiated', async () => {
    await expect(loadTemplateParser()).resolves.toBeUndefined()
  })
})

describe('extractTemplateUnits — the rest of a real view', () => {
  it('contributes nothing for doctype, comments and whitespace', () => {
    const bare = tokensOf('<p>x</p>')
    const dressed = tokensOf('<!DOCTYPE html>\n<!-- a note -->\n<p>x</p>\n')
    expect(dressed).toEqual(bare)
  })

  it('keeps a boolean attribute that has no value', () => {
    expect(tokensOf('<input disabled>')).toEqual(expect.arrayContaining(['disabled']))
  })

  it('normalizes ERB inside an attribute value', () => {
    expect(tokensOf('<a href="<%= org.path %>">x</a>')).toEqual(
      tokensOf('<a href="<%= company.url %>">x</a>'),
    )
  })

  it('walks ERB control flow, not just output and blocks', () => {
    const units = extractTemplateUnits(
      ['<% if org.active? %>', '  <p>on</p>', '<% else %>', '  <p>off</p>', '<% end %>'].join('\n'),
      'a.html.erb',
      options,
    )
    expect(units[0].tokens).toEqual(expect.arrayContaining(['ERB', 'ERB_END']))
  })

  it('reports a block at the line it opens on', () => {
    const units = extractTemplateUnits(
      [
        '<div>',
        '  <% rows.each do |row| %>',
        '    <b><%= row.a %></b>',
        '  <% end %>',
        '</div>',
      ].join('\n'),
      'a.html.erb',
      options,
    )
    const block = units.find(unit => unit.type === 'block')!
    expect(block.startLine).toBe(2)
    expect(block.endLine).toBe(4)
  })

  it('returns [] when the source cannot be parsed at all', () => {
    expect(extractTemplateUnits(null as unknown as string, 'a.html.erb', options)).toEqual([])
  })
})
