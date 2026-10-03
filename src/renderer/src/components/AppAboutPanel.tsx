import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent } from 'react'
import type { ThreadDetails, ThreadReview } from '@shared/types'
import { APP_THREAD_ID, appThreadUrl } from '@shared/app-thread'
import { notifyError } from './ErrorNotifications'
import ProgressiveCdnImg from './ProgressiveCdnImg'
import ReviewCard from './ReviewCard'
import ThreadGallery from './ThreadGallery'
import ThreadPostsPanel from './ThreadPostsPanel'
import { InlineLoading } from './Spinner'
import { PagerIcon, RefreshIcon } from './ToolbarIcons'
import { formatCount } from '../lib/format'
import { filterOverviewFields, formatThreadDate } from '../lib/thread-overview'
import { threadProseTarget } from '../lib/thread-prose'

type AppAboutTab = 'overview' | 'tips' | 'changelog' | 'images' | 'reviews' | 'posts'

type AppAboutPanelProps = {
  active: boolean
  onOpenThread: (threadId: number, title: string) => void
  onSessionExpired: () => Promise<void>
}

export default function AppAboutPanel({
  active,
  onOpenThread,
  onSessionExpired
}: AppAboutPanelProps): JSX.Element {
  const [details, setDetails] = useState<ThreadDetails | null>(null)
  const [busy, setBusy] = useState(true)
  const [reloadToken, setReloadToken] = useState(0)
  const [tab, setTab] = useState<AppAboutTab>('overview')
  const [tipIndex, setTipIndex] = useState(0)
  const [openVersions, setOpenVersions] = useState<Record<number, boolean>>({})
  const [postsReady, setPostsReady] = useState(false)
  const [postsJump, setPostsJump] = useState<{ postId: number; key: number } | null>(null)
  const [reviewPage, setReviewPage] = useState(1)
  const [reviewItems, setReviewItems] = useState<ThreadReview[]>([])
  const [reviewsTotalPages, setReviewsTotalPages] = useState(1)
  const [reviewsBusy, setReviewsBusy] = useState(false)
  const [reviewsError, setReviewsError] = useState<string | null>(null)
  const [reviewsReload, setReviewsReload] = useState(0)
  const cache = useRef<{ token: number; details: ThreadDetails } | null>(null)

  useEffect(() => {
    if (!active) return
    const cached = cache.current
    if (cached && cached.token === reloadToken) {
      setDetails(cached.details)
      setBusy(false)
      return
    }

    let cancelled = false

    async function load(): Promise<void> {
      setBusy(true)
      try {
        const next = await window.api.threads.details(APP_THREAD_ID)
        if (cancelled) return
        cache.current = { token: reloadToken, details: next }
        setDetails(next)
        setReviewPage(1)
        setReviewsReload(0)
        setOpenVersions({})
        setTipIndex(0)
      } catch (err) {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load this thread.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReloadToken((value) => value + 1)
        })
      } finally {
        if (!cancelled) setBusy(false)
      }
    }

    void load()
    return () => {
      cancelled = true
    }
  }, [active, reloadToken, onSessionExpired])

  useEffect(() => {
    if (tab === 'posts') setPostsReady(true)
  }, [tab])

  useEffect(() => {
    if (!details) return

    const detailsComplete = details.reviewsTotal <= details.reviews.length
    const useDetailsPayload =
      reviewPage <= 1 && reviewsReload === 0 && (detailsComplete || tab !== 'reviews')

    if (useDetailsPayload) {
      setReviewItems(details.reviews)
      setReviewsTotalPages(Math.max(1, details.reviewsTotalPages || 1))
      setReviewsError(null)
      setReviewsBusy(false)
      return
    }

    let cancelled = false
    setReviewsBusy(true)
    setReviewsError(null)

    void window.api.threads
      .reviews(APP_THREAD_ID, reviewPage)
      .then((next) => {
        if (cancelled) return
        setReviewItems(next.reviews)
        setReviewsTotalPages(Math.max(1, next.totalPages))
      })
      .catch(async (err: unknown) => {
        if (cancelled) return
        const message = err instanceof Error ? err.message : 'Could not load reviews.'
        if (message.includes('Not logged in')) {
          await onSessionExpired()
          return
        }
        setReviewsError(message)
        notifyError(message, {
          label: 'Retry',
          onClick: () => setReviewsReload((value) => value + 1)
        })
      })
      .finally(() => {
        if (!cancelled) setReviewsBusy(false)
      })

    return () => {
      cancelled = true
    }
  }, [details, reviewPage, reviewsReload, tab, onSessionExpired])

  const notes = details?.notes ?? []
  const changelog = details?.changelog ?? []
  const gallery = details?.gallery ?? []
  const overviewFields = useMemo(
    () => filterOverviewFields(details?.fields ?? []),
    [details]
  )
  const threadUrl = details?.threadUrl || appThreadUrl()
  const settled = !busy

  const tabs = useMemo(() => {
    const items: Array<{ id: AppAboutTab; label: string; hidden?: boolean }> = [
      { id: 'overview', label: 'Overview' },
      { id: 'tips', label: notes.length === 1 ? notes[0].title : 'Tips', hidden: settled && !notes.length },
      { id: 'changelog', label: 'Changelog', hidden: settled && !changelog.length },
      { id: 'images', label: 'Images', hidden: settled && !gallery.length },
      {
        id: 'reviews',
        label: 'Reviews',
        hidden: settled && !details?.reviews.length && !details?.reviewsTotal
      },
      { id: 'posts', label: 'Posts' }
    ]
    return items.filter((item) => !item.hidden)
  }, [settled, notes, changelog.length, gallery.length, details])

  useEffect(() => {
    if (!tabs.some((item) => item.id === tab)) setTab(tabs[0]?.id ?? 'overview')
  }, [tabs, tab])

  useEffect(() => {
    if (tipIndex >= notes.length) setTipIndex(0)
  }, [notes.length, tipIndex])

  function onProseClick(event: MouseEvent<HTMLElement>): void {
    const target = threadProseTarget(event, APP_THREAD_ID)
    if (!target) return
    if (target.kind === 'post') {
      setTab('posts')
      setPostsJump({ postId: target.postId, key: Date.now() })
      return
    }
    if (target.kind === 'thread') {
      if (target.threadId === APP_THREAD_ID) return
      onOpenThread(target.threadId, target.title)
      return
    }
    void window.api.shell.open(target.href, undefined, target.download ? { download: true } : undefined)
  }

  const currentNote = notes[tipIndex] ?? null

  return (
    <div className="settings-about">
      <div className="settings-about-toolbar">
        <div className="downloads-p2p-tabs" role="tablist" aria-label="About this app">
          {tabs.map((item) => (
            <button
              key={item.id}
              className={tab === item.id ? 'details-tab details-tab-active' : 'details-tab'}
              type="button"
              role="tab"
              aria-selected={tab === item.id}
              onMouseDown={(event) => event.preventDefault()}
              onClick={() => setTab(item.id)}
            >
              {item.label}
            </button>
          ))}
        </div>
        <button
          className="ghost-btn icon-btn"
          type="button"
          aria-label="Reload thread"
          disabled={busy}
          onClick={() => setReloadToken((value) => value + 1)}
        >
          <RefreshIcon spinning={busy} />
        </button>
      </div>

      {tab === 'overview' ? (
        <div className="overview-panel">
          <div className="settings-about-hero">
            {details?.coverUrl ? (
              <div className="settings-about-cover">
                <ProgressiveCdnImg src={details.coverUrl} />
              </div>
            ) : null}
            <div className="settings-about-identity">
              <div className="details-title-row">
                <h2 className="details-title">
                  <a
                    className="details-title-link"
                    href={threadUrl}
                    title="Open thread on F95zone"
                    onClick={(event) => {
                      event.preventDefault()
                      void window.api.shell.open(threadUrl)
                    }}
                  >
                    {details?.title || 'F95 Game Manager'}
                  </a>
                </h2>
                {details?.version ? <span className="details-pill">{details.version}</span> : null}
              </div>
              <div className="details-sub">
                <div className="details-sub-row">
                  <div className="details-creator">
                    <span>{details?.creator || (busy ? 'Loading…' : 'Unknown creator')}</span>
                    {(details?.creatorLinks ?? []).map((link) => (
                      <button
                        key={link.url}
                        className="link-chip"
                        type="button"
                        onClick={() => void window.api.shell.open(link.url)}
                      >
                        {link.label}
                      </button>
                    ))}
                  </div>
                </div>
                <div className="details-sub-row">
                  {details?.likes ? (
                    <span className="details-pill">{formatCount(details.likes)} likes</span>
                  ) : null}
                  {details?.views ? (
                    <span className="details-pill">{formatCount(details.views)} views</span>
                  ) : null}
                </div>
              </div>
            </div>
          </div>

          <div className="overview-dates">
            <div>
              <span className="muted">Updated</span>
              <strong>{formatThreadDate(details?.updatedAt || '') || (busy ? '…' : 'Unknown')}</strong>
            </div>
            <div>
              <span className="muted">Released</span>
              <strong>
                {formatThreadDate(details?.releaseDate || '') || details?.releaseDate || (busy ? '…' : 'Unknown')}
              </strong>
            </div>
          </div>

          {overviewFields.length ? (
            <dl className="details-fields">
              {overviewFields.map((field) => (
                <div key={field.label} className="details-field">
                  <dt>{field.label}</dt>
                  <dd>{field.value}</dd>
                </div>
              ))}
            </dl>
          ) : busy ? (
            <InlineLoading label="Reading the first post" />
          ) : (
            <p className="muted">No overview fields were found in the first post.</p>
          )}

          {details?.descriptionHtml ? (
            <div
              className="thread-prose"
              onClick={onProseClick}
              dangerouslySetInnerHTML={{ __html: details.descriptionHtml }}
            />
          ) : busy ? (
            <InlineLoading label="Loading description" />
          ) : null}
        </div>
      ) : null}

      {tab === 'tips' ? (
        <div className="about-tab">
          {notes.length > 1 ? (
            <div className="match-toggle" role="group" aria-label="Tips">
              {notes.map((section, index) => (
                <button
                  key={`${section.title}-${index}`}
                  type="button"
                  className={tipIndex === index ? 'is-active' : undefined}
                  onMouseDown={(event) => event.preventDefault()}
                  onClick={() => setTipIndex(index)}
                >
                  {section.title}
                </button>
              ))}
            </div>
          ) : null}
          {currentNote ? (
            <div className="notes-list">
              <section className="notes-section">
                <div
                  className="thread-prose"
                  onClick={onProseClick}
                  dangerouslySetInnerHTML={{ __html: currentNote.html }}
                />
              </section>
            </div>
          ) : busy ? (
            <InlineLoading label="Loading tips" />
          ) : (
            <p className="muted">No tips were found in the first post.</p>
          )}
        </div>
      ) : null}

      {tab === 'changelog' ? (
        changelog.length ? (
          <div className="changelog-list">
            {changelog.map((entry, index) => {
              const open = Boolean(openVersions[index])
              return (
                <section key={`${entry.version}-${index}`} className="changelog-entry">
                  <button
                    className="changelog-toggle"
                    type="button"
                    aria-expanded={open}
                    onClick={() => setOpenVersions((current) => ({ ...current, [index]: !open }))}
                  >
                    <span>{entry.version}</span>
                    <span className="muted">{open ? 'Hide' : 'Show'}</span>
                  </button>
                  {open ? (
                    entry.html ? (
                      <div
                        className="changelog-body thread-prose"
                        onClick={onProseClick}
                        dangerouslySetInnerHTML={{ __html: entry.html }}
                      />
                    ) : (
                      <div className="changelog-body" onClick={onProseClick}>
                        {entry.text}
                      </div>
                    )
                  ) : null}
                </section>
              )
            })}
          </div>
        ) : busy ? (
          <InlineLoading label="Loading changelog" />
        ) : (
          <p className="muted">No changelog was found.</p>
        )
      ) : null}

      {tab === 'images' ? (
        gallery.length ? (
          <ThreadGallery images={gallery} />
        ) : busy ? (
          <InlineLoading label="Loading images" />
        ) : (
          <p className="muted">No full-size screenshots were found.</p>
        )
      ) : null}

      {tab === 'reviews' ? (
        reviewItems.length || reviewsTotalPages > 1 || reviewsBusy || reviewsError ? (
          <div className="review-list">
            {reviewsError ? (
              <p className="muted">
                <button
                  className="ghost-btn"
                  type="button"
                  onClick={() => setReviewsReload((value) => value + 1)}
                >
                  Retry
                </button>
              </p>
            ) : reviewItems.length ? (
              reviewItems.map((review, index) => (
                <ReviewCard
                  key={`${review.author}-${reviewPage}-${index}`}
                  review={review}
                  date={formatThreadDate(review.date)}
                  onProseClick={onProseClick}
                />
              ))
            ) : reviewsBusy ? (
              <InlineLoading label="Loading reviews" />
            ) : (
              <p className="muted">No reviews on this page.</p>
            )}
            {reviewsTotalPages > 1 ? (
              <div className="pager review-pager">
                <button
                  className="ghost-btn icon-btn"
                  type="button"
                  disabled={reviewsBusy || reviewPage <= 1}
                  aria-label="Previous page"
                  onClick={() => setReviewPage((value) => Math.max(1, value - 1))}
                >
                  <PagerIcon kind="prev" />
                </button>
                <span className="muted pager-label">
                  {reviewPage}/{reviewsTotalPages}
                </span>
                <button
                  className="ghost-btn icon-btn"
                  type="button"
                  disabled={reviewsBusy || reviewPage >= reviewsTotalPages}
                  aria-label="Next page"
                  onClick={() => setReviewPage((value) => value + 1)}
                >
                  <PagerIcon kind="next" />
                </button>
              </div>
            ) : null}
          </div>
        ) : busy ? (
          <InlineLoading label="Loading reviews" />
        ) : (
          <p className="muted">No reviews were found for this thread.</p>
        )
      ) : null}

      {postsReady ? (
        <div hidden={tab !== 'posts'}>
          <ThreadPostsPanel
            threadId={APP_THREAD_ID}
            active={active && tab === 'posts'}
            jumpToPostId={postsJump?.postId}
            jumpKey={postsJump?.key}
            onProseClick={onProseClick}
            onSessionExpired={onSessionExpired}
          />
        </div>
      ) : null}
    </div>
  )
}
