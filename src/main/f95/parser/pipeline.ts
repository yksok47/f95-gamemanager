/**
 * Sample pipeline: only firstPost inputs are authored (full thread HTML).
 * Each parser's output is copied to every dependent parser's matching input.
 *
 *   firstPost
 *     ├─ banner, description, gallery, changelog, overview, developerNotes
 *     └─ downloadsSection → downloads
 */
export type ParserName =
  | 'firstPost'
  | 'banner'
  | 'description'
  | 'gallery'
  | 'changelog'
  | 'downloadsSection'
  | 'downloads'
  | 'overview'
  | 'developerNotes'

export type ParserSpec = {
  name: ParserName
  inputFile: string
  outputFile: string
  /** Parser whose output is copied to this parser's input. `null` for roots. */
  source: ParserName | null
}

export const PARSERS: Record<ParserName, ParserSpec> = {
  firstPost: {
    name: 'firstPost',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: null
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
    outputFile: 'output.html',
    source: 'firstPost'
  },
  changelog: {
    name: 'changelog',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: 'firstPost'
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
  developerNotes: {
    name: 'developerNotes',
    inputFile: 'input.html',
    outputFile: 'output.html',
    source: 'firstPost'
  }
}

/** Parents first, so one pass can copy outputs down the chain. */
export const PARSER_ORDER: ParserName[] = [
  'firstPost',
  'banner',
  'description',
  'gallery',
  'changelog',
  'downloadsSection',
  'downloads',
  'overview',
  'developerNotes'
]
