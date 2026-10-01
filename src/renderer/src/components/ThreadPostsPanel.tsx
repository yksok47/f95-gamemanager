import { useEffect, useLayoutEffect, useRef, useState, type JSX, type MouseEvent } from 'react'
import { shouldAdvanceThreadRead, type ThreadPost, type ThreadPostSearchHit } from '@shared/types'
import { isRelativeDate } from '@shared/updates'
import { reactionIcon } from '../lib/reaction-icon'
import { isPageSearchHotkey, findVisibleDialogs, pickActiveDialog } from '../lib/page-search'
import { newAttachmentHash } from '../lib/bbcode'
import BbCodeComposer, { type BbCodeComposerHandle } from './BbCodeComposer'
import { confirm } from './ConfirmDialog'
import { notifyCaught, notifyError } from './ErrorNotifications'
import { DelayedMount, InlineLoading, Spinner } from './Spinner'
import { PagerIcon } from './ToolbarIcons'
import ToolbarSearch from './ToolbarSearch'

type ThreadPostsPanelProps = {
  threadId: number
  active: boolean
  jumpToPostId?: number
  jumpKey?: number
  onProseClick: (event: MouseEvent<HTMLDivElement>) => void
  onSessionExpired: () => Promise<void>
}

type PostsQuery = {
  page?: number
  postId?: number
  token: number
}

const QUOTE_COLLAPSE_PX = 180

