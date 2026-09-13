import { copyFileSync, existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import { PARSERS, PARSER_ORDER, type ParserName, type ParserSpec } from './pipeline'

export const PARSER_ROOT = dirname(fileURLToPath(import.meta.url))

/**
 * External samples live in a sibling repo named `f95-gamemanager-parser-samples`,
 * or a `parser/samples` junction/symlink pointing at that repo.
 */
export function resolveSamplesRoot(): string | null {
  const junction = join(PARSER_ROOT, 'samples')
  if (existsSync(junction)) return junction

  const sibling = resolve(PARSER_ROOT, '../../../../../f95-gamemanager-parser-samples')
  if (existsSync(sibling)) return sibling

  return null
}

export function samplesAvailable(): boolean {
  return resolveSamplesRoot() !== null
}

export function sampleDir(parser: ParserName, id: string): string {
  const root = resolveSamplesRoot()
  if (!root) throw new Error('Parser samples root is not available')
  return join(root, parser, id)
}

export function sampleFile(parser: ParserName, id: string, filename: string): string {
  return join(sampleDir(parser, id), filename)
}

/** Top-level files under a parser folder (links.txt, cookies.txt, user-agent.txt). */
export function parserMetaFile(parser: ParserName, filename: string): string {
  const root = resolveSamplesRoot()
  if (!root) throw new Error('Parser samples root is not available')
  return join(root, parser, filename)
}

export function listSampleIds(parser: ParserName): string[] {
  const root = resolveSamplesRoot()
  if (!root) return []
  const dir = join(root, parser)
  if (!existsSync(dir)) return []
  return readdirSync(dir, { withFileTypes: true })
    .filter((entry) => entry.isDirectory())
    .map((entry) => entry.name)
    .sort((a, b) => a.localeCompare(b, undefined, { numeric: true }))
}

export function rootParser(spec: ParserSpec): ParserSpec {
  let current = spec
  while (current.source) current = PARSERS[current.source]
  return current
}

export function listPipelineSampleIds(spec: ParserSpec): string[] {
  if (spec.inputFrom) return listSampleIds(spec.inputFrom)
  return listSampleIds(rootParser(spec).name)
}

/** Folder that holds this parser's authored/propagated input files. */
export function inputSampleParser(spec: ParserSpec): ParserName {
  return spec.inputFrom ?? spec.name
}

export function readSampleFile(parser: ParserName, id: string, filename: string): string {
  const path = sampleFile(parser, id, filename)
  if (!existsSync(path)) {
    throw new Error(`Missing sample file: ${path}`)
  }
  return readFileSync(path, 'utf8')
}

export function writeSampleFile(parser: ParserName, id: string, filename: string, contents: string): void {
  const path = sampleFile(parser, id, filename)
  mkdirSync(dirname(path), { recursive: true })
  writeFileSync(path, contents, 'utf8')
}

export function normalizeText(value: string): string {
  const normalized = value.replace(/\r\n/g, '\n')
  return normalized.endsWith('\n') ? normalized : `${normalized}\n`
}

export function formatParserOutput(spec: ParserSpec, actual: unknown): string {
  if (spec.outputFile.endsWith('.json')) {
    return `${JSON.stringify(actual, null, 2)}\n`
  }
  return normalizeText(String(actual))
}

/** Copy each parser's output into every downstream parser's matching sample input. */
export function propagateSamples(): { copied: string[]; skipped: string[]; unavailable: boolean } {
  if (!samplesAvailable()) {
    return { copied: [], skipped: [], unavailable: true }
  }

  const copied: string[] = []
  const skipped: string[] = []

  for (const name of PARSER_ORDER) {
    const spec = PARSERS[name]
    if (!spec.source) continue
    const source = PARSERS[spec.source]
    for (const id of listSampleIds(source.name)) {
      const from = sampleFile(source.name, id, source.outputFile)
      const to = sampleFile(spec.name, id, spec.inputFile)
      if (!existsSync(from)) {
        skipped.push(`${spec.name}/${id} (missing ${source.name} output)`)
        continue
      }
      mkdirSync(dirname(to), { recursive: true })
      copyFileSync(from, to)
      copied.push(`${source.name}/${id}/${source.outputFile} -> ${spec.name}/${id}/${spec.inputFile}`)
    }
  }

  return { copied, skipped, unavailable: false }
}
