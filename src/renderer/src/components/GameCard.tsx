import {
  memo,
  useEffect,
  useMemo,
  useRef,
  useState,
  type JSX,
  type MouseEvent,
  type PointerEvent,
} from "react";
import type {
  CatalogGame,
  CatalogPrefix,
  FavoriteTag,
  GameRarity,
  HatedTag,
  Subscription,
  VersionPlayStat,
} from "@shared/types";
import { engineFromTitle, normalizeEngine } from "@shared/engines";
import { engineFromPrefixIds, gameStatusFlags } from "@shared/prefixes";
import {
  catalogTimestamp,
  formatDateTime,
  formatRelativeTime,
  gameUpdateState,
} from "@shared/updates";
import EngineBadge from "./EngineBadge";
import FollowButton from "./FollowButton";
import { favoriteTagsOnGame, hatedTagsOnGame } from "../lib/favorites";
import { useGameDownloadProgress } from "../lib/download-progress";
import {
  enqueueLowPriorityScreens,
  trackCoverEnd,
  trackCoverStart,
} from "../lib/image-priority";
import { saneLikeCount, saneViewCount } from "@shared/counts";
import { formatCount, formatRating, ratingClass } from "../lib/format";
import type { GameLibraryStatus } from "../lib/library";

type GameCardProps = {
  game: Pick<
    CatalogGame,
    | "threadId"
    | "title"
    | "creator"
    | "version"
    | "coverUrl"
    | "rating"
    | "likes"
    | "views"
    | "prefixes"
    | "screens"
    | "timestamp"
  > & {
    updatedAt?: string;
    source?: Subscription["source"];
    rarity?: GameRarity;
    tags?: number[];
    engine?: string;
    lastPlayedVersion?: string;
    lastPlayedAt?: number;
    playtimeMs?: number;
    playedVersions?: VersionPlayStat[];
    checkedAt?: number;
  };
  subscribed: boolean;
  favoriteTags?: FavoriteTag[];
  hatedTags?: HatedTag[];
  onToggle: () => void;
  onOpen?: () => void;
  onPlay?: () => void | Promise<void>;
  onStop?: () => void | Promise<void>;
  library?: GameLibraryStatus;
  playing?: boolean;
  prefixCatalog?: CatalogPrefix[];
  /** Bump on page/reload so failed covers retry even when coverUrl is unchanged. */
  coverRetryKey?: string | number;
  /** Force cover fetch so incoming page-turn cards are painted before they slide in. */
  coverEager?: boolean;
  onMarkPlayed?: () => void | Promise<void>;
  onIgnoreUpdate?: () => void | Promise<void>;
  inRoster?: boolean;
  onToggleRoster?: () => void | Promise<void>;
};

function cardEngine(
  game: GameCardProps["game"],
  library: GameLibraryStatus | undefined,
  prefixCatalog: CatalogPrefix[] | undefined,
): string {
  return (
    normalizeEngine(game.engine) ||
    engineFromPrefixIds(game.prefixes, prefixCatalog) ||
    engineFromTitle(game.title) ||
    normalizeEngine(library?.engine || "") ||
    ""
  );
}

