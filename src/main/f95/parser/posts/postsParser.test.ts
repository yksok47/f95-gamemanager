import { describe, expect, it } from 'vitest'
import { extractPostId } from '../../parse'
import { parsePostEditForm, parsePosts, parsePostsPageNav, postsPageFromDocument } from './postsParser'
import { defineParserTests } from '../test-harness'
import { load } from 'cheerio'

defineParserTests('posts', parsePosts)

const SAMPLE = `
<article class="message message-threadStarterPost message--post js-post" data-author="OP" data-content="post-1" id="js-post-1">
  <div class="message-attribution"><time datetime="2020-01-01T00:00:00+00:00">Jan 1</time></div>
  <div class="message-userDetails"><a class="username" data-user-id="10">OP</a></div>
  <article class="message-body"><div class="bbWrapper">First post body</div></article>
  <aside class="message-signature"><div class="bbWrapper">OP signature</div></aside>
</article>
<article class="message message--post js-post" data-author="teq" data-content="post-22" id="js-post-22">
  <span class="u-anchorTarget" id="post-22"></span>
  <div class="message-userDetails"><h4 class="message-name"><a class="username" data-user-id="245877">teq</a></h4></div>
  <header class="message-attribution">
    <div class="message-attribution-main">
      <a href="/threads/game.99/post-22"><time datetime="2018-09-17T19:55:29+0200">Sep 17, 2018</time></a>
    </div>
    <ul class="message-attribution-opposite">
      <li><a href="/threads/game.99/post-22">#2</a></li>
    </ul>
  </header>
  <div class="message-content">
    <article class="message-body js-selectToQuote">
      <div class="bbWrapper">Porn Addict? you are in the Right Place</div>
      <div class="js-selectToQuoteEnd">&nbsp;</div>
    </article>
    <aside class="message-signature"><div class="bbWrapper">Please ignore this signature</div></aside>
  </div>
  <div class="reactionsBar js-reactionsList is-active">
    <ul class="reactionSummary">
      <li><span class="reaction reaction--small" data-reaction-id="1"><img alt="Like" title="Like" /></span></li>
      <li><span class="reaction reaction--small" data-reaction-id="3"><img alt="Haha" title="Haha" /></span></li>
    </ul>
    <a class="reactionsBar-link" href="/posts/22/reactions"><bdi>Ann</bdi>, <bdi>Bob</bdi> and 198 others</a>
  </div>
  <footer class="message-footer">
    <a href="/posts/22/react?reaction_id=1" class="actionBar-action actionBar-action--reaction">Like</a>
    <a href="/threads/game.99/reply?quote=22" class="actionBar-action actionBar-action--mq">Quote</a>
    <a href="/threads/game.99/reply?quote=22" class="actionBar-action actionBar-action--reply" data-quote-href="/posts/22/quote">Reply</a>
  </footer>
</article>
<nav class="pageNav">
  <li class="pageNav-page pageNav-page--current"><a href="/threads/game.99/">1</a></li>
  <li class="pageNav-page"><a href="/threads/game.99/page-12">12</a></li>
</nav>
<form action="/threads/game.99/add-reply" class="js-quickReply"></form>
`

