import type { JSX } from 'react'
import type { PackageConsensus } from '@shared/p2p'
import {
  CONTENT_KIND_BY_ID,
  CONTENT_KIND_LABELS,
  OS_KIND_BY_ID,
  OS_KIND_LABELS,
  type ContentKind,
  type OsKind
} from '@shared/types'
import { KindIcon, OsIcon } from './TagIcons'

type PackageMetaTagsProps = {
  consensus?: PackageConsensus | null
  /** Shown when consensus has no version (e.g. package.gameVersion). */
  versionFallback?: string | null
  className?: string
  /** When false, omit the content-kind chip (e.g. already shown as a section heading). */
  showKind?: boolean
  /** When false, omit the version chip (e.g. already shown in file meta). */
  showVersion?: boolean
}

export function formatConsensusOs(os: number[]): string {
  return os
    .map((id) => {
      const key = OS_KIND_BY_ID[id as keyof typeof OS_KIND_BY_ID]
      return key ? OS_KIND_LABELS[key] : null
    })
    .filter(Boolean)
    .join(' / ')
}

export function formatConsensusKind(contentKind: number): string {
  const key = CONTENT_KIND_BY_ID[contentKind as keyof typeof CONTENT_KIND_BY_ID]
  return key ? CONTENT_KIND_LABELS[key] : `kind ${contentKind}`
}

function kindKeyOf(contentKind: number): ContentKind | null {
  return CONTENT_KIND_BY_ID[contentKind as keyof typeof CONTENT_KIND_BY_ID] ?? null
}

function osKeyOf(id: number): OsKind | null {
  return OS_KIND_BY_ID[id as keyof typeof OS_KIND_BY_ID] ?? null
}

/** Compact consensus chips for P2P download / catalog rows — icons for kind/OS, strong version. */
export default function PackageMetaTags({
  consensus,
  versionFallback,
  className,
  showKind = true,
  showVersion = true
}: PackageMetaTagsProps): JSX.Element | null {
  const kindKey = showKind && consensus != null ? kindKeyOf(consensus.contentKind) : null
  const kindLabel = showKind && consensus != null ? formatConsensusKind(consensus.contentKind) : null
  const osIds = consensus?.os ?? []
  const version =
    showVersion ? (consensus?.version?.trim() || versionFallback?.trim() || '') || null : null

  if (!kindKey && !osIds.length && !version) return null

  const osTitle = formatConsensusOs(osIds)
  const title = [kindLabel, version, osTitle || null].filter(Boolean).join(' · ')

  return (
    <div
      className={className ? `p2p-meta-tags ${className}` : 'p2p-meta-tags'}
      title={title}
    >
      {kindKey && kindLabel ? (
        <span className="p2p-meta-chip p2p-meta-kind">
          <KindIcon kind={kindKey} />
          <span className="p2p-meta-chip-label">{kindLabel}</span>
        </span>
      ) : null}
      {version ? (
        <span className="p2p-meta-chip p2p-meta-version">
          <span className="p2p-meta-version-mark" aria-hidden="true">
            v
          </span>
          <span className="p2p-meta-version-text">{version}</span>
        </span>
      ) : null}
      {osIds.length ? (
        <span className="p2p-meta-chip p2p-meta-os" aria-label={osTitle}>
          {osIds.map((id) => {
            const key = osKeyOf(id)
            if (!key) return null
            return (
              <span key={id} className="p2p-meta-os-item" title={OS_KIND_LABELS[key]}>
                <OsIcon os={key} />
                <span className="p2p-meta-chip-label">{OS_KIND_LABELS[key]}</span>
              </span>
            )
          })}
        </span>
      ) : null}
    </div>
  )
}
