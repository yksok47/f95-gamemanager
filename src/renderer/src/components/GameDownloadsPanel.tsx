import { useMemo, useState, type JSX } from 'react'
import {
  CONTENT_KIND_LABELS,
  OS_KIND_LABELS,
  osKindFromNavigator,
  type DownloadEntry,
  type DownloadMirror,
  type DownloadSection,
  type KnownDownloadFile
} from '@shared/types'
import {
  mirrorIsOneClick,
  mirrorTarget,
  mirrorUsesConnector,
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
import { linkText, mirrorAction, mirrorSource, mirrorTitle } from '../lib/download-picks'
import { formatBytes } from '../lib/downloads'
import { trustWarning } from '../lib/p2p-trust'
import { SplitButton, type MenuItem } from './MenuPopover'

const HOST_OS =
  typeof navigator === 'undefined'
    ? null
    : osKindFromNavigator(navigator.platform, navigator.userAgent)

type OpenMirrorOptions = { skipConnector?: boolean }
type OpenMirror = (url: string, entry: DownloadEntry, options?: OpenMirrorOptions) => void

function peerHint(mirror: DownloadMirror): string | undefined {
  const p2p = mirror.p2p
  if (!p2p) return undefined
  if (p2p.flagCounts.harmful > 0) return `Flagged harmful ×${p2p.flagCounts.harmful}`
  if (p2p.seeders == null) return 'One-click'
  return p2p.seeders > 0 ? `${p2p.seeders} seeding` : 'Nobody seeding'
}

function mirrorMenuItem(
  mirror: DownloadMirror,
  index: number,
  onOpen: (url: string, options?: OpenMirrorOptions) => void
): MenuItem {
  const kind = mirrorTarget(mirror).kind
  const named = kind === 'forum' || kind === 'web'
  const item: MenuItem = {
    id: `${index}-${mirror.url}`,
    label: named ? linkText(mirror) : mirrorSource(mirror),
    hint: named
      ? mirrorSource(mirror)
      : (peerHint(mirror) ?? (mirrorIsOneClick(mirror) ? 'One-click' : undefined)),
    active: index === 0,
    onClick: () => onOpen(mirror.url)
  }
  if (mirrorUsesConnector(mirror)) {
    item.link = {
      label: 'Open in browser',
      title: 'If one-click fails',
      onClick: () => onOpen(mirror.url, { skipConnector: true })
    }
  }
  return item
}

function pickerMenuItems(
  ranked: DownloadMirror[],
  onOpen: (url: string, options?: OpenMirrorOptions) => void
): MenuItem[] {
  if (ranked.length < 2 && !ranked.some(mirrorUsesConnector)) return []
  return ranked.map((mirror, index) => mirrorMenuItem(mirror, index, onOpen))
}

function MirrorPicker({
  mirrors,
  providerOrder,
  primary,
  startingUrl,
  onOpen
}: {
  mirrors: DownloadMirror[]
  providerOrder: readonly DownloadProviderId[]
  primary: boolean
  startingUrl?: string | null
  onOpen: (url: string, options?: OpenMirrorOptions) => void
}): JSX.Element | null {
  const ranked = useMemo(() => rankMirrors(mirrors, providerOrder), [mirrors, providerOrder])
  const best = ranked[0]
  if (!best) return null
  const starting = Boolean(startingUrl && ranked.some((mirror) => mirror.url === startingUrl))
  const items = pickerMenuItems(ranked, onOpen)
  return (
    <SplitButton
      label={starting ? 'Starting…' : mirrorAction(best)}
      detail={mirrorSource(best)}
      title={mirrorTitle(best)}
      variant={primary ? 'primary' : 'ghost'}
      size="sm"
      busy={starting}
      menuHeader={ranked.length > 1 ? `${ranked.length} mirrors` : undefined}
      items={items}
      onClick={() => onOpen(best.url)}
    />
  )
}

const KNOWN_FILES_SHOWN = 3

function knownFileFacts(file: KnownDownloadFile): string {
  return [
    file.sizeBytes ? formatBytes(file.sizeBytes) : '',
    file.os.map((os) => OS_KIND_LABELS[os]).join(' / '),
    file.contentKind ? CONTENT_KIND_LABELS[file.contentKind] : 'Untagged',
    file.version ?? '',
    `${file.installCount} install${file.installCount === 1 ? '' : 's'}`
  ]
    .filter(Boolean)
    .join(' · ')
}

function KnownFiles({ files, peerShared }: { files: KnownDownloadFile[]; peerShared: boolean }): JSX.Element {
  const extra = files.length - KNOWN_FILES_SHOWN
  return (
    <ul
      className="download-known"
      title={
        peerShared
          ? 'Shared over P2P by other app users; not linked in the post'
          : 'Files app users got from these links, with the tags they voted on'
      }
    >
      {files.slice(0, KNOWN_FILES_SHOWN).map((file) => {
        const warning = trustWarning(file)
        return (
          <li key={file.contentHash}>
            {peerShared ? null : <span className="download-known-name">{file.filename}</span>}
            <span className="download-known-facts">{knownFileFacts(file)}</span>
            {warning ? (
              <span className={`download-known-warning p2p-trust-note-${warning.tone}`}>{warning.text}</span>
            ) : null}
          </li>
        )
      })}
      {extra > 0 ? (
        <li className="download-known-facts">
          +{extra} more file{extra === 1 ? '' : 's'}
        </li>
      ) : null}
    </ul>
  )
}

function DownloadOptionRow({
  row,
  providerOrder,
  primary,
  startingUrl,
  onOpen
}: {
  row: DownloadRowModel
  providerOrder: readonly DownloadProviderId[]
  primary: boolean
  startingUrl?: string | null
  onOpen: OpenMirror
}): JSX.Element {
  const { entry } = row
  const open = (url: string, options?: OpenMirrorOptions): void => onOpen(url, entry, options)
  const head = (
    <div className="download-option-head">
      <span className="download-option-title">{entryHeading(entry)}</span>
      {entryTags(entry, row.split).map((tag) => (
        <span key={tag} className="download-tag">
          {tag}
        </span>
      ))}
      {entry.peerShared ? (
        <span className="download-tag download-tag-accent" title="Not in the post — shared by other app users">
          P2P only
        </span>
      ) : null}
    </div>
  )
  const known = entry.known?.length ? (
    <KnownFiles files={entry.known} peerShared={Boolean(entry.peerShared)} />
  ) : null

  if (!entry.parts.length) {
    return (
      <li className="download-option">
        {head}
        <MirrorPicker
          mirrors={entry.mirrors}
          providerOrder={providerOrder}
          primary={primary}
          startingUrl={startingUrl}
          onOpen={open}
        />
        {known}
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
              startingUrl={startingUrl}
              onOpen={open}
            />
          </li>
        ))}
      </ol>
      {known}
    </li>
  )
}