function GameCard({
  game,
  subscribed,
  favoriteTags = [],
  hatedTags = [],
  onToggle,
  onOpen,
  onPlay,
  onStop,
  library,
  playing = false,
  prefixCatalog,
  coverRetryKey,
  coverEager = false,
  onMarkPlayed,
  onIgnoreUpdate,
  inRoster = false,
  onToggleRoster,
}: GameCardProps): JSX.Element {
  const [broken, setBroken] = useState(!game.coverUrl);
  const [loadNonce, setLoadNonce] = useState(0);
  const [updateAction, setUpdateAction] = useState<
    "played" | "ignore" | "roster" | null
  >(null);
  const [previewIndex, setPreviewIndex] = useState<number | null>(null);
  const [starting, setStarting] = useState(false);
  const coverRef = useRef<HTMLDivElement>(null);
  const previewing = useRef(false);
  const coverRetrySeen = useRef(false);
  const coverErrorTries = useRef(0);
  const rarity = game.rarity ?? "regular";
  const shownFavorites = favoriteTagsOnGame(game.tags, favoriteTags);
  const shownHated = hatedTagsOnGame(game.tags, hatedTags);
  const download = useGameDownloadProgress(game.threadId);
  const coverProgress =
    library?.installPercent != null
      ? { percent: library.installPercent, action: "Installing" as const }
      : download
        ? { percent: download.percent, action: "Downloading" as const }
        : null;
  const engine = cardEngine(game, library, prefixCatalog);
  const likes = saneLikeCount(game.likes);
  const views = saneViewCount(game.views);
  const previews = useMemo(() => {
    const seen = new Set<string>();
    const urls: string[] = [];
    for (const url of game.screens ?? []) {
      if (!url || url === game.coverUrl || seen.has(url)) continue;
      seen.add(url);
      urls.push(url);
    }
    return urls;
  }, [game.screens, game.coverUrl]);
  const updates = gameUpdateState({
    latestVersion: game.version,
    installedVersion: library?.installedVersion,
    lastPlayedVersion: game.lastPlayedVersion,
    playedVersions: game.playedVersions,
  });
  const status = gameStatusFlags(game.prefixes, prefixCatalog);

  useEffect(() => {
    coverErrorTries.current = 0;
    setBroken(!game.coverUrl);
  }, [game.coverUrl]);

  useEffect(() => {
    if (coverRetryKey === undefined) return;
    // Initial mount already loads the image; only retry when the key changes later
    // (catalog page turn / refresh) while this card instance is reused.
    if (!coverRetrySeen.current) {
      coverRetrySeen.current = true;
      return;
    }
    coverErrorTries.current = 0;
    setBroken(!game.coverUrl);
    setLoadNonce((n) => n + 1);
  }, [coverRetryKey, game.coverUrl]);

  useEffect(() => {
    if (playing) setStarting(false);
  }, [playing]);

  async function runUpdateAction(
    kind: "played" | "ignore" | "roster",
    action: (() => void | Promise<void>) | undefined,
  ): Promise<void> {
    if (!action || updateAction) return;
    setUpdateAction(kind);
    try {
      await Promise.resolve(action());
    } finally {
      setUpdateAction(null);
    }
  }

  const coverSrc =
    game.coverUrl && loadNonce > 0
      ? `${game.coverUrl}${game.coverUrl.includes("?") ? "&" : "?"}_gm_retry=${loadNonce}`
      : game.coverUrl;
  const showCover = Boolean(coverSrc && !broken);
  const releaseCoverTrack = useRef<(() => void) | null>(null);

  useEffect(() => {
    if (!showCover || !coverSrc) {
      releaseCoverTrack.current = null;
      return;
    }
    let open = true;
    trackCoverStart();
    const release = (): void => {
      if (!open) return;
      open = false;
      trackCoverEnd();
    };
    releaseCoverTrack.current = release;
    return () => {
      release();
      if (releaseCoverTrack.current === release)
        releaseCoverTrack.current = null;
    };
  }, [showCover, coverSrc]);

  function previewFromX(clientX: number): number {
    const rect = coverRef.current?.getBoundingClientRect();
    if (!rect || !previews.length) return 0;
    const t = (clientX - rect.left) / Math.max(rect.width, 1);
    return Math.min(
      previews.length - 1,
      Math.max(0, Math.floor(t * previews.length)),
    );
  }

  function onPointerDown(event: PointerEvent<HTMLElement>): void {
    if (event.button !== 2 || !previews.length) return;
    event.preventDefault();
    event.currentTarget.setPointerCapture(event.pointerId);
    previewing.current = true;
    setPreviewIndex(previewFromX(event.clientX));
  }

  function onPointerMove(event: PointerEvent<HTMLElement>): void {
    if (!previewing.current || !previews.length) return;
    event.preventDefault();
    setPreviewIndex(previewFromX(event.clientX));
  }

  function endPreview(event: PointerEvent<HTMLElement>): void {
    if (!previewing.current) return;
    if (event.type === "pointerup" && event.button !== 2 && event.buttons & 2)
      return;
    previewing.current = false;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) {
      event.currentTarget.releasePointerCapture(event.pointerId);
    }
    setPreviewIndex(null);
  }

  function onContextMenu(event: MouseEvent): void {
    event.preventDefault();
  }

  const cardClass = [
    rarity === "regular" ? "game-card" : `game-card game-card-${rarity}`,
    onOpen ? "game-card-openable" : "",
    previewIndex != null ? "is-previewing" : "",
  ]
    .filter(Boolean)
    .join(" ");
  const updatedAt = catalogTimestamp(game.timestamp);
  const updatedRelative = formatRelativeTime(updatedAt);
  const updatedExact = formatDateTime(updatedAt);

  function onCardClick(event: MouseEvent): void {
    if (!onOpen) return;
    const target = event.target as HTMLElement;
    if (
      target.closest(
        "button, select, a, label, .library-badge, .play-badge, .archive-badge, .cover-update-badge, .update-chip, .card-update-actions, .card-tile-action",
      )
    )
      return;
    onOpen();
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
            key={`cover-${loadNonce}`}
            src={coverSrc || undefined}
            alt=""
            loading={coverEager ? "eager" : "lazy"}
            fetchPriority="high"
            decoding="async"
            draggable={false}
            onLoad={() => {
              releaseCoverTrack.current?.();
              enqueueLowPriorityScreens(previews);
            }}
            onError={() => {
              releaseCoverTrack.current?.();
              if (coverErrorTries.current < 1) {
                coverErrorTries.current += 1;
                setLoadNonce((n) => n + 1);
                return;
              }
              setBroken(true);
            }}
          />
        )}
        {previewIndex != null && previews[previewIndex] ? (
          <div className="cover-preview">
            <img
              src={previews[previewIndex]}
              alt=""
              fetchPriority="high"
              decoding="async"
              draggable={false}
            />
            {previews.length > 1 ? (
              <div className="cover-preview-dots" aria-hidden="true">
                {previews.map((url, index) => (
                  <span
                    key={url}
                    className={index === previewIndex ? "is-active" : ""}
                  />
                ))}
              </div>
            ) : null}
          </div>
        ) : null}
        {coverProgress && previewIndex == null ? (
          <CoverDownloadProgress
            percent={coverProgress.percent}
            action={coverProgress.action}
          />
        ) : null}
        <div className="cover-tl">
          {updates.updateAvailable ? (
            <span
              className="cover-update-badge"
              title={
                library?.installedVersion
                  ? `Update available · installed ${library.installedVersion}`
                  : "Update available"
              }
            >
              Update
            </span>
          ) : null}
          {status.completed ? (
            <span
              className="cover-status-badge cover-status-completed"
              title="Completed"
            >
              Completed
            </span>
          ) : null}
          {status.onHold ? (
            <span
              className="cover-status-badge cover-status-onhold"
              title="On hold"
            >
              On hold
            </span>
          ) : null}
          {status.abandoned ? (
            <span
              className="cover-status-badge cover-status-abandoned"
              title="Abandoned"
            >
              Abandoned
            </span>
          ) : null}
          <EngineBadge name={engine} />
        </div>
        {library?.isInstalled && (onPlay || playing) ? (
          <div className="cover-bl">
            <button
              className={[
                "play-badge",
                starting ? "is-starting" : "",
                playing ? "is-stop" : "",
              ]
                .filter(Boolean)
                .join(" ")}
              type="button"
              disabled={starting}
              title={
                starting
                  ? "Starting…"
                  : playing
                    ? "Stop"
                    : library.installedVersion
                      ? `Play ${library.installedVersion}`
                      : "Play"
              }
              onClick={(event) => {
                event.stopPropagation();
                if (starting) return;
                if (playing) {
                  void onStop?.();
                  return;
                }
                if (!onPlay) return;
                setStarting(true);
                void Promise.resolve(onPlay()).catch(() => {
                  setStarting(false);
                });
              }}
            >
              {starting ? (
                <svg
                  className="play-badge-spinner"
                  viewBox="0 0 16 16"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeOpacity="0.28"
                    strokeWidth="2"
                  />
                  <path
                    d="M8 2.5a5.5 5.5 0 0 1 5.5 5.5"
                    fill="none"
                    stroke="currentColor"
                    strokeWidth="2"
                    strokeLinecap="round"
                  />
                </svg>
              ) : playing ? (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <rect
                    x="4"
                    y="4"
                    width="8"
                    height="8"
                    rx="1.2"
                    fill="currentColor"
                  />
                </svg>
              ) : (
                <svg viewBox="0 0 16 16" aria-hidden="true">
                  <path fill="currentColor" d="M4.2 2.8v10.4L13.4 8z" />
                </svg>
              )}
              <span className="sr-only">
                {starting ? "Starting" : playing ? "Stop" : "Play"}
              </span>
            </button>
          </div>
        ) : null}
        {game.version ? (
          <span className="cover-version" title={game.version}>
            {game.version}
          </span>
        ) : null}
        <FollowButton subscribed={subscribed} onToggle={onToggle} />
      </div>
      <div className="game-meta">
        <div className="game-title-row">
          <h2 className="game-title">{game.title}</h2>
          {(subscribed && updates.unplayedUpdate) || library?.hasArchive ? (
            <div className="game-title-badges">
              {library?.hasArchive ? (
                <span className="archive-badge" title="Archive downloaded">
                  <svg viewBox="0 0 16 16" aria-hidden="true">
                    <path
                      fill="currentColor"
                      d="M3.2 2.4h9.6v2.4H3.2zm0 3.2h9.6v8H3.2zm3.2 2v1.2h3.2V7.6z"
                    />
                  </svg>
                  <span className="sr-only">Archive downloaded</span>
                </span>
              ) : null}
              {subscribed && updates.unplayedUpdate ? (
                <span
                  className="update-chip update-chip-new"
                  title={
                    game.lastPlayedVersion
                      ? `New version available · last played ${game.lastPlayedVersion}`
                      : "New version available"
                  }
                >
                  New
                </span>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="game-creator-row">
          <span className="muted">{game.creator || "Unknown creator"}</span>
          {onMarkPlayed || onIgnoreUpdate || onToggleRoster ? (
            <div className="card-update-actions">
              {onMarkPlayed ? (
                <button
                  className="ghost-btn card-tile-action"
                  type="button"
                  disabled={updateAction !== null}
                  title={
                    game.version
                      ? `Mark ${game.version} as already played`
                      : "Mark this version as already played"
                  }
                  aria-label={
                    game.version
                      ? `Mark ${game.version} as already played`
                      : "Mark this version as already played"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void runUpdateAction("played", onMarkPlayed);
                  }}
                >
                  {updateAction === "played" ? (
                    <span
                      className="card-tile-action-busy"
                      aria-hidden="true"
                    />
                  ) : (
                    <PlayedIcon />
                  )}
                </button>
              ) : null}
              {onIgnoreUpdate ? (
                <button
                  className="ghost-btn card-tile-action"
                  type="button"
                  disabled={updateAction !== null}
                  title={
                    game.version
                      ? `Ignore update ${game.version}`
                      : "Ignore this update"
                  }
                  aria-label={
                    game.version
                      ? `Ignore update ${game.version}`
                      : "Ignore this update"
                  }
                  onClick={(event) => {
                    event.stopPropagation();
                    void runUpdateAction("ignore", onIgnoreUpdate);
                  }}
                >
                  {updateAction === "ignore" ? (
                    <span
                      className="card-tile-action-busy"
                      aria-hidden="true"
                    />
                  ) : (
                    <IgnoreUpdateIcon />
                  )}
                </button>
              ) : null}
              {onToggleRoster ? (
                <button
                  className={
                    inRoster
                      ? "ghost-btn card-tile-action is-on"
                      : "ghost-btn card-tile-action"
                  }
                  type="button"
                  disabled={updateAction !== null}
                  aria-pressed={inRoster}
                  title={inRoster ? "Remove from roster" : "Add to roster"}
                  aria-label={inRoster ? "Remove from roster" : "Add to roster"}
                  onClick={(event) => {
                    event.stopPropagation();
                    void runUpdateAction("roster", onToggleRoster);
                  }}
                >
                  {updateAction === "roster" ? (
                    <span
                      className="card-tile-action-busy"
                      aria-hidden="true"
                    />
                  ) : (
                    <RosterIcon inRoster={inRoster} />
                  )}
                </button>
              ) : null}
            </div>
          ) : null}
        </div>
        <div className="game-stats muted">
          <span className={ratingClass(game.rating)}>
            {formatRating(game.rating)}
          </span>
          {likes ? (
            <span
              className="game-stat"
              title={`${likes.toLocaleString()} likes`}
            >
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
            <span
              className="game-stat"
              title={`${views.toLocaleString()} views`}
            >
              <svg viewBox="0 0 16 16" aria-hidden="true">
                <path
                  fill="currentColor"
                  d="M8 3.2c3.2 0 5.9 2 7.2 4.8-1.3 2.8-4 4.8-7.2 4.8S2.1 10.8.8 8C2.1 5.2 4.8 3.2 8 3.2m0 2A2.8 2.8 0 1 0 10.8 8 2.8 2.8 0 0 0 8 5.2z"
                />
              </svg>
              {formatCount(views)}
            </span>
          ) : null}
          <span title={updatedExact || undefined}>
            {updatedRelative
              ? `Updated ${updatedRelative}`
              : game.source === "bookmark"
                ? "Bookmark"
                : game.source === "watched"
                  ? "Watched"
                  : ""}
          </span>
        </div>
        {shownFavorites.length || shownHated.length ? (
          <div className="card-tags">
            {shownFavorites.map((tag) => (
              <span key={`fav-${tag.id}`} className={`chip chip-${tag.tier}`}>
                {tag.name}
              </span>
            ))}
            {shownHated.map((tag) => (
              <span key={`hate-${tag.id}`} className="chip chip-hate">
                {tag.name}
              </span>
            ))}
          </div>
        ) : null}
      </div>
    </article>
  );
}

function PlayedIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M8 1.4A6.6 6.6 0 1 0 14.6 8 6.6 6.6 0 0 0 8 1.4m3.1 4.5L7.2 10.6 4.8 8.2l1-1 1.4 1.4 2.9-3.7z"
      />
    </svg>
  );
}

