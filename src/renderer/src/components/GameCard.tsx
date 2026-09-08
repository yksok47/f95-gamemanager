import { useEffect, useMemo, useRef, useState, type JSX, type MouseEvent, type PointerEvent } from 'react'
import type { CatalogGame, CatalogPrefix, FavoriteTag, GameRarity, Subscription } from '@shared/types'
import { engineFromTitle, normalizeEngine } from '@shared/engines'
import { engineFromPrefixIds } from '@shared/prefixes'
import { formatUpdateDate, gameUpdateState } from '@shared/updates'
import EngineBadge from './EngineBadge'
import { favoriteTagsOnGame } from '../lib/favorites'
import { saneLikeCount, saneViewCount } from '@shared/counts'
import { formatCount, formatRating, ratingClass } from '../lib/format'
import type { GameLibraryStatus } from '../lib/library'

type GameCardProps = {
  game: Pick<
    CatalogGame,
    | 'threadId'
    | 'title'
    | 'creator'
    | 'version'
    | 'coverUrl'
    | 'rating'
    | 'likes'
    | 'views'
    | 'prefixes'
    | 'screens'
    | 'timestamp'
  > & {
    updatedAt?: string
    source?: Subscription['source']
    rarity?: GameRarity
    tags?: number[]
    engine?: string
    lastPlayedVersion?: string
    lastPlayedAt?: number
    playtimeMs?: number
    checkedAt?: number
  }
  subscribed: boolean
  favoriteTags?: FavoriteTag[]
  onToggle: () => void
  onOpen?: () => void
  onPlay?: () => void
  library?: GameLibraryStatus
  playing?: boolean
  prefixCatalog?: CatalogPrefix[]
}

function cardEngine(
  game: GameCardProps['game'],
  library: GameLibraryStatus | undefined,
  prefixCatalog: CatalogPrefix[] | undefined
): string {
  return (
    normalizeEngine(game.engine) ||
    engineFromPrefixIds(game.prefixes, prefixCatalog) ||
    engineFromTitle(game.title) ||
    normalizeEngine(library?.engine || '') ||
    ''
  )
}