describe('posts unit', () => {
  it('skips the starter post and signature, keeping reactions', () => {
    const posts = parsePosts(SAMPLE)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.postId).toBe(22)
    expect(posts[0]?.author).toBe('teq')
    expect(posts[0]?.authorId).toBe(245877)
    expect(posts[0]?.position).toBe(2)
    expect(posts[0]?.html).toContain('Porn Addict')
    expect(posts[0]?.html).not.toContain('signature')
    expect(posts[0]?.html).not.toContain('First post body')
    expect(posts[0]?.reactionCount).toBe(200)
    expect(posts[0]?.reactions).toEqual([
      { id: 1, title: 'Like' },
      { id: 3, title: 'Haha' }
    ])
    expect(posts[0]?.canLike).toBe(true)
    expect(posts[0]?.canQuote).toBe(true)
    expect(posts[0]?.canReply).toBe(true)
    expect(posts[0]?.canEdit).toBe(false)
    expect(posts[0]?.canDelete).toBe(false)
    expect(posts[0]?.liked).toBe(false)
    expect(posts[0]?.attachments).toEqual([])
  })

  it('detects edit and delete actions on own posts', () => {
    const posts = parsePosts(`
<article class="message message--post js-post" data-content="post-44" id="js-post-44">
  <div class="message-userDetails"><a class="username" data-user-id="9">Ada</a></div>
  <header class="message-attribution"><time datetime="2024-05-01T12:30:00+0000">May 1</time></header>
  <article class="message-body"><div class="bbWrapper">Mine</div></article>
  <footer class="message-footer">
    <a href="/posts/44/edit" class="actionBar-action actionBar-action--edit" data-xf-click="quick-edit">Edit</a>
    <a href="/posts/44/delete" class="menu-linkRow">Delete</a>
  </footer>
</article>`)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.canEdit).toBe(true)
    expect(posts[0]?.canDelete).toBe(true)
  })

  it('reads the BBCode and attachment hash from an edit form', () => {
    expect(
      parsePostEditForm(`
<form action="/posts/44/edit" method="post">
  <textarea name="message">Hello [B]world[/B]</textarea>
  <input type="hidden" name="attachment_hash" value="0123456789abcdef0123456789abcdef" />
</form>`)
    ).toEqual({
      message: 'Hello [B]world[/B]',
      attachmentHash: '0123456789abcdef0123456789abcdef'
    })
    expect(parsePostEditForm('<p>no form</p>')).toBeNull()
  })

  it('reads BBCode from the XenForo rich editor hidden field', () => {
    expect(
      parsePostEditForm(`
<form action="/posts/44/edit" method="post" class="js-quickEditForm">
  <textarea name="message_html" class="input js-editor u-jsOnly" data-xf-init="editor" data-original-name="message"></textarea>
  <input type="hidden" value="Hello [B]world[/B]" data-bb-code="message" />
  <noscript>
    <textarea name="message" class="input"></textarea>
  </noscript>
  <input type="hidden" name="attachment_hash" value="99f58f84de758effcb80b0479f58e05c" />
  <input type="hidden" name="attachment_hash_combined" value="{&quot;type&quot;:&quot;post&quot;,&quot;hash&quot;:&quot;99f58f84de758effcb80b0479f58e05c&quot;}" />
</form>`)
    ).toEqual({
      message: 'Hello [B]world[/B]',
      attachmentHash: '99f58f84de758effcb80b0479f58e05c'
    })
  })

  it('reads BBCode when the noscript message box is omitted', () => {
    expect(
      parsePostEditForm(`
<form action="/posts/44/edit" method="post">
  <textarea name="message_html" class="js-editor" data-original-name="message"></textarea>
  <input type="hidden" value="[QUOTE]keep me[/QUOTE]" data-bb-code="message" />
</form>`)
    ).toEqual({
      message: '[QUOTE]keep me[/QUOTE]',
      attachmentHash: null
    })
  })

  it('reads page nav and whether posting is allowed', () => {
    expect(parsePostsPageNav(SAMPLE)).toEqual({ page: 1, totalPages: 12 })
    const page = postsPageFromDocument(load(SAMPLE), 99, 1)
    expect(page.canPost).toBe(true)
    expect(page.totalPages).toBe(12)
    expect(page.posts).toHaveLength(1)
  })

  it('strips XenForo click-to-expand chrome from quotes', () => {
    const posts = parsePosts(`
<article class="message message--post js-post" data-content="post-9" id="js-post-9">
  <div class="message-userDetails"><a class="username">Ada</a></div>
  <header class="message-attribution"><time datetime="2024-05-01T12:30:00+0000">May 1</time></header>
  <article class="message-body"><div class="bbWrapper">
    <blockquote class="bbCodeBlock bbCodeBlock--expandable bbCodeBlock--quote">
      <div class="bbCodeBlock-title"><a href="/goto/post?id=8">Bo said:</a></div>
      <div class="bbCodeBlock-content">
        <div class="bbCodeBlock-expandContent">Keep the quoted sentence.</div>
        <div class="bbCodeBlock-expandLink"><a>Click to expand...</a></div>
      </div>
    </blockquote>
    Reply after the quote.
  </div></article>
</article>`)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.html).toContain('Keep the quoted sentence.')
    expect(posts[0]?.html).toContain('bbCodeBlock-expandContent')
    expect(posts[0]?.html).not.toMatch(/click to expand/i)
    expect(posts[0]?.html).not.toContain('bbCodeBlock-expandLink')
  })

  it('keeps image and file attachments that sit outside the post body', () => {
    const posts = parsePosts(`
<article class="message message--post js-post" data-content="post-11" id="js-post-11">
  <div class="message-userDetails"><a class="username">Ada</a></div>
  <header class="message-attribution"><time datetime="2019-02-02T10:24:00+0000">Feb 2</time></header>
  <article class="message-body"><div class="bbWrapper">See difference here:</div></article>
  <section class="message-attachments">
    <h4 class="block-textHeader">Attachments</h4>
    <ul class="attachmentList">
      <li class="attachment hasEngine">
        <div class="attachment-icon attachment-icon--img">
          <a href="https://attachments.f95zone.to/2019/02/250867_MP.png" class="js-lbImage">
            <img src="https://attachments.f95zone.to/2019/02/thumb/250867_MP.png" alt="MP.png" />
          </a>
        </div>
        <div class="attachment-name">
          <a href="https://attachments.f95zone.to/2019/02/250867_MP.png" title="MP.png">MP.png</a>
        </div>
      </li>
      <li class="attachment hasEngine">
        <div class="attachment-icon" data-extension="torrent">
          <a href="https://attachments.f95zone.to/2023/04/2539531_notes.torrent"></a>
        </div>
        <div class="attachment-name">
          <a href="https://attachments.f95zone.to/2023/04/2539531_notes.torrent" title="notes.torrent">notes.torrent</a>
        </div>
      </li>
    </ul>
  </section>
</article>`)
    expect(posts).toHaveLength(1)
    expect(posts[0]?.html).toContain('See difference here')
    expect(posts[0]?.html).not.toContain('Attachments')
    expect(posts[0]?.attachments).toEqual([
      {
        id: 250867,
        filename: 'MP.png',
        url: 'https://attachments.f95zone.to/2019/02/250867_MP.png',
        isImage: true
      },
      {
        id: 2539531,
        filename: 'notes.torrent',
        url: 'https://attachments.f95zone.to/2023/04/2539531_notes.torrent',
        isImage: false
      }
    ])
  })
})

describe('extractPostId', () => {
  it('reads post ids from urls', () => {
    expect(extractPostId('https://f95zone.to/posts/1106178/')).toBe(1106178)
    expect(extractPostId('https://f95zone.to/threads/game.18207/post-1106178')).toBe(1106178)
    expect(extractPostId('https://f95zone.to/threads/game.18207/#post-1106178')).toBe(1106178)
    expect(extractPostId('https://f95zone.to/threads/18207/')).toBeNull()
  })
})
