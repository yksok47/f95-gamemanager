import { describe, expect, test } from 'bun:test'
import {
  entriesSuggestWalkthroughDocument,
  pickWalkthroughDocumentEntries
} from './walkthrough-document'
import { isReviewablePackagePath, isWalkthroughDocumentPath } from './fs-utils'

describe('walkthrough documents', () => {
  test('recognizes common document extensions', () => {
    expect(isWalkthroughDocumentPath('Guide.pdf')).toBe(true)
    expect(isWalkthroughDocumentPath('C:\\downloads\\walkthrough.txt')).toBe(true)
    expect(isWalkthroughDocumentPath('notes.DOCX')).toBe(true)
    expect(isWalkthroughDocumentPath('faq.doc')).toBe(true)
    expect(isWalkthroughDocumentPath('tips.rtf')).toBe(true)
    expect(isWalkthroughDocumentPath('route.md')).toBe(true)
    expect(isWalkthroughDocumentPath('guide.html')).toBe(true)
    expect(isWalkthroughDocumentPath('modwtasahibito.rpa')).toBe(false)
    expect(isWalkthroughDocumentPath('unlock.rpy')).toBe(false)
    expect(isWalkthroughDocumentPath('game.zip')).toBe(false)
    expect(isWalkthroughDocumentPath('cover.jpg')).toBe(false)
  })

  test('reviews loose documents the same way as archives', () => {
    expect(isReviewablePackagePath('Walkthrough.pdf')).toBe(true)
    expect(isReviewablePackagePath('guide.txt')).toBe(true)
    expect(isReviewablePackagePath('notes.docx')).toBe(true)
    expect(isReviewablePackagePath('cover.jpg')).toBe(false)
    expect(isReviewablePackagePath('setup.exe')).toBe(false)
  })

  test('detects documents inside archives, including wrapped folders', () => {
    expect(entriesSuggestWalkthroughDocument(['wrapper/Walkthrough.pdf'])).toBe(true)
    expect(entriesSuggestWalkthroughDocument(['guide.txt', 'images/a.png'])).toBe(true)
    expect(entriesSuggestWalkthroughDocument(['modwtasahibito.rpa', 'NoMercyWalkthruModReadme.txt'])).toBe(
      true
    )
    expect(entriesSuggestWalkthroughDocument(['game/script.rpy', 'game/archive.rpa'])).toBe(false)
    expect(entriesSuggestWalkthroughDocument(['images/a.png'])).toBe(false)
  })

  test('prefers named walkthroughs and pdfs over leftover readmes', () => {
    expect(
      pickWalkthroughDocumentEntries(['readme.txt', 'docs/Walkthrough.pdf', 'notes.doc'])
    ).toEqual(['docs/Walkthrough.pdf'])
    expect(pickWalkthroughDocumentEntries(['a.txt', 'b.txt'])).toEqual(['a.txt', 'b.txt'])
    expect(pickWalkthroughDocumentEntries(['guide.txt', 'other.txt'])).toEqual(['guide.txt'])
    expect(
      pickWalkthroughDocumentEntries(['changelog.txt', 'NoMercyWalkthruModReadme.txt'])
    ).toEqual(['NoMercyWalkthruModReadme.txt'])
    expect(pickWalkthroughDocumentEntries(['game/script.rpy'])).toEqual([])
  })
})