export default function GameCard({
  game,
  subscribed,
  favoriteTags = [],
  onToggle,
  onOpen,
  onPlay,
  library,
  playing = false,
  prefixCatalog
}: GameCardProps): JSX.Element {
  const [broken, setBroken] = useState(!game.coverUrl)
  const [previewIndex, setPreviewIndex] = useState<number | null>(null)
  const coverRef = useRef<HTMLDivElement>(null)
  const previewing = useRef(false)
  const rarity = game.rarity ?? 'regular'
  const shownTags = favoriteTagsOnGame(game.tags, favoriteTags)
  const engine = cardEngine(game, library, prefixCatalog)
  const likes = saneLikeCount(game.likes)
  const views = saneViewCount(game.views)
  const previews = useMemo(() => {
    const seen = new Set<string>()
    const urls: string[] = []
    for (const url of game.screens ?? []) {
      if (!url || url === game.coverUrl || seen.has(url)) continue
      seen.add(url)
      urls.push(url)
    }
    return urls
  }, [game.screens, game.coverUrl])
  const updates = gameUpdateState({
    latestVersion: game.version,
    installedVersion: library?.installedVersion,
    lastPlayedVersion: game.lastPlayedVersion
  })

  useEffect(() => {
    setBroken(!game.coverUrl)
  }, [game.coverUrl])

  function previewFromX(clientX: number): number {
    const rect = coverRef.current?.getBoundingClientRect()
    if (!rect || !previews.length) return 0
    const t = (clientX - rect.left) / Math.max(rect.width, 1)
    return Math.min(previews.length - 1, Math.max(0, Math.floor(t * previews.length)))
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 2 || !previews.length) return
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    previewing.current = true
    setPreviewIndex(previewFromX(event.clientX))
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    if (!previewing.current || !previews.length) return
    event.preventDefault()
    setPreviewIndex(previewFromX(event.clientX))
  }

  function endPreview(event: PointerEvent<HTMLElement>): void {
    if (!previewing.current) return
    if (event.type === 'pointerup' && event.button !== 2 && (event.buttons & 2)) return
    previewing.current = false
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId)
    }
    setPreviewIndex(null)
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault()
  }

  const followLabel = subscribed ? 'Unfollow' : 'Follow'
  const cardClass = [
    rarity === 'regular' ? 'game-card' : `game-card game-card-${rarity}`,
    onOpen ? 'game-card-openable' : '',
    previewIndex != null ? 'is-previewing' : ''
  ]
    .filter(Boolean)
    .join(' ')
  const updatedLabel = formatUpdateDate(game.timestamp)

  function onCardClick(event: MouseEvent): void {
    if (!onOpen) return
    const target = event.target as HTMLElement
    if (target.closest('button, select, a, label, .library-badge')) return
    onOpen()
  }

  return (
    <article
      className={cardClass}
      onClick={onCardClick}
      onContextMenu={onContextMenu}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={endPreview}
      onPointerCancel={endPreview}
      onLostPointerCapture={endPreview}
    >
      <div className="cover-wrap" ref={coverRef}>
        {broken || !game.coverUrl ? (
          <div className="cover-fallback">No cover</div>
        ) : (
          <img
            src={game.coverUrl}
            alt=""
            draggable={false}
            referrerPolicy="no-referrer"
            onError={() => setBroken(true)}
          />
        )}
        {previewIndex != null && previews[previewIndex] ? (
          <div className="cover-preview">
            <img src={previews[previewIndex]} alt="" referrerPolicy="no-referrer" draggable={false} />
            {previews.length > 1 ? (
              <div className="cover-preview-dots" aria-hidden="true">
                {previews.map((url, index) => (
                  <span key={url} className={index === previewIndex ? 'is-active' : ''} />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        <EngineBadge name={engine} />
        {library?.isInstalled || library?.hasArchive ? (
          library.isInstalled && onPlay ? (
            <button
              className="library-badge library-badge-installed"
              type="button"
              disabled={playing}
              title={
                playing
                  ? 'Playing'
                  : library.installedVersion
                    ? `Play ${library.installedVersion}`
                    : 'Play'
              }
              onClick={(event) => {
                event.stopPropagation()
                onPlay()
              }}
            >
              {library.hasArchive ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M3.2 2.4h9.6v2.4H3.2zm0 3.2h9.6v8H3.2zm3.2 2v1.2h3.2V7.6z"
                  />
                </svg>
              ) : null}
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path fill="currentColor" d="M4.2 2.8v10.4L13.4 8z" />
              </svg>
              <span className="sr-only">{playing ? 'Playing' : 'Play'}</span>
            </button>
          ) : (
            <span
              className={library.isInstalled ? 'library-badge library-badge-installed' : 'library-badge'}
              title={
                library.isInstalled
                  ? library.installedVersion
                    ? `Installed ${library.installedVersion}`
                    : 'Installed'
                  : 'Archive downloaded'
              }
            >
              {library.hasArchive ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M3.2 2.4h9.6v2.4H3.2zm0 3.2h9.6v8H3.2zm3.2 2v1.2h3.2V7.6z"
                  />
                </svg>
              ) : null}
              {library.isInstalled ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path
                    fill="currentColor"
                    d="M6.4 11.6 3.2 8.4l1.2-1.2 2 2 5.2-5.2 1.2 1.2z"
                  />
                </svg>
              ) : null}
            </span>
          )
        ) : null}
        {game.version ? (
          <span className="cover-version" title={game.version}>
            {game.version}
          </span>
        ) : null}
        <button
          className={subscribed ? 'follow-btn follow-btn-on' : 'follow-btn'}
          type="button"
          aria-label={followLabel}
          title={followLabel}
          onClick={onToggle}
        >
          <span className="follow-icon" aria-hidden="true">
            {subscribed ? (
              <>
                <svg className="follow-icon-default" viewBox="0 0 16 16">
                  <path
                    fill="currentColor"
                    d="M6.4 11.6 3.2 8.4l1.2-1.2 2 2 5.2-5.2 1.2 1.2z"
                  />
                </svg>
                <svg className="follow-icon-hover" viewBox="0 0 16 16">
                  <path fill="currentColor" d="M3.2 7.2h9.6v1.6H3.2z" />
                </svg>
              </>
            ) : (
              <svg viewBox="0 0 16 16">
                <path fill="currentColor" d="M7.2 3.2h1.6v9.6H7.2zM3.2 7.2h9.6v1.6H3.2z" />
              </svg>
            )}
          </span>
          <span className="follow-label">{followLabel}</span>
        </button>
      </div>
      <div className="game-meta">
        <h2 className="game-title">{game.title}</h2>
        <span className="muted">{game.creator || 'Unknown creator'}</span>
        {updates.updateAvailable || updates.unplayedUpdate || playing ? (
          <div className="game-meta-row">
            {updates.updateAvailable ? (
              <span className="update-chip" title={`Installed ${library?.installedVersion}`}>
                Update
              </span>
            ) : null}
            {updates.unplayedUpdate ? (
              <span className="update-chip update-chip-play" title={`Last played ${game.lastPlayedVersion}`}>
                New since play
              </span>
            ) : null}
            {playing ? (
              <span className="update-chip update-chip-play" title="This game is running">
                Playing
              </span>
            ) : null}
          </div>
        ) : null}
        <div className="game-stats muted">
          <span className={ratingClass(game.rating)}>{formatRating(game.rating)}</span>
          {likes ? (
            <span className="game-stat" title={`${likes.toLocaleString()} likes`}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 13.6 6.7 12.4C3.4 9.4 1.6 7.8 1.6 5.8A3 3 0 0 1 4.8 2.8c1 0 2 .5 2.6 1.3C8.1 3.3 9 2.8 10.1 2.8a3 3 0 0 1 3.2 3c0 2-1.8 3.6-5.1 6.6z"
                />
              </svg>
              {formatCount(likes)}
            </span>
          ) : null}
          {views ? (
            <span className="game-stat" title={`${views.toLocaleString()} views`}>
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 3.2c3.2 0 5.9 2 7.2 4.8-1.3 2.8-4 4.8-7.2 4.8S2.1 10.8.8 8C2.1 5.2 4.8 3.2 8 3.2m0 2A2.8 2.8 0 1 0 10.8 8 2.8 2.8 0 0 0 8 5.2z"
                />
              </svg>
              {formatCount(views)}
            </span>
          ) : null}
          <span>
            {updatedLabel
              ? `Updated ${updatedLabel}`
              : game.source === 'bookmark'
                ? 'Bookmark'
                : game.source === 'watched'
                  ? 'Watched'
                  : ''}
          </span>
        </div>
        {shownTags.length ? (
          <div className="card-tags">
            {shownTags.map((tag) => (
              <span key={tag.id} className={`chip chip-${tag.tier}`}>
                {tag.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  )
}
