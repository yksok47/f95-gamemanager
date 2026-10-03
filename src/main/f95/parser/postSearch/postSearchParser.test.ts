import { describe, expect, it } from 'vitest'
import { extractSearchId, parsePostSearch, searchResultsPath } from './postSearchParser'
import { defineParserTests } from '../test-harness'

defineParserTests('postSearch', parsePostSearch)

const SAMPLE = `
<html>
<head>
  <link rel="canonical" href="https://f95zone.to/search/555001/">
</head>
<body>
<form action="/search/search">
  <input type="search" name="keywords" value="bug" />
  <input type="hidden" name="c[thread]" value="99" />
</form>
<div class="p-body-pageContent">
<ol class="block-body">
  <li class="block-row block-row--separated">
    <div class="contentRow">
      <div class="contentRow-main">
        <h3 class="contentRow-title">
          <a href="/threads/game.99/post-22">Game Title</a>
        </h3>
        <div class="contentRow-snippet">Found a <em>bug</em> in the shop.</div>
        <div class="contentRow-minor">
          <ul class="listInline listInline--bullet">
            <li><a class="username">teq</a></li>
            <li><time datetime="2018-09-17T19:55:29+0200">Sep 17, 2018</time></li>
          </ul>
        </div>
      </div>
    </div>
  </li>
  <li class="block-row block-row--separated">
    <div class="contentRow">
      <div class="contentRow-main">
        <h3 class="contentRow-title">
          <a href="/posts/88/">Game Title</a>
        </h3>
        <div class="contentRow-snippet">Another <span class="textHighlight">bug</span> report.</div>
        <div class="contentRow-minor">
          <a class="username">Ada</a>
          <time datetime="2024-05-01T12:30:00+0000">May 1</time>
        </div>
      </div>
    </div>
  </li>
  <li class="block-row block-row--separated">
    <div class="contentRow">
      <div class="contentRow-main">
        <h3 class="contentRow-title">
          <a href="/threads/game.99/">Thread-only result</a>
        </h3>
        <div class="contentRow-snippet">Should be skipped because there is no post id.</div>
      </div>
    </div>
  </li>
  <li class="block-row block-row--separated">
    <div class="contentRow">
      <div class="contentRow-main">
        <h3 class="contentRow-title">
          <a href="/threads/other.100/post-9">Wrong thread</a>
        </h3>
        <div class="contentRow-snippet">From another thread.</div>
      </div>
    </div>
  </li>
</ol>
<nav class="pageNav">
  <li class="pageNav-page pageNav-page--current"><a href="/search/555001/">1</a></li>
  <li class="pageNav-page"><a href="/search/555001/?page=3">3</a></li>
</nav>
</div>
</body>
</html>
`

describe('postSearch unit', () => {
  it('keeps post hits, snippets, and page chrome', () => {
    const page = parsePostSearch(SAMPLE, 99)
    expect(page.threadId).toBe(99)
    expect(page.query).toBe('bug')
    expect(page.searchId).toBe(555001)
    expect(page.page).toBe(1)
    expect(page.totalPages).toBe(3)
    expect(page.results).toHaveLength(2)
    expect(page.results[0]).toMatchObject({
      postId: 22,
      author: 'teq',
      date: '2018-09-17T19:55:29+0200',
      url: 'https://f95zone.to/threads/game.99/post-22'
    })
    expect(page.results[0]?.snippetHtml).toContain('bug')
    expect(page.results[0]?.snippetHtml).toContain('<em>')
    expect(page.results[1]).toMatchObject({
      postId: 88,
      author: 'Ada'
    })
    expect(page.results[1]?.snippetHtml).toContain('textHighlight')
  })

  it('returns an empty page when nothing matches', () => {
    const page = parsePostSearch('<div class="blockMessage">No results found.</div>', 12)
    expect(page).toEqual({
      threadId: 12,
      query: '',
      page: 1,
      totalPages: 1,
      searchId: null,
      results: []
    })
  })
})

describe('extractSearchId', () => {
  it('reads the XenForo search record from result urls', () => {
    expect(extractSearchId('https://f95zone.to/search/555001/')).toBe(555001)
    expect(extractSearchId('https://f95zone.to/search/555001/?page=2')).toBe(555001)
    expect(extractSearchId('https://f95zone.to/search/555001/page-2')).toBe(555001)
    expect(extractSearchId('https://f95zone.to/search/?type=post')).toBeNull()
  })
})

describe('searchResultsPath', () => {
  it('uses query-string pages because /search/{id}/page-N 404s on F95zone', () => {
    expect(searchResultsPath(555001)).toBe('/search/555001/')
    expect(searchResultsPath(555001, 1)).toBe('/search/555001/')
    expect(searchResultsPath(555001, 2)).toBe('/search/555001/?page=2')
  })
})
