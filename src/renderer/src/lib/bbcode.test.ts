import { describe, expect, it } from 'bun:test'
import { applyBbCode, applyListBbCode, bbcodeToHtml, htmlToBbcode } from './bbcode'
import { reactionIcon } from './reaction-icon'

describe('applyBbCode', () => {
  it('wraps the selection', () => {
    expect(applyBbCode('hello world', 6, 11, '[B]', '[/B]')).toEqual({
      value: 'hello [B]world[/B]',
      start: 9,
      end: 14
    })
  })

  it('inserts a placeholder when nothing is selected', () => {
    expect(applyBbCode('', 0, 0, '[URL]', '[/URL]', 'https://')).toEqual({
      value: '[URL]https://[/URL]',
      start: 5,
      end: 13
    })
  })
})

describe('bbcodeToHtml', () => {
  it('renders common tags and escapes html', () => {
    const html = bbcodeToHtml('[B]bold[/B] <script> [CODE]\n[B]raw[/B]\n[/CODE]')
    expect(html).toContain('<strong>bold</strong>')
    expect(html).toContain('&lt;script&gt;')
    expect(html).toContain('<pre class="bbcode-preview-code">')
    expect(html).toContain('[B]raw[/B]')
    expect(html).not.toMatch(/<script>/)
  })

  it('renders links with custom text, lists, color, size, and spoilers', () => {
    const html = bbcodeToHtml(
      '[URL=https://example.com]click[/URL] [LIST]\n[*] one\n[/LIST] [COLOR=#ff0000]red[/COLOR] [SIZE=18px]big[/SIZE] [ICODE]x[/ICODE] [ISPOILER]hide[/ISPOILER]'
    )
    expect(html).toContain('href="https://example.com"')
    expect(html).toContain('click')
    expect(html).toContain('<ul>')
    expect(html).toContain('<li>one</li>')
    expect(html).toContain('color:#ff0000')
    expect(html).toContain('font-size:18px')
    expect(html).toContain('bbcode-preview-icode')
    expect(html).toContain('bbcode-preview-ispoiler')
  })

  it('renders attachments from metadata', () => {
    const html = bbcodeToHtml('[ATTACH=full]9[/ATTACH]', [
      { id: 9, filename: 'shot.png', url: 'https://f95zone.to/attachments/9/', isImage: true }
    ])
    expect(html).toContain('data-attachment="full:9"')
    expect(html).toContain('shot.png')
  })

  it('renders named quotes as a said-title with a post jump', () => {
    const html = bbcodeToHtml(
      '[QUOTE="Yksok, post: 21793620, member: 44323"]\nA test, don\'t mind me...\n[/QUOTE]\nAnother test'
    )
    expect(html).toContain('Yksok said:')
    expect(html).toContain('bbCodeBlock-sourceJump')
    expect(html).toContain('https://f95zone.to/posts/21793620/')
    expect(html).toContain('data-post-id="21793620"')
    expect(html).toContain('data-member-id="44323"')
    expect(html).toContain('data-quote="&quot;Yksok, post: 21793620, member: 44323&quot;"')
    expect(html).toContain("A test, don't mind me...")
    expect(html).toContain('Another test')
    expect(html).not.toMatch(/bbCodeBlock-title[\s\S]{0,80}post: 21793620/)
  })
})

describe('applyListBbCode', () => {
  it('wraps selected lines as list items', () => {
    expect(applyListBbCode('a\nb', 0, 3, false)).toEqual({
      value: '[LIST]\n[*] a\n[*] b\n[/LIST]',
      start: 7,
      end: 18
    })
  })
})

describe('htmlToBbcode', () => {
  it('round-trips formatted html', () => {
    if (typeof DOMParser === 'undefined') return
    const html = bbcodeToHtml('[B]bold[/B] [URL=https://example.com]click[/URL] [ICODE]x[/ICODE]')
    const bb = htmlToBbcode(html)
    expect(bb).toContain('[B]bold[/B]')
    expect(bb).toContain('[URL=https://example.com]click[/URL]')
    expect(bb).toContain('[ICODE]x[/ICODE]')
  })

  it('round-trips named quotes without duplicating the body', () => {
    if (typeof DOMParser === 'undefined') return
    const source =
      '[QUOTE="Yksok, post: 21793620, member: 44323"]\nA test, don\'t mind me...\n[/QUOTE]\nAnother test'
    const once = htmlToBbcode(bbcodeToHtml(source))
    const twice = htmlToBbcode(bbcodeToHtml(once))
    expect(once).toContain('[QUOTE="Yksok, post: 21793620, member: 44323"]')
    expect(once.match(/A test, don't mind me\.\.\./g)).toEqual(["A test, don't mind me..."])
    expect(twice.match(/A test, don't mind me\.\.\./g)).toEqual(["A test, don't mind me..."])
    expect(twice).not.toMatch(/Yksok said:/)
    expect(twice).toContain('Another test')
  })

  it('keeps quote attribution in the title, not the body html', () => {
    const html = bbcodeToHtml(
      '[QUOTE="Yksok, post: 21793620, member: 44323"]\nA test, don\'t mind me...\n[/QUOTE]'
    )
    const title = html.match(/<div class="bbCodeBlock-title"[^>]*>[\s\S]*?<\/div>/i)?.[0] || ''
    const withoutTitle = html.replace(/<div class="bbCodeBlock-title"[^>]*>[\s\S]*?<\/div>/i, '')
    expect(title).toContain('Yksok said:')
    expect(withoutTitle).toContain("A test, don't mind me...")
    expect(withoutTitle).not.toContain('Yksok said:')
  })
})

describe('reactionIcon', () => {
  it('maps known reactions to icons', () => {
    expect(reactionIcon(1, 'Like')).toBe('👍')
    expect(reactionIcon(3, 'Haha')).toBe('😆')
    expect(reactionIcon(99, 'Heart')).toBe('❤️')
    expect(reactionIcon(99, 'Unknown')).toBe('⭐')
  })
})
