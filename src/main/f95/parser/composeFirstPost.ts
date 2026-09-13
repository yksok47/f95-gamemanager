import type {
  ChangelogEntry,
  DownloadSection,
  NoteSection,
  RelatedGame,
  ThreadField,
  ThreadLink
} from '@shared/types'
import { parseBanner } from './banner/bannerParser'
import { parseChangelog } from './changelog/changelogParser'
import { parseChangelogSection } from './changelogSection/changelogSectionParser'
import { parseDescription } from './description/descriptionParser'
import { parseDownloads } from './downloads/downloadsParser'
import { parseDownloadsSection } from './downloadsSection/downloadsSectionParser'
import { parseGallery } from './gallery/galleryParser'
import { parseNotes } from './notes/notesParser'
import { parseOverview } from './overview/overviewParser'

/** Everything derived from one first-post body HTML string. */
export type FirstPostContent = {
  descriptionHtml: string
  notes: NoteSection[]
  changelog: ChangelogEntry[]
  gallery: string[]
  banner: string
  downloads: DownloadSection[]
  fields: ThreadField[]
  creatorLinks: ThreadLink[]
  relatedGames: RelatedGame[]
  releaseDate: string
  updatedAt: string
}

/**
 * Run the first-post parser pipeline once.
 * Each section parser owns its own scan of the same HTML (sample-tested modules).
 */
export function composeFirstPost(html: string, threadId: number): FirstPostContent {
  if (!html.trim()) return emptyFirstPost()

  const overview = parseOverview(html)
  const changelogHtml = parseChangelogSection(html)
  const downloadsHtml = parseDownloadsSection(html)

  return {
    descriptionHtml: parseDescription(html),
    notes: parseNotes(html),
    changelog: parseChangelog(changelogHtml).map((row) => {
      const [version, text] = Object.entries(row)[0] ?? ['', '']
      return { version: version || 'Changes', text: text || '' }
    }),
    gallery: parseGallery(html),
    banner: parseBanner(html),
    downloads: parseDownloads(downloadsHtml),
    fields: overview.fields,
    creatorLinks: overview.creatorLinks,
    relatedGames: overview.relatedGames.filter((game) => game.threadId !== threadId),
    releaseDate: overview.releaseDate,
    updatedAt: overview.updatedAt
  }
}

export function emptyFirstPost(): FirstPostContent {
  return {
    descriptionHtml: '',
    notes: [],
    changelog: [],
    gallery: [],
    banner: '',
    downloads: [],
    fields: [],
    creatorLinks: [],
    relatedGames: [],
    releaseDate: '',
    updatedAt: ''
  }
}
