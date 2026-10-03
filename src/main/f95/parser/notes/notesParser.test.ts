import { describe, expect, it } from 'vitest'
import { isNotesLabel, parseNotes } from './notesParser'
import { defineParserTests } from '../test-harness'

defineParserTests('notes', parseNotes)

describe('isNotesLabel', () => {
  it('treats Tips as a notes section', () => {
    expect(isNotesLabel('Tips')).toBe(true)
    expect(isNotesLabel('Tip')).toBe(true)
    expect(isNotesLabel('FAQ')).toBe(true)
    expect(isNotesLabel('Changelog')).toBe(false)
  })
})