function formatPostWhen(value: string): string {
  if (!value) return ''
  if (isRelativeDate(value)) return value
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return value
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function bindQuoteCollapse(root: HTMLElement): void {
  for (const block of root.querySelectorAll<HTMLElement>('.bbCodeBlock--expandable')) {
    const content =
      block.querySelector<HTMLElement>('.bbCodeBlock-expandContent') ??
      block.querySelector<HTMLElement>('.bbCodeBlock-content')
    if (!content) continue
    const overflowing = content.scrollHeight > QUOTE_COLLAPSE_PX + 12
    block.classList.toggle('is-collapsible', overflowing)
    let toggle = block.querySelector<HTMLButtonElement>(':scope > .bbCodeBlock-expandToggle')
    if (!overflowing) {
      toggle?.remove()
      block.classList.remove('is-expanded')
      continue
    }
    if (!toggle) {
      toggle = document.createElement('button')
      toggle.type = 'button'
      toggle.className = 'bbCodeBlock-expandToggle'
      block.appendChild(toggle)
    }
    const expanded = block.classList.contains('is-expanded')
    toggle.textContent = expanded ? 'Show less' : 'Show more'
    toggle.setAttribute('aria-expanded', expanded ? 'true' : 'false')
  }
}

export default function ThreadPostsPanel({
  threadId,
  active,
  jumpToPostId,
  jumpKey = 0,
  onProseClick,
  onSessionExpired
}: ThreadPostsPanelProps): JSX.Element {
  const [query, setQuery] = useState<PostsQuery | null>(null)
  const [posts, setPosts] = useState<ThreadPost[]>([])
  const [page, setPage] = useState(1)
  const [totalPages, setTotalPages] = useState(1)
  const [canPost, setCanPost] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [reload, setReload] = useState(0)
  const [draft, setDraft] = useState('')
  const [posting, setPosting] = useState(false)
  const [actionPostId, setActionPostId] = useState<number | null>(null)
  const [highlightId, setHighlightId] = useState<number | null>(null)
  const [attachHash, setAttachHash] = useState(() => newAttachmentHash())
  const [edit, setEdit] = useState<{ postId: number; draft: string; hash: string } | null>(null)
  const [savingEdit, setSavingEdit] = useState(false)
  const [viewerUserId, setViewerUserId] = useState<string | null>(null)
  const [searchOpen, setSearchOpen] = useState(false)
  const [searchInput, setSearchInput] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [searchResults, setSearchResults] = useState<ThreadPostSearchHit[]>([])
  const [searchPage, setSearchPage] = useState(1)
  const [searchTotalPages, setSearchTotalPages] = useState(1)
  const [searchId, setSearchId] = useState<number | null>(null)
  const [searchBusy, setSearchBusy] = useState(false)
  const [searchError, setSearchError] = useState<string | null>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const panelRef = useRef<HTMLDivElement>(null)
  const searchBarRef = useRef<HTMLDivElement>(null)
  const searchGen = useRef(0)
  const composerRef = useRef<BbCodeComposerHandle>(null)
  const restoringRef = useRef(false)
  const lastReadTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const pendingLastRead = useRef<{ threadId: number; postId: number; page: number } | null>(null)
  const highWaterRef = useRef<{ postId: number; page: number | null } | null>(null)
  const scrollListOnLoad = useRef(false)

  function flushLastRead(): void {
    if (lastReadTimer.current) {
      clearTimeout(lastReadTimer.current)
      lastReadTimer.current = null
    }
    const pending = pendingLastRead.current
    if (!pending) return
    pendingLastRead.current = null
    void window.api.threads
      .setLastRead(pending.threadId, pending.postId, pending.page)
      .then((saved) => {
        if (!saved?.postId) return
        const current = highWaterRef.current
        if (!current || shouldAdvanceThreadRead(saved, current)) {
          highWaterRef.current = { postId: saved.postId, page: saved.page }
        }
      })
      .catch(() => undefined)
  }

  function rememberLastRead(postId: number, page: number, immediate = false): void {
    if (!postId || page < 1) return
    const previous = highWaterRef.current
    if (previous && !shouldAdvanceThreadRead({ postId, page }, previous)) return
    highWaterRef.current = { postId, page }
    pendingLastRead.current = { threadId, postId, page }
    if (immediate) {
      flushLastRead()
      return
    }
    if (lastReadTimer.current) clearTimeout(lastReadTimer.current)
    lastReadTimer.current = setTimeout(() => {
      lastReadTimer.current = null
      flushLastRead()
    }, 400)
  }

  useEffect(() => {
    let cancelled = false
    void window.api.auth.getSession().then((session) => {
      if (!cancelled) setViewerUserId(session.userId)
    })
    return () => {
      cancelled = true
    }
  }, [])

  useEffect(() => {
    searchGen.current += 1
    highWaterRef.current = null
    pendingLastRead.current = null
    setQuery(null)
    setPosts([])
    setDraft('')
    setAttachHash(newAttachmentHash())
    setEdit(null)
    setSavingEdit(false)
    setPage(1)
    setHighlightId(null)
    setSearchOpen(false)
    setSearchInput('')
    setSearchQuery('')
    setSearchResults([])
    setSearchPage(1)
    setSearchTotalPages(1)
    setSearchId(null)
    setSearchError(null)
    setSearchBusy(false)
    let cancelled = false
    void window.api.threads.lastRead(threadId).then((saved) => {
      if (cancelled || !saved?.postId) return
      const current = highWaterRef.current
      if (!current || shouldAdvanceThreadRead(saved, current)) {
        highWaterRef.current = { postId: saved.postId, page: saved.page }
      }
    })
    return () => {
      cancelled = true
      flushLastRead()
    }
  }, [threadId])

  useEffect(() => {
    if (!jumpToPostId || jumpToPostId <= 0) return
    setQuery({ postId: jumpToPostId, token: jumpKey })
  }, [jumpToPostId, jumpKey])

  useEffect(() => {
    if (!active || query) return
    if (jumpToPostId && jumpToPostId > 0) return
    let cancelled = false

    void window.api.threads
      .lastRead(threadId)
      .then((saved) => {
        if (cancelled) return
        if (saved?.postId) {
          highWaterRef.current = { postId: saved.postId, page: saved.page }
          setQuery({
            postId: saved.postId,
            page: saved.page ?? undefined,
            token: 0
          })
          return
        }
        setQuery({ page: saved?.page || 1, token: 0 })
      })
      .catch(() => {
        if (!cancelled) setQuery({ page: 1, token: 0 })
      })

    return () => {
      cancelled = true
    }
  }, [active, threadId, query, jumpToPostId])

  useEffect(() => {
    if (!query) return
    let cancelled = false
    setBusy(true)
    setError(null)

    void window.api.threads
      .posts(threadId, {
        page: query.page,
        postId: query.postId
      })
      .then((next) => {
        if (cancelled) return
        setPosts(next.posts)
        setPage(next.page)
        setTotalPages(Math.max(1, next.totalPages))
        setCanPost(next.canPost)
        const found =
          query.postId && next.posts.some((post) => post.postId === query.postId)
            ? query.postId
            : null
        const focus = found || (query.postId ? null : next.focusPostId)
        if (focus) {
          restoringRef.current = true
          setHighlightId(focus)
        } else if (query.postId && query.page) {
          scrollListOnLoad.current = true
        }
      })
      .catch(async (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load posts.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        setError(message)
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReload((value) => value + 1)
        })
      })
      .finally(() => {
        if (!cancelled) setBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [threadId, query, reload, onSessionExpired])

  useEffect(() => {
    if (!highlightId || busy) return
    const node = listRef.current?.querySelector(`[data-post-id="${highlightId}"]`)
    if (node instanceof HTMLElement) node.scrollIntoView({ block: 'start' })
    const timer = window.setTimeout(() => {
      restoringRef.current = false
    }, 400)
    return () => window.clearTimeout(timer)
  }, [highlightId, busy, posts])

  useEffect(() => {
    if (busy || highlightId || !scrollListOnLoad.current) return
    scrollListOnLoad.current = false
    listRef.current?.scrollIntoView({ block: 'start' })
  }, [busy, posts, highlightId])

  useEffect(() => {
    if (!active || busy || !posts.length) return
    rememberLastRead(posts[0].postId, page, true)
  }, [active, busy, posts, page, threadId])

  useEffect(() => {
    if (!active || !posts.length) return
    const root = listRef.current?.closest('.details-modal')
    const observer = new IntersectionObserver(
      (entries) => {
        if (restoringRef.current) return
        const visible = entries
          .filter((entry) => entry.isIntersecting)
          .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)
        const id = Number(visible[0]?.target.getAttribute('data-post-id') || 0)
        if (!id) return
        rememberLastRead(id, page)
      },
      { root: root instanceof Element ? root : null, threshold: 0 }
    )
    const nodes = listRef.current?.querySelectorAll('[data-post-id]') ?? []
    for (const node of nodes) observer.observe(node)
    return () => {
      observer.disconnect()
      flushLastRead()
    }
  }, [active, posts, threadId, page])

  useEffect(() => {
    if (!active) setSearchOpen(false)
  }, [active])

  useEffect(() => {
    if (!searchOpen) return
    function onPointer(event: PointerEvent): void {
      const target = event.target as Node
      if (searchBarRef.current?.contains(target)) return
      setSearchOpen(false)
    }
    window.addEventListener('pointerdown', onPointer)
    return () => window.removeEventListener('pointerdown', onPointer)
  }, [searchOpen])

  useEffect(() => {
    if (!active) return
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape' && searchOpen) {
        event.preventDefault()
        event.stopPropagation()
        setSearchOpen(false)
        return
      }
      if (!isPageSearchHotkey(event)) return
      const root = panelRef.current
      if (!root) return
      const top = pickActiveDialog(findVisibleDialogs())
      if (top && !top.contains(root)) return
      setSearchOpen(true)
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [active, searchOpen])

  async function handleLoginError(err: unknown, fallback: string): Promise<boolean> {
    const message = err instanceof Error ? err.message : fallback
    if (message.includes('Not logged in')) {
      await onSessionExpired()
      return true
    }
    notifyCaught(err, fallback)
    return false
  }

  async function likePost(post: ThreadPost): Promise<void> {
    setActionPostId(post.postId)
    try {
      const next = await window.api.threads.likePost(threadId, post.postId)
      setPosts((items) =>
        items.map((item) => {
          if (item.postId !== post.postId) return item
          const liked = next.liked
          const reactionCount =
            next.reactionCount ??
            Math.max(0, item.reactionCount + (liked === item.liked ? 0 : liked ? 1 : -1))
          return { ...item, liked, reactionCount }
        })
      )
    } catch (err) {
      await handleLoginError(err, 'Could not like that post.')
    } finally {
      setActionPostId(null)
    }
  }

  async function quotePost(post: ThreadPost, reply: boolean): Promise<void> {
    setActionPostId(post.postId)
    try {
      const quote = await window.api.threads.quotePost(threadId, post.postId)
      setDraft((current) => {
        const next = current.trim() ? `${current.trim()}\n\n${quote}` : quote
        return `${next}\n\n`
      })
      composerRef.current?.focus()
      if (reply) composerRef.current?.el()?.closest('.thread-posts-composer')?.scrollIntoView({ block: 'nearest' })
    } catch (err) {
      await handleLoginError(err, 'Could not quote that post.')
    } finally {
      setActionPostId(null)
    }
  }

  function applyPage(next: { posts: ThreadPost[]; page: number; totalPages: number; canPost: boolean; focusPostId: number | null }): void {
    setPosts(next.posts)
    setPage(next.page)
    setTotalPages(Math.max(1, next.totalPages))
    setCanPost(next.canPost)
    if (next.focusPostId) {
      restoringRef.current = true
      setHighlightId(next.focusPostId)
    }
  }

  async function startEdit(post: ThreadPost): Promise<void> {
    setActionPostId(post.postId)
    try {
      const draft = await window.api.threads.editDraft(threadId, post.postId)
      setEdit({
        postId: post.postId,
        draft: draft.message,
        hash: draft.attachmentHash || newAttachmentHash()
      })
    } catch (err) {
      await handleLoginError(err, 'Could not load that post for editing.')
    } finally {
      setActionPostId(null)
    }
  }

  async function saveEdit(): Promise<void> {
    if (!edit || savingEdit) return
    const message = edit.draft.trim()
    if (!message) return
    setSavingEdit(true)
    try {
      const next = await window.api.threads.editPost(threadId, edit.postId, message, edit.hash)
      setEdit(null)
      applyPage({ ...next, focusPostId: edit.postId })
    } catch (err) {
      await handleLoginError(err, 'Could not save that edit.')
    } finally {
      setSavingEdit(false)
    }
  }

  async function removePost(post: ThreadPost): Promise<void> {
    const ok = await confirm({
      title: 'Delete post',
      message: 'Delete this post? This cannot be undone.',
      confirmLabel: 'Delete',
      danger: true
    })
    if (!ok) return
    setActionPostId(post.postId)
    try {
      if (edit?.postId === post.postId) setEdit(null)
      const next = await window.api.threads.deletePost(threadId, post.postId, page)
      applyPage({ ...next, focusPostId: null })
      if (!next.posts.length && next.page > 1) {
        setHighlightId(null)
        request({ page: next.page - 1 })
      }
    } catch (err) {
      await handleLoginError(err, 'Could not delete that post.')
    } finally {
      setActionPostId(null)
    }
  }

  async function submitPost(): Promise<void> {
    const message = draft.trim()
    if (!message || posting) return
    setPosting(true)
    try {
      const next = await window.api.threads.reply(threadId, message, attachHash)
      setDraft('')
      setAttachHash(newAttachmentHash())
      setPosts(next.posts)
      setPage(next.page)
      setTotalPages(Math.max(1, next.totalPages))
      setCanPost(next.canPost)
      if (next.focusPostId) {
        restoringRef.current = true
        setHighlightId(next.focusPostId)
        rememberLastRead(next.focusPostId, next.page, true)
      }
    } catch (err) {
      await handleLoginError(err, 'Could not post that reply.')
    } finally {
      setPosting(false)
    }
  }

  function request(next: Omit<PostsQuery, 'token'>): void {
    setEdit(null)
    setQuery({ ...next, token: Date.now() })
  }

  function goToPage(nextPage: number): void {
    setHighlightId(null)
    scrollListOnLoad.current = true
    request({ page: nextPage })
  }

  function goToSearchHit(postId: number): void {
    setSearchOpen(false)
    if (posts.some((post) => post.postId === postId)) {
      restoringRef.current = true
      setHighlightId(postId)
      return
    }
    request({ postId })
  }

  async function runSearch(nextPage = 1): Promise<void> {
    const needle = searchInput.trim()
    if (!needle) {
      setSearchOpen(true)
      return
    }
    const gen = ++searchGen.current
    setSearchOpen(true)
    setSearchBusy(true)
    setSearchError(null)
    try {
      const sameQuery = needle === searchQuery
      const next = await window.api.threads.searchPosts(threadId, needle, {
        page: nextPage,
        searchId: nextPage > 1 && sameQuery && searchId ? searchId : undefined
      })
      if (gen !== searchGen.current) return
      setSearchQuery(next.query)
      setSearchResults(next.results)
      setSearchPage(next.page)
      setSearchTotalPages(Math.max(1, next.totalPages))
      setSearchId(next.searchId)
    } catch (err: unknown) {
      if (gen !== searchGen.current) return
      const loggedOut = await handleLoginError(err, 'Could not search this thread.')
      if (!loggedOut) {
        const message = err instanceof Error ? err.message : 'Could not search this thread.'
        setSearchError(message)
      }
    } finally {
      if (gen === searchGen.current) setSearchBusy(false)
    }
  }

  const empty = !busy && !error && !posts.length

  function isOwnPost(post: ThreadPost): boolean {
    return Boolean(viewerUserId && post.authorId != null && String(post.authorId) === viewerUserId)
  }

  function renderPager(): JSX.Element | null {
    if (totalPages <= 1) return null
    return (
      <PostsPager
        page={page}
        totalPages={totalPages}
        busy={busy}
        onFirst={() => goToPage(1)}
        onPrev={() => goToPage(Math.max(1, page - 1))}
        onNext={() => goToPage(Math.min(totalPages, page + 1))}
        onLast={() => goToPage(totalPages)}
      />
    )
  }

  return (
    <div className="thread-posts" ref={panelRef}>
      <div className="thread-posts-search-bar" ref={searchBarRef}>
        <form
          className="thread-posts-search-form"
          onSubmit={(event) => {
            event.preventDefault()
            void runSearch(1)
          }}
          onFocusCapture={() => setSearchOpen(true)}
          onClick={() => setSearchOpen(true)}
        >
          <ToolbarSearch
            value={searchInput}
            onChange={setSearchInput}
            placeholder="Search this thread…"
          />
        </form>
        {searchOpen ? (
          <div
            className="thread-posts-search-window"
            role="region"
            aria-label="Post search results"
            data-escape-layer=""
          >
            <div className="thread-posts-search-results">
              {searchBusy ? <InlineLoading label="Searching posts" /> : null}
              {searchError ? <p className="muted">{searchError}</p> : null}
              {!searchBusy && !searchError && searchQuery && !searchResults.length ? (
                <p className="muted">No posts matched “{searchQuery}”.</p>
              ) : null}
              {!searchBusy && !searchError && !searchQuery && !searchResults.length ? (
                <p className="muted">Type a phrase and press Enter.</p>
              ) : null}
              {searchResults.map((hit) => (
                <button
                  key={hit.postId}
                  type="button"
                  className="thread-posts-search-hit"
                  onClick={() => goToSearchHit(hit.postId)}
                >
                  <span className="thread-posts-search-hit-meta">
                    <strong>{hit.author}</strong>
                    {hit.date ? <span className="muted">{formatPostWhen(hit.date)}</span> : null}
                  </span>
                  {hit.snippetHtml ? (
                    <span
                      className="thread-posts-search-snippet"
                      dangerouslySetInnerHTML={{ __html: hit.snippetHtml }}
                    />
                  ) : (
                    <span className="muted">No preview</span>
                  )}
                </button>
              ))}
            </div>
            {searchTotalPages > 1 ? (
              <PostsPager
                page={searchPage}
                totalPages={searchTotalPages}
                busy={searchBusy}
                onFirst={() => void runSearch(1)}
                onPrev={() => void runSearch(Math.max(1, searchPage - 1))}
                onNext={() => void runSearch(Math.min(searchTotalPages, searchPage + 1))}
                onLast={() => void runSearch(searchTotalPages)}
              />
            ) : null}
          </div>
        ) : null}
      </div>
      {totalPages > 1 ? <div className="thread-posts-toolbar">{renderPager()}</div> : null}

      {error ? (
        <p className="muted">
          <button className="ghost-btn" type="button" onClick={() => setReload((value) => value + 1)}>
            Retry
          </button>
        </p>
      ) : null}

      <div className="thread-post-list" ref={listRef}>
        {posts.map((post) => (
          <ThreadPostCard
            key={post.postId}
            post={{
              ...post,
              canEdit: post.canEdit || isOwnPost(post),
              canDelete: post.canDelete || isOwnPost(post)
            }}
            when={formatPostWhen(post.date)}
            highlight={highlightId === post.postId}
            busy={actionPostId === post.postId || (savingEdit && edit?.postId === post.postId)}
            threadId={threadId}
            edit={edit?.postId === post.postId ? edit : null}
            onProseClick={onProseClick}
            onLike={() => void likePost(post)}
            onQuote={() => void quotePost(post, false)}
            onReply={() => void quotePost(post, true)}
            onEdit={() => void startEdit(post)}
            onDelete={() => void removePost(post)}
            onEditChange={(draft) =>
              setEdit((current) => (current?.postId === post.postId ? { ...current, draft } : current))
            }
            onEditCancel={() => setEdit(null)}
            onEditSave={() => void saveEdit()}
          />
        ))}
        {busy && !posts.length ? <InlineLoading label="Loading posts" /> : null}
        {empty ? <p className="muted">No other posts in this thread yet.</p> : null}
      </div>

      {renderPager()}

      <div className="thread-posts-composer">
        <BbCodeComposer
          ref={composerRef}
          value={draft}
          disabled={!canPost || posting}
          placeholder={canPost ? 'Write a reply…' : 'Log in to F95zone to post in this thread.'}
          threadId={threadId}
          attachmentHash={attachHash}
          onChange={setDraft}
          onLinkClick={onProseClick}
        />
        <div className="thread-posts-composer-actions">
          {posting ? (
            <DelayedMount busy>
              <Spinner size="sm" label="Posting" />
            </DelayedMount>
          ) : null}
          <button
            className="primary-btn"
            type="button"
            disabled={!canPost || posting || !draft.trim()}
            onClick={() => void submitPost()}
          >
            Post
          </button>
        </div>
      </div>
    </div>
  )
}

type PostsPagerProps = {
  page: number
  totalPages: number
  busy: boolean
  onFirst: () => void
  onPrev: () => void
  onNext: () => void
  onLast: () => void
}

function PostsPager({
  page,
  totalPages,
  busy,
  onFirst,
  onPrev,
  onNext,
  onLast
}: PostsPagerProps): JSX.Element {
  return (
    <div className="pager review-pager thread-posts-pager">
      <button
        className="ghost-btn icon-btn"
        type="button"
        disabled={busy || page <= 1}
        title="First page"
        aria-label="First page"
        onClick={onFirst}
      >
        <PagerIcon kind="first" />
      </button>
      <button
        className="ghost-btn icon-btn"
        type="button"
        disabled={busy || page <= 1}
        title="Previous page"
        aria-label="Previous page"
        onClick={onPrev}
      >
        <PagerIcon kind="prev" />
      </button>
      <span className="muted pager-label">
        {page}/{totalPages}
      </span>
      <button
        className="ghost-btn icon-btn"
        type="button"
        disabled={busy || page >= totalPages}
        title="Next page"
        aria-label="Next page"
        onClick={onNext}
      >
        <PagerIcon kind="next" />
      </button>
      <button
        className="ghost-btn icon-btn"
        type="button"
        disabled={busy || page >= totalPages}
        title="Last page"
        aria-label="Last page"
        onClick={onLast}
      >
        <PagerIcon kind="last" />
      </button>
    </div>
  )
}

type ThreadPostCardProps = {
  post: ThreadPost
  when: string
  highlight: boolean
  busy: boolean
  threadId: number
  edit: { postId: number; draft: string; hash: string } | null
  onProseClick: (event: MouseEvent<HTMLDivElement>) => void
  onLike: () => void
  onQuote: () => void
  onReply: () => void
  onEdit: () => void
  onDelete: () => void
  onEditChange: (draft: string) => void
  onEditCancel: () => void
  onEditSave: () => void
}

function ThreadPostCard({
  post,
  when,
  highlight,
  busy,
  threadId,
  edit,
  onProseClick,
  onLike,
  onQuote,
  onReply,
  onEdit,
  onDelete,
  onEditChange,
  onEditCancel,
  onEditSave
}: ThreadPostCardProps): JSX.Element {
  const proseRef = useRef<HTMLDivElement>(null)

  useLayoutEffect(() => {
    const root = proseRef.current
    if (!root) return
    const refresh = (): void => bindQuoteCollapse(root)
    refresh()
    const images = [...root.querySelectorAll('img')]
    for (const img of images) {
      if (!img.complete) img.addEventListener('load', refresh)
    }
    const observer = new ResizeObserver(refresh)
    observer.observe(root)
    return () => {
      for (const img of images) img.removeEventListener('load', refresh)
      observer.disconnect()
    }
  }, [post.html])

  return (
    <article
      className={highlight ? 'thread-post is-highlight' : 'thread-post'}
      data-post-id={post.postId}
      id={`thread-post-${post.postId}`}
    >
      <header className="thread-post-head">
        <div className="thread-post-head-main">
          <strong>{post.author}</strong>
          {when ? <span className="muted">{when}</span> : null}
        </div>
        {post.position ? <span className="muted thread-post-num">#{post.position}</span> : null}
      </header>
      {edit ? (
        <div className="thread-post-editor">
          <BbCodeComposer
            value={edit.draft}
            disabled={busy}
            placeholder="Edit this post…"
            threadId={threadId}
            postId={post.postId}
            attachmentHash={edit.hash}
            ariaLabel="Edit this post"
            onChange={onEditChange}
            onLinkClick={onProseClick}
          />
          <div className="thread-posts-composer-actions">
            {busy ? (
              <DelayedMount busy>
                <Spinner size="sm" label="Saving" />
              </DelayedMount>
            ) : null}
            <button className="ghost-btn" type="button" disabled={busy} onClick={onEditCancel}>
              Cancel
            </button>
            <button
              className="primary-btn"
              type="button"
              disabled={busy || !edit.draft.trim()}
              onClick={onEditSave}
            >
              Save
            </button>
          </div>
        </div>
      ) : post.html ? (
        <div
          ref={proseRef}
          className="review-prose thread-prose"
          onClick={onProseClick}
          dangerouslySetInnerHTML={{ __html: post.html }}
        />
      ) : (
        <p className="muted">This post has no content.</p>
      )}
      {edit ? null : (
      <footer className="thread-post-foot">
        {post.reactions.length || post.reactionCount ? (
          <div className="thread-post-reactions" aria-label="Reactions">
            {post.reactions.map((reaction) => (
              <span
                key={reaction.id}
                className="thread-post-reaction"
                title={reaction.title}
                aria-label={reaction.title}
              >
                {reactionIcon(reaction.id, reaction.title)}
              </span>
            ))}
            {post.reactionCount ? (
              <span className="muted">{post.reactionCount.toLocaleString()}</span>
            ) : null}
          </div>
        ) : (
          <span />
        )}
        <div className="thread-post-actions">
          {post.canLike ? (
            <button
              className="ghost-btn"
              type="button"
              disabled={busy}
              aria-pressed={post.liked}
              onClick={onLike}
            >
              {post.liked ? 'Liked' : 'Like'}
            </button>
          ) : null}
          {post.canQuote ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={onQuote}>
              Quote
            </button>
          ) : null}
          {post.canReply ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={onReply}>
              Reply
            </button>
          ) : null}
          {post.canEdit ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={onEdit}>
              Edit
            </button>
          ) : null}
          {post.canDelete ? (
            <button className="ghost-btn" type="button" disabled={busy} onClick={onDelete}>
              Delete
            </button>
          ) : null}
        </div>
      </footer>
      )}
    </article>
  )
}
