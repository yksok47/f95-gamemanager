import { useMemo, useState, type JSX } from 'react'
import {
  OS_KIND_LABELS,
  osKindFromNavigator,
  type DownloadEntry,
  type DownloadMirror,
  type DownloadSection
} from '@shared/types'
import {
  downloadProviderLabel,
  mirrorIsOneClick,
  mirrorTarget,
  rankMirrors,
  type DownloadProviderId
} from '@shared/download-providers'
import {
  availablePlatforms,
  buildDownloadLayout,
  defaultPlatformFilter,
  entryHeading,
  entryTags,
  type DownloadBlock,
  type DownloadRowModel,
  type PlatformFilter
} from '../lib/download-layout'
import { SplitButton, type MenuItem } from './MenuPopover'

const HOST_OS =
  typeof navigator === 'undefined'
    ? null
    : osKindFromNavigator(navigator.platform, navigator.userAgent)

type OpenMirror = (url: string, entry: DownloadEntry) => void

function hostLabel(url: string): string {
  try {
    const parsed = new URL(url)
    const masked = parsed.pathname.match(/^\/masked\/([^/]+)/i)
    if (masked?.[1]) return masked[1]
    return parsed.hostname.replace(/^www\./, '')
  } catch {
    return 'Link'
  }
}

/** Link text as posted, falling back to the host when it is a bare URL. */
function linkText(link: DownloadMirror): string {
  const label = link.label.trim().replace(/[*\s]+$/, '')
  if (!label || /^https?:\/\//i.test(label)) return hostLabel(link.url)
  return label
}

function mirrorSource(mirror: DownloadMirror): string {
  const target = mirrorTarget(mirror)
  if (target.kind === 'provider') return downloadProviderLabel(target.provider)
  if (target.kind === 'file') return 'Direct file'
  if (target.kind === 'forum') return 'F95zone'
  return target.host.includes('.') ? target.host : linkText(mirror)
}

function mirrorAction(mirror: DownloadMirror): string {
  const kind = mirrorTarget(mirror).kind
  if (kind === 'forum') return 'Open post'
  if (kind === 'web') return 'Open'
  return 'Download'
}

function mirrorMenuItem(mirror: DownloadMirror, index: number, onOpen: (url: string) => void): MenuItem {
  const kind = mirrorTarget(mirror).kind
  const named = kind === 'forum' || kind === 'web'
  return {
    id: `${index}-${mirror.url}`,
    label: named ? linkText(mirror) : mirrorSource(mirror),
    hint: named ? mirrorSource(mirror) : mirrorIsOneClick(mirror) ? 'One-click' : undefined,
    active: index === 0,
    onClick: () => onOpen(mirror.url)
  }
}

function MirrorPicker({
  mirrors,
  providerOrder,
  primary,
  onOpen
}: {
  mirrors: DownloadMirror[]
  providerOrder: readonly DownloadProviderId[]
  primary: boolean
  onOpen: (url: string) => void
}): JSX.Element | null {
  const ranked = useMemo(() => rankMirrors(mirrors, providerOrder), [mirrors, providerOrder])
  const best = ranked[0]
  if (!best) return null
  return (
    <SplitButton
      label={mirrorAction(best)}
      detail={mirrorSource(best)}
      title={`${linkText(best)} · ${hostLabel(best.url)}`}
      variant={primary ? 'primary' : 'ghost'}
      size="sm"
      menuHeader={`${ranked.length} mirrors`}
      items={ranked.length > 1 ? ranked.map((mirror, index) => mirrorMenuItem(mirror, index, onOpen)) : []}
      onClick={() => onOpen(best.url)}
    />
  )
}

function DownloadOptionRow({
  row,
  providerOrder,
  primary,
  onOpen
}: {
  row: DownloadRowModel
  providerOrder: readonly DownloadProviderId[]
  primary: boolean
  onOpen: OpenMirror
}): JSX.Element {
  const { entry } = row
  const open = (url: string): void => onOpen(url, entry)
  const head = (
    <div className="download-option-head">
      <span className="download-option-title">{entryHeading(entry)}</span>
      {entryTags(entry, row.split).map((tag) => (
        <span key={tag} className="download-tag">
          {tag}
        </span>
      ))}
    </div>
  )

  if (!entry.parts.length) {
    return (
      <li className="download-option">
        {head}
        <MirrorPicker
          mirrors={entry.mirrors}
          providerOrder={providerOrder}
          primary={primary}
          onOpen={open}
        />
      </li>
    )
  }

  const bestParts = entry.parts.flatMap((part) => rankMirrors(part.mirrors, providerOrder).slice(0, 1))
  // Browser-based hosts would open one window per part; only batch when nothing needs a page.
  const canDownloadAll =
    bestParts.length > 1 && bestParts.length === entry.parts.length && bestParts.every(mirrorIsOneClick)

  return (
    <li className="download-option download-option-split">
      {head}
      {canDownloadAll ? (
        <button
          className={primary ? 'primary-btn download-all-btn' : 'ghost-btn download-all-btn'}
          type="button"
          onClick={() => bestParts.forEach((mirror) => open(mirror.url))}
        >
          Download all parts
        </button>
      ) : null}
      <ol className="download-part-list">
        {entry.parts.map((part) => (
          <li key={`${part.index}-${part.label}`} className="download-part-row">
            <span className="download-part-label">{part.label || `Part ${part.index}`}</span>
            <MirrorPicker
              mirrors={part.mirrors}
              providerOrder={providerOrder}
              primary={false}
              onOpen={open}
            />
          </li>
        ))}
      </ol>
    </li>
  )
}

function DownloadBlocks({
  blocks,
  providerOrder,
  primaryKey,
  onOpen
}: {
  blocks: DownloadBlock[]
  providerOrder: readonly DownloadProviderId[]
  primaryKey?: string
  onOpen: OpenMirror
}): JSX.Element {
  return (
    <>
      {blocks.map((block) => (
        <div key={block.key} className="download-block">
          {block.title ? <h3 className="download-block-title">{block.title}</h3> : null}
          <ul className="download-options">
            {block.rows.map((row) => (
              <DownloadOptionRow
                key={row.key}
                row={row}
                providerOrder={providerOrder}
                primary={row.key === primaryKey}
                onOpen={onOpen}
              />
            ))}
          </ul>
        </div>
      ))}
    </>
  )
}

type GameDownloadsPanelProps = {
  sections: DownloadSection[]
  providerOrder: readonly DownloadProviderId[]
  onOpen: OpenMirror
}

export default function GameDownloadsPanel({
  sections,
  providerOrder,
  onOpen
}: GameDownloadsPanelProps): JSX.Element {
  const platforms = useMemo(() => availablePlatforms(sections, HOST_OS), [sections])
  const fallbackFilter = useMemo(() => defaultPlatformFilter(sections, HOST_OS), [sections])
  const [chosen, setChosen] = useState<PlatformFilter | null>(null)
  const filter: PlatformFilter =
    chosen && (chosen === 'all' || platforms.includes(chosen)) ? chosen : fallbackFilter
  const layout = useMemo(() => buildDownloadLayout(sections, filter), [sections, filter])
  const olderCount = layout.older.reduce((total, block) => total + block.rows.length, 0)
  const primaryKey = layout.game[0]?.rows[0]?.key
  const filters: PlatformFilter[] = [...platforms, 'all']

  return (
    <div className="download-panel">
      {platforms.length > 1 ? (
        <div className="download-toolbar">
          <div className="match-toggle" role="group" aria-label="Platform">
            {filters.map((item) => (
              <button
                key={item}
                type="button"
                className={filter === item ? 'is-active' : undefined}
                aria-pressed={filter === item}
                onMouseDown={(event) => event.preventDefault()}
                onClick={() => setChosen(item)}
              >
                {item === 'all' ? 'All platforms' : OS_KIND_LABELS[item]}
                {item === HOST_OS ? <span className="download-host-badge">This computer</span> : null}
              </button>
            ))}
          </div>
        </div>
      ) : null}

      {layout.game.length ? (
        <section className="download-card">
          <h2 className="download-card-title">Game</h2>
          <DownloadBlocks
            blocks={layout.game}
            providerOrder={providerOrder}
            primaryKey={primaryKey}
            onOpen={onOpen}
          />
        </section>
      ) : null}

      {layout.hidden > 0 && filter !== 'all' ? (
        <p className="download-hidden-note">
          {layout.hidden} {layout.hidden === 1 ? 'download is' : 'downloads are'} for other
          platforms.
          <button className="ghost-btn download-show-all" type="button" onClick={() => setChosen('all')}>
            Show all platforms
          </button>
        </p>
      ) : null}

      {layout.addons.length ? (
        <section className="download-card">
          <h2 className="download-card-title">Patches &amp; extras</h2>
          <DownloadBlocks blocks={layout.addons} providerOrder={providerOrder} onOpen={onOpen} />
        </section>
      ) : null}

      {layout.older.length ? (
        <details className="download-card download-older">
          <summary className="download-card-title">
            Older versions <span className="download-count">{olderCount}</span>
          </summary>
          <DownloadBlocks blocks={layout.older} providerOrder={providerOrder} onOpen={onOpen} />
        </details>
      ) : null}

      <p className="download-footnote">
        Download uses the highest-ranked host from Settings › Downloads. Use the arrow for other
        mirrors.
      </p>
    </div>
  )
}
