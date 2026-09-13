import { load, type CheerioAPI } from 'cheerio'

/** Extract the starter-post body HTML from a full thread page document. */
export function parseFirstPost(pageHtml: string): string {
  return parseFirstPostDocument(load(pageHtml))
}

/** Same extraction against an already-loaded Cheerio document (avoids re-parse). */
export function parseFirstPostDocument($: CheerioAPI): string {
  const starter = $('.message-threadStarterPost').first()
  const post = starter.length ? starter : $('.message--post').first()
  if (!post.length) return ''

  const wrapper = post.find('.message-body .bbWrapper').first()
  const body = wrapper.length ? wrapper : post.find('.message-body').first()
  if (!body.length) return ''

  return stripCommonIndent(body.html() ?? '')
}

function stripCommonIndent(html: string): string {
  const lines = html.replace(/\r\n/g, '\n').split('\n')
  const indents = lines
    .filter((line) => line.trim().length > 0)
    .map((line) => line.match(/^ */)?.[0].length ?? 0)
  const min = Math.min(...indents)
  if (!Number.isFinite(min) || min <= 0) return html.trim()
  return lines.map((line) => line.slice(min)).join('\n').trim()
}