function IgnoreUpdateIcon(): JSX.Element {
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path fill="currentColor" d="M2.2 3.1v9.8L9 8zm7.2 0v9.8L16 8z" />
    </svg>
  );
}

function RosterIcon({ inRoster }: { inRoster: boolean }): JSX.Element {
  if (inRoster) {
    return (
      <svg viewBox="0 0 16 16" aria-hidden="true">
        <path
          fill="currentColor"
          d="M3.2 2.2h9.6v11.6L8 11.4l-4.8 2.4zm1.6 2v1.4h6.4V4.2zm0 2.8v1.4h6.4V7zm0 2.8v1.2h3.6V9.8z"
        />
      </svg>
    );
  }
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        fill="currentColor"
        d="M3.2 2.2h7.2v1.6H4.8v8.8H3.2zm4.8 3.2h6.4v1.4H8zm0 3.2h4.2v1.4H8zM12.2 2.4h1.4v2.2H16v1.4h-2.4V8.2h-1.4V6H10V4.6h2.2z"
      />
    </svg>
  );
}

export default memo(GameCard);

function CoverDownloadProgress({
  percent,
  action = "Downloading",
}: {
  percent: number | null;
  action?: "Downloading" | "Installing";
}): JSX.Element {
  const label = percent == null ? action : `${action} ${percent}%`;
  const ringStyle =
    percent == null
      ? undefined
      : {
          background: `conic-gradient(var(--accent) ${percent}%, rgba(255, 255, 255, 0.16) 0)`,
        };
  return (
    <div
      className="cover-download-progress"
      role="progressbar"
      aria-label={label}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent ?? undefined}
    >
      <span
        className={
          percent == null
            ? "cover-download-ring is-unknown"
            : "cover-download-ring"
        }
        style={ringStyle}
      >
        <span className="cover-download-ring-inner">
          {percent == null ? "…" : `${percent}%`}
        </span>
      </span>
    </div>
  );
}
