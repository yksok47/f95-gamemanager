import { useEffect, useId, useState, type JSX } from 'react'
import { createPortal } from 'react-dom'
import type { GameLibraryFile } from '@shared/types'
import { CONTENT_KIND_IDS } from '@shared/types'
import type { PackageConsensus, PackageInstallTags, PackageVersionWeight } from '@shared/p2p'
import P2pApproveTagsForm from './P2pApproveTagsForm'
import { formatBytes } from '../lib/downloads'

export default function LibraryFileTagsDialog({
  file,
  versions,
  busy,
  onClose,
  onSave
}: {
  file: GameLibraryFile
  versions: string[]
  busy: boolean
  onClose: () => void
  onSave: (tags: PackageInstallTags) => void
}): JSX.Element {
  const titleId = useId()
  const formId = useId()
  const [tagsReady, setTagsReady] = useState(false)

  useEffect(() => {
    function onKey(event: KeyboardEvent): void {
      if (event.key === 'Escape') {
        event.preventDefault()
        if (!busy) onClose()
      }
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [busy, onClose])

  const tags = file.packageTags
  const fallbackConsensus: PackageConsensus = {
    os: tags?.os ?? [],
    contentKind: tags?.contentKind ?? CONTENT_KIND_IDS.game,
    version: (tags?.version || file.version || '').trim(),
    versionId: 0
  }
  const versionWeights: PackageVersionWeight[] = []
  const addVersion = (name?: string): void => {
    const next = (name || '').trim()
    if (!next || versionWeights.some((item) => item.name === next)) return
    versionWeights.push({
      id: versionWeights.length + 1,
      name: next,
      weight: 1000 - versionWeights.length
    })
  }
  for (const name of versions) addVersion(name)
  addVersion(fallbackConsensus.version)

  const sizeLabel = file.size ? `${formatBytes(file.size)} · ` : ''

  return createPortal(
    <div
      className="app-confirm-overlay"
      role="presentation"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget && !busy) onClose()
      }}
    >
      <div
        className="storage-identify-dialog storage-import-dialog library-file-tags-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
      >
        <div className="storage-identify-head">
          <h2 id={titleId} className="app-confirm-title">
            Change version and OS
          </h2>
          <p className="muted">
            Update the tags on <strong>{file.filename}</strong>. This does not re-download the file.
          </p>
        </div>

        <P2pApproveTagsForm
          key={file.id}
          formId={formId}
          fallbackConsensus={fallbackConsensus}
          versions={versionWeights}
          statsPrefix={`${sizeLabel}${file.filename}`}
          onReadyChange={setTagsReady}
          onSubmit={onSave}
        />

        <div className="app-confirm-actions">
          <button className="ghost-btn" type="button" disabled={busy} onClick={onClose}>
            Cancel
          </button>
          <button className="primary-btn" type="submit" form={formId} disabled={busy || !tagsReady}>
            {busy ? 'Saving…' : 'Save'}
          </button>
        </div>
      </div>
    </div>,
    document.body
  )
}
