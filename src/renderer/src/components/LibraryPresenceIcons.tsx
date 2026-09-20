import type { JSX } from 'react'
import { ArchiveIcon, FilingCabinetIcon, SavesOnlyIcon } from './ToolbarIcons'

type LibraryPresenceIconsProps = {
  hasArchive?: boolean
  hasSaves?: boolean
  archived?: boolean
}

export default function LibraryPresenceIcons({
  hasArchive = false,
  hasSaves = false,
  archived = false
}: LibraryPresenceIconsProps): JSX.Element | null {
  if (!hasArchive && !hasSaves && !archived) return null
  return (
    <>
      {archived ? (
        <span className="library-presence-badge archived-thread-badge" title="Archived thread">
          <FilingCabinetIcon />
          <span className="sr-only">Archived thread</span>
        </span>
      ) : null}
      {hasArchive ? (
        <span className="library-presence-badge archive-badge" title="Archive downloaded">
          <ArchiveIcon />
          <span className="sr-only">Archive downloaded</span>
        </span>
      ) : null}
      {hasSaves ? (
        <span className="library-presence-badge saves-badge" title="Saves on disk">
          <SavesOnlyIcon />
          <span className="sr-only">Saves on disk</span>
        </span>
      ) : null}
    </>
  )
}