function DownloadBlocks({
  blocks,
  providerOrder,
  primaryKey,
  startingUrl,
  onOpen
}: {
  blocks: DownloadBlock[]
  providerOrder: readonly DownloadProviderId[]
  primaryKey?: string
  startingUrl?: string | null
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
                startingUrl={startingUrl}
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
  startingUrl?: string | null
  onOpen: OpenMirror
}

export default function GameDownloadsPanel({
  sections,
  providerOrder,
  startingUrl,
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
            startingUrl={startingUrl}
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
          <DownloadBlocks
            blocks={layout.addons}
            providerOrder={providerOrder}
            startingUrl={startingUrl}
            onOpen={onOpen}
          />
        </section>
      ) : null}

      {layout.older.length ? (
        <details className="download-card download-older">
          <summary className="download-card-title">
            Older versions <span className="download-count">{olderCount}</span>
          </summary>
          <DownloadBlocks
            blocks={layout.older}
            providerOrder={providerOrder}
            startingUrl={startingUrl}
            onOpen={onOpen}
          />
        </details>
      ) : null}

      <p className="download-footnote">
        Download and Update use the highest-ranked host from Settings › Downloads, where
        Peer-to-peer can be ranked too. Use the arrow for other mirrors, or to open a host page if
        one-click fails.
      </p>
    </div>
  )
}
