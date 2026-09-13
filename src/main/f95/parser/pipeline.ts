/**
 * Sample pipeline: firstPost and reviews inputs are authored (downloaded HTML).
 * Each firstPost-derived parser's output is copied to every dependent parser's matching input.
 *
 *   firstPost
 *     ├─ banner, description, gallery, overview, notes
 *     ├─ changelogSection → changelog
 *     └─ downloadsSection → downloads
 *
 *   threadPage  (same full-page HTML as firstPost; JSON page chrome)
 *   reviews     (separate root: /br-reviews pages)
 */
export type ParserName =
  | 'firstPost'
  | 'threadPage'
  | 'banner'
  | 'description'
  | 'gallery'
  | 'changelogSection'
  | 'changelog'
  | 'downloadsSection'
  | 'downloads'
  | 'overview'
  | 'notes'
  | 'reviews'

export type ParserSpec = {
  name: ParserName
  inputFile: string
  outputFile: string
  /** Parser whose output is copied to this parser's input. `null` for roots. */
  source: ParserName | null
  /**
   * When set, sample IDs and input files are read from this parser's folders
   * (output still written under `name`). Used when two roots share authored HTML.
   */
  inputFrom?: ParserName
}

export const PARSERS: Record<ParserName, ParserSpec> = {
  firstPost: {
    name: 'firstPost',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: null
  },
  threadPage: {
    name: 'threadPage',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: null,
    inputFrom: 'firstPost'
  },
  banner: {
    name: 'banner',
    inputFile: 'input.html',
    outputFile: 'output.txt',
    source: 'firstPost'
  },
  description: {
    name: 'description',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: 'firstPost'
  },
  gallery: {
    name: 'gallery',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: 'firstPost'
  },
  changelogSection: {
    name: 'changelogSection',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: 'firstPost'
  },
  changelog: {
    name: 'changelog',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: 'changelogSection'
  },
  downloadsSection: {
    name: 'downloadsSection',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: 'firstPost'
  },
  downloads: {
    name: 'downloads',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: 'downloadsSection'
  },
  overview: {
    name: 'overview',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: 'firstPost'
  },
  notes: {
    name: 'notes',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: 'firstPost'
  },
  reviews: {
    name: 'reviews',
    inputFile: 'input.html',
    outputFile: 'output.json',
    source: null
  }
}

/** Parents first, so one pass can copy outputs down the chain. */
export const PARSER_ORDER: ParserName[] = [
  'firstPost',
  'threadPage',
  'banner',
  'description',
  'gallery',
  'changelogSection',
  'changelog',
  'downloadsSection',
  'downloads',
  'overview',
  'notes',
  'reviews'
]
