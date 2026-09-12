import { existsSync } from 'node:fs'
import { describe, expect, it } from 'vitest'
import { PARSERS, type ParserName } from './pipeline'
import {
  formatParserOutput,
  listPipelineSampleIds,
  normalizeText,
  readSampleFile,
  sampleFile,
  samplesAvailable,
  writeSampleFile
} from './sample-io'

export function shouldUpdateSamples(): boolean {
  return process.env.UPDATE_PARSER_SAMPLES === '1'
}

export function defineParserTests(name: ParserName, parse: (input: string) => unknown): void {
  const spec = PARSERS[name]

  describe(name, () => {
    if (!samplesAvailable()) {
      it('samples unavailable — pass', () => {
        expect(true).toBe(true)
      })
      return
    }

    const ids = listPipelineSampleIds(spec)
    if (!ids.length) {
      it('no samples for this parser — pass', () => {
        expect(true).toBe(true)
      })
      return
    }

    for (const id of ids) {
      it(`sample ${id}`, () => {
        const input = readSampleFile(spec.name, id, spec.inputFile)
        const actual = parse(input)
        const formatted = formatParserOutput(spec, actual)

        if (shouldUpdateSamples()) {
          writeSampleFile(spec.name, id, spec.outputFile, formatted)
        }

        const outputPath = sampleFile(spec.name, id, spec.outputFile)
        if (!existsSync(outputPath)) {
          throw new Error(
            `Missing ${spec.name} sample ${id} output. Re-run bun run parser:update to write ${outputPath}.`
          )
        }

        const expected = readSampleFile(spec.name, id, spec.outputFile)
        if (spec.outputFile.endsWith('.json')) {
          expect(actual).toEqual(JSON.parse(expected.trim() || 'null'))
          return
        }

        expect(normalizeText(String(actual))).toBe(normalizeText(expected))
      })
    }
  })
}
