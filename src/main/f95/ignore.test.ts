import { describe, expect, test } from 'bun:test'
import {
  isThreadIgnoreHref,
  nextIgnoredPageHref,
  parseConfirmationForm,
  parseThreadIgnoreAction,
  scrapeIgnoredThreads
} from './ignore-parse'

const THREAD_IGNORE_HTML = `
<div class="block-outer-opposite">
  <div class="buttonGroup">
    <a href="/tic-ignore/ignore?content_type=thread&amp;content_id=18207" class="tic--button button button--link"
       data-xf-click="overlay">Ignore thread</a>
  </div>
</div>
<div class="structItem-minor">
  <a href="/tic-ignore/ignore?content_type=thread&amp;content_id=25332" class="tic--button button--ignoreText"
     data-xf-click="overlay">Ignore</a>
</div>
`

const THREAD_UNIGNORE_HTML = `
<div class="block-outer-opposite">
  <a href="/tic-ignore/unignore?content_type=thread&amp;content_id=18207" class="tic--button button button--link"
     data-xf-click="overlay">Unignore thread</a>
</div>
`

const CONFIRM_HTML = `
<form action="/search/" method="post">
  <input type="hidden" name="_xfToken" value="search-token" />
</form>
<form action="/tic-ignore/ignore" method="post" class="block">
  <input type="hidden" name="_xfToken" value="confirm-token" />
  <input type="hidden" name="content_type" value="thread" />
  <input type="hidden" name="content_id" value="18207" />
  <input type="hidden" name="_xfRedirect" value="/threads/18207/" />
  <button type="submit" class="button--primary">Confirm</button>
</form>
`

const OVERLAY_JSON = JSON.stringify({
  status: 'ok',
  html: {
    content: `<form action="/tic-ignore/unignore" method="post">
      <input type="hidden" name="_xfToken" value="json-token" />
      <input type="hidden" name="content_type" value="thread" />
      <input type="hidden" name="content_id" value="18207" />
      <input type="hidden" name="_xfConfirm" value="1" />
    </form>`
  }
})

const IGNORED_LIST_HTML = `
<div class="p-body-pageContent">
  <ol class="listPlain">
    <li class="block-row">
      <div class="contentRow">
        <div class="contentRow-main">
          <h3 class="contentRow-title">
            <a href="/threads/some-game.12345/">Some Game [v1.2] [Author]</a>
          </h3>
          <div class="contentRow-extra">
            <a href="/tic-ignore/unignore?content_type=thread&amp;content_id=12345">Unignore</a>
          </div>
        </div>
      </div>
    </li>
    <li class="block-row">
      <div class="contentRow">
        <h3 class="contentRow-title">
          <a href="/threads/another-title.67890/">Another Title</a>
        </h3>
      </div>
    </li>
  </ol>
</div>
`

describe('thread ignore parsing', () => {
  test('reads the thread toolbar ignore button, not similar threads', () => {
    expect(parseThreadIgnoreAction(THREAD_IGNORE_HTML, 18207)).toEqual({
      ignored: false,
      href: '/tic-ignore/ignore?content_type=thread&content_id=18207'
    })
  })

  test('detects an unignore button', () => {
    expect(parseThreadIgnoreAction(THREAD_UNIGNORE_HTML, 18207)).toEqual({
      ignored: true,
      href: '/tic-ignore/unignore?content_type=thread&content_id=18207'
    })
  })

  test('validates tic-ignore hrefs for a thread', () => {
    expect(
      isThreadIgnoreHref('/tic-ignore/ignore?content_type=thread&content_id=18207', 18207)
    ).toBe(true)
    expect(
      isThreadIgnoreHref('/tic-ignore/unignore?content_type=thread&content_id=9', 18207)
    ).toBe(false)
    expect(isThreadIgnoreHref('/threads/18207/watch', 18207)).toBe(false)
  })
})

describe('ignore confirmation form', () => {
  test('posts the tic-ignore form instead of search/logout', () => {
    const form = parseConfirmationForm(CONFIRM_HTML, 'https://f95zone.to/tic-ignore/ignore')
    expect(form?.action).toBe('https://f95zone.to/tic-ignore/ignore')
    expect(form?.method).toBe('post')
    expect(form?.fields.get('_xfToken')).toBe('confirm-token')
    expect(form?.fields.get('content_id')).toBe('18207')
    expect(form?.fields.get('_xfConfirm')).toBe('1')
  })

  test('reads overlay JSON confirmation html', () => {
    const form = parseConfirmationForm(OVERLAY_JSON, 'https://f95zone.to/tic-ignore/unignore')
    expect(form?.action).toBe('https://f95zone.to/tic-ignore/unignore')
    expect(form?.fields.get('_xfToken')).toBe('json-token')
    expect(form?.fields.get('content_id')).toBe('18207')
  })
})

describe('ignored thread list', () => {
  test('scrapes titles and unignore links from the account page', () => {
    expect(scrapeIgnoredThreads(IGNORED_LIST_HTML)).toEqual([
      {
        threadId: 12345,
        title: 'Some Game',
        threadUrl: 'https://f95zone.to/threads/12345/',
        unignoreHref: '/tic-ignore/unignore?content_type=thread&content_id=12345'
      },
      {
        threadId: 67890,
        title: 'Another Title',
        threadUrl: 'https://f95zone.to/threads/67890/',
        unignoreHref: null
      }
    ])
  })

  test('follows the ignored-list next-page link', () => {
    const html = `
      <nav class="pageNavWrapper">
        <a href="/account/ignored?key=thread&page=2" class="pageNav-jump pageNav-jump--next">Next</a>
      </nav>
    `
    expect(nextIgnoredPageHref(html, 'https://f95zone.to/account/ignored?key=thread')).toBe(
      'https://f95zone.to/account/ignored?key=thread&page=2'
    )
  })
})
